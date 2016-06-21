package main

import (
	"database/sql"
	"log"
	"net/http"
	"time"

	"github.com/go-martini/martini"
	"github.com/martini-contrib/render"
	. "github.com/russross/codegrinder/types"
	"github.com/russross/meddler"
)

// PostProblemBundleConfirmed handles a request to /v2/problem_bundles/confirmed,
// creating a new problem.
// The bundle must have a full set of passing commits signed by the daycare.
func PostProblemBundleConfirmed(w http.ResponseWriter, tx *sql.Tx, bundle ProblemBundle, render render.Render) {
	if bundle.Problem == nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "bundle must contain a problem")
		return
	}
	if bundle.Problem.ID != 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "new problem cannot already have a problem ID")
		return
	}

	saveProblemBundleCommon(w, tx, &bundle, render)
}

// PutProblemBundle handles a request to /v2/problem_bundles/:problem_id,
// updating an existing problem.
// The bundle must have a full set of passing commits signed by the daycare.
// If any assignments exist that refer to this problem, then the updates cannot change the number
// of steps in the problem.
func PutProblemBundle(w http.ResponseWriter, tx *sql.Tx, params martini.Params, bundle ProblemBundle, render render.Render) {
	if bundle.Problem == nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "bundle must contain a problem")
		return
	}
	if bundle.Problem.ID <= 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "updated problem must have ID > 0")
		return
	}

	old := new(Problem)
	if err := meddler.Load(tx, "problems", old, bundle.Problem.ID); err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}
	if bundle.Problem.Unique != old.Unique {
		loggedHTTPErrorf(w, http.StatusBadRequest, "updating a problem cannot change its unique ID from %q to %q; create a new problem instead", old.Unique, bundle.Problem.Unique)
		return
	}
	if bundle.Problem.ProblemType != old.ProblemType {
		loggedHTTPErrorf(w, http.StatusBadRequest, "updating a problem cannot change its type from %q to %q; create a new problem instead", old.ProblemType, bundle.Problem.ProblemType)
		return
	}
	if !bundle.Problem.CreatedAt.Equal(old.CreatedAt) {
		loggedHTTPErrorf(w, http.StatusBadRequest, "updating a problem cannot change its created time from %v to %v", old.CreatedAt, bundle.Problem.CreatedAt)
		return
	}

	var assignmentCount int
	if err := tx.QueryRow(`SELECT COUNT(1) FROM assignments INNER JOIN problem_sets ON assignments.problem_set_id = problem_sets.id INNER JOIN problem_set_problems ON problem_sets.id = problem_set_problems.problem_set_id WHERE problem_set_problems.problem_id = $1`, bundle.Problem.ID).Scan(&assignmentCount); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
	if assignmentCount > 0 {
		// count the steps in the old problem
		var stepCount int
		if err := tx.QueryRow(`SELECT COUNT(1) FROM problem_steps WHERE problem_id = $1`, bundle.Problem.ID).Scan(&stepCount); err != nil {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
			return
		}
		if len(bundle.ProblemSteps) != stepCount {
			loggedHTTPErrorf(w, http.StatusBadRequest, "cannot change the number of steps in a problem that is already in use")
			return
		}
	}

	saveProblemBundleCommon(w, tx, &bundle, render)
}

func saveProblemBundleCommon(w http.ResponseWriter, tx *sql.Tx, bundle *ProblemBundle, render render.Render) {
	now := time.Now()

	// clean up basic fields and do some checks
	problem, steps := bundle.Problem, bundle.ProblemSteps
	if err := problem.Normalize(now, steps); err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "%v", err)
		return
	}

	// note: unique constraint will be checked by the database

	// verify the signature
	sig := problem.ComputeSignature(Config.DaycareSecret, steps)
	if sig != bundle.ProblemSignature {
		loggedHTTPErrorf(w, http.StatusBadRequest, "problem signature does not check out: found %s but expected %s", bundle.ProblemSignature, sig)
		return
	}

	// verify all the commits
	if len(steps) != len(bundle.Commits) {
		loggedHTTPErrorf(w, http.StatusBadRequest, "problem must have exactly one commit for each problem step")
		return
	}
	if len(bundle.CommitSignatures) != len(bundle.Commits) {
		loggedHTTPErrorf(w, http.StatusBadRequest, "problem must have exactly one commit signature for each commit")
		return
	}
	for i, commit := range bundle.Commits {
		// check the commit signature
		csig := commit.ComputeSignature(Config.DaycareSecret, bundle.ProblemSignature)
		if csig != bundle.CommitSignatures[i] {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit for step %d has a bad signature", commit.Step)
			return
		}

		if commit.Step != steps[i].Step {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit for step %d says it is for step %d", steps[i].Step, commit.Step)
			return
		}

		// make sure this step passed
		if commit.Score != 1.0 || commit.ReportCard == nil || !commit.ReportCard.Passed {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit for step %d did not pass", i+1)
			return
		}
	}

	isUpdate := problem.ID != 0
	if err := meddler.Save(tx, "problems", problem); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
	for _, step := range steps {
		step.ProblemID = problem.ID
		if isUpdate {
			// TODO: no primary key, so meddler doesn't know what to do
			if err := meddler.Update(tx, "problem_steps", step); err != nil {
				loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
				return
			}
		} else {
			if err := meddler.Insert(tx, "problem_steps", step); err != nil {
				loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
				return
			}
		}
	}
	if isUpdate {
		log.Printf("problem %s (%d) with %d step(s) updated", problem.Unique, problem.ID, len(steps))
	} else {
		log.Printf("problem %s (%d) with %d step(s) created", problem.Unique, problem.ID, len(steps))
	}

	render.JSON(http.StatusOK, bundle)
}

// PostProblemBundleUnconfirmed handles a request to /v2/problem_bundles/unconfirmed,
// signing a new/updated problem that has not yet been tested on the daycare.
func PostProblemBundleUnconfirmed(w http.ResponseWriter, tx *sql.Tx, currentUser *User, bundle ProblemBundle, render render.Render) {
	now := time.Now()

	// basic sanity checks
	if len(bundle.ProblemSteps) < 2 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "problem must have at least one step")
		return
	}
	if len(bundle.ProblemSteps) != len(bundle.Commits) {
		loggedHTTPErrorf(w, http.StatusBadRequest, "problem must have exactly one commit for each step")
		return
	}
	if len(bundle.ProblemSignature) != 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "unconfirmed bundle must not have problem signature")
	}
	if len(bundle.CommitSignatures) != 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "unconfirmed bundle must not have commit signatures")
	}

	// clean up basic fields and do some checks
	if err := bundle.Problem.Normalize(now, bundle.ProblemSteps); err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "%v", err)
		return
	}

	// if this is an update to an existing problem, we need to check that some things match
	if bundle.Problem.ID != 0 {
		old := new(Problem)
		if err := meddler.Load(tx, "problems", old, int64(bundle.Problem.ID)); err != nil {
			if err == sql.ErrNoRows {
				loggedHTTPErrorf(w, http.StatusNotFound, "request to update problem %d, but that problem does not exist", bundle.Problem.ID)
			} else {
				loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
			}
			return
		}

		if bundle.Problem.Unique != old.Unique {
			loggedHTTPErrorf(w, http.StatusBadRequest, "updating a problem cannot change its unique ID from %q to %q; create a new problem instead", old.Unique, bundle.Problem.Unique)
			return
		}
		if bundle.Problem.ProblemType != old.ProblemType {
			loggedHTTPErrorf(w, http.StatusBadRequest, "updating a problem cannot change its type from %q to %q; create a new problem instead", old.ProblemType, bundle.Problem.ProblemType)
			return
		}
		if !bundle.Problem.CreatedAt.Equal(old.CreatedAt) {
			loggedHTTPErrorf(w, http.StatusBadRequest, "updating a problem cannot change its created time from %v to %v", old.CreatedAt, bundle.Problem.CreatedAt)
			return
		}
	} else {
		// for new problems, set the created timestamp to now
		bundle.Problem.CreatedAt = now
	}

	// make sure the unique ID is unique
	conflict := new(Problem)
	if err := meddler.QueryRow(tx, conflict, `SELECT * FROM problems WHERE unique_id = $1`, bundle.Problem.Unique); err != nil {
		if err == sql.ErrNoRows {
			conflict.ID = 0
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
			return
		}
	}
	if conflict.ID != 0 && conflict.ID != bundle.Problem.ID {
		loggedHTTPErrorf(w, http.StatusBadRequest, "unique ID %q is already in use by problem %d", bundle.Problem.Unique, conflict.ID)
		return
	}

	// update the timestamp
	bundle.Problem.UpdatedAt = now

	// compute signature
	bundle.ProblemSignature = bundle.Problem.ComputeSignature(Config.DaycareSecret, bundle.ProblemSteps)

	// check the commits
	whitelists := bundle.Problem.GetStepWhitelists(bundle.ProblemSteps)
	bundle.CommitSignatures = nil

	for n, commit := range bundle.Commits {
		commit.ID = 0
		commit.AssignmentID = 0
		commit.ProblemID = bundle.Problem.ID
		commit.Step = int64(n) + 1
		if commit.Action != "confirm" {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit %d has action %q, expected %q", n, commit.Action, "confirm")
			return
		}
		commit.Transcript = []*EventMessage{}
		commit.ReportCard = nil
		commit.Score = 0.0
		commit.CreatedAt = now
		commit.UpdatedAt = now
		if err := commit.Normalize(now, whitelists[n]); err != nil {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit %d: %v", n, err)
			return
		}

		// set timestamps and compute signature
		sig := commit.ComputeSignature(Config.DaycareSecret, bundle.ProblemSignature)
		bundle.CommitSignatures = append(bundle.CommitSignatures, sig)
	}

	render.JSON(http.StatusOK, &bundle)
}

// PostProblemSetBundle handles requests to /v2/problem_set/bundles,
// creating a new problem set.
func PostProblemSetBundle(w http.ResponseWriter, tx *sql.Tx, bundle ProblemSetBundle, render render.Render) {
	now := time.Now()

	if bundle.ProblemSet == nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "bundle must contain a problem set")
		return
	}
	set := bundle.ProblemSet
	if set.ID != 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "a new problem set must not have an ID")
		return
	}
	if len(bundle.ProblemIDs) == 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "a problem set must have at least one problem")
		return
	}
	if len(bundle.Weights) != len(bundle.ProblemIDs) {
		loggedHTTPErrorf(w, http.StatusBadRequest, "each problem must have exactly one associated weight")
		return
	}

	// clean up basic fields and do some checks
	if err := set.Normalize(now); err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "%v", err)
		return
	}

	// save the problem set object
	if err := meddler.Insert(tx, "problem_sets", set); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	// save the problem set problem list
	for i := 0; i < len(bundle.ProblemIDs); i++ {
		problemID, weight := bundle.ProblemIDs[i], bundle.Weights[i]
		if weight <= 0.0 {
			bundle.Weights[i] = 1.0
			weight = 1.0
		}
		psp := &ProblemSetProblem{
			ProblemSetID: set.ID,
			ProblemID:    problemID,
			Weight:       weight,
		}
		if err := meddler.Insert(tx, "problem_set_problems", psp); err != nil {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
			return
		}
	}

	log.Printf("problem set %s (%d) with %d problem(s) created", set.Unique, set.ID, len(bundle.ProblemIDs))

	render.JSON(http.StatusOK, bundle)
}
