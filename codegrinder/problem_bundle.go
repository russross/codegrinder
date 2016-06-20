package main

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/martini-contrib/render"
	. "github.com/russross/codegrinder/types"
	"github.com/russross/meddler"
)

// PostProblem handles a request to /v2/problems,
// creating a new problem.
// Confirmed must be false, and the problem must have a full set of passing commits signed by the daycare.
/*
func PostProblem(w http.ResponseWriter, tx *sql.Tx, problem Problem, render render.Render) {
	if problem.ID != 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "new problem cannot already have a problem ID")
		return
	}

	saveProblemCommon(w, tx, &problem, render)
}
*/

// PutProblem handles a request to /v2/problems/:problem_id,
// updating an existing problem.
// Confirmed must be false, and the problem must have a full set of passing commits signed by the daycare.
// If any assignments exist that refer to this problem, then the updates cannot change the number
// of steps in the problem.
/*
func PutProblem(w http.ResponseWriter, tx *sql.Tx, params martini.Params, problem Problem, render render.Render) {
	if problem.ID <= 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "updated problem must have ID > 0")
		return
	}

	old := new(Problem)
	if err := meddler.Load(tx, "problems", old, problem.ID); err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}
	if problem.Unique != old.Unique {
		loggedHTTPErrorf(w, http.StatusBadRequest, "updating a problem cannot change its unique ID from %q to %q; create a new problem instead", old.Unique, problem.Unique)
		return
	}
	if problem.ProblemType != old.ProblemType {
		loggedHTTPErrorf(w, http.StatusBadRequest, "updating a problem cannot change its type from %q to %q; create a new problem instead", old.ProblemType, problem.ProblemType)
		return
	}
	if !problem.CreatedAt.Equal(old.CreatedAt) {
		loggedHTTPErrorf(w, http.StatusBadRequest, "updating a problem cannot change its created time from %v to %v", old.CreatedAt, problem.CreatedAt)
		return
	}

	var assignmentCount int
	if err := tx.QueryRow(`SELECT COUNT(1) FROM assignments WHERE problem_id = $1`, problem.ID).Scan(&assignmentCount); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
	if assignmentCount > 0 && len(problem.Steps) != len(old.Steps) {
		loggedHTTPErrorf(w, http.StatusBadRequest, "cannot change the number of steps in a problem that is already in use")
		return
	}

	saveProblemCommon(w, tx, &problem, render)
}
*/

/*
func saveProblemCommon(w http.ResponseWriter, tx *sql.Tx, problem *Problem, steps []*ProblemStep, render render.Render) {
	now := time.Now()

	// clean up basic fields and do some checks
	if err := problem.normalize(now, steps); err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "%v", err)
		return
	}

	// confirmed must be false
	if problem.Confirmed {
		loggedHTTPErrorf(w, http.StatusBadRequest, "only unconfirmed problems can be saved")
		return
	}

	// note: unique constraint will be checked by the database

	// verify the signature
	sig := problem.computeSignature(Config.DaycareSecret)
	if sig != problem.Signature {
		loggedHTTPErrorf(w, http.StatusBadRequest, "problem signature does not check out: found %s but expected %s", problem.Signature, sig)
		return
	}

	// verify all the commits
	if len(problem.Steps) != len(problem.Commits) {
		loggedHTTPErrorf(w, http.StatusBadRequest, "problem must have exactly one commit for each problem step")
		return
	}
	for i, commit := range problem.Commits {
		// check the commit signature
		csig := commit.computeSignature(Config.DaycareSecret)
		if csig != commit.Signature {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit for step %d has a bad signature", i+1)
			return
		}

		// make sure it refers to the right step of this problem
		if commit.ProblemSignature != problem.Signature {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit for step %d does not match this problem", i+1)
			return
		}
		if commit.Step != i {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit for step %d says it is for step %d", i, commit.Step)
			return
		}

		// make sure this step passed
		if commit.Score != 1.0 || commit.ReportCard == nil || !commit.ReportCard.Passed {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit for step %d did not pass", i+1)
			return
		}
	}

	// save it with current timestamp and updated signature
	problem.CreatedAt = now
	problem.UpdatedAt = now
	problem.Commits = nil
	problem.Confirmed = true
	problem.Signature = problem.computeSignature(Config.DaycareSecret)
	log.Printf("%s is signature at save time", problem.Signature)
	time.Sleep(3 * time.Second)
	log.Printf("%s is signature recomputed", problem.computeSignature(Config.DaycareSecret))
	raw, _ := json.Marshal(problem)
	jsonproblem := new(Problem)
	json.Unmarshal(raw, jsonproblem)
	time.Sleep(3 * time.Second)
	log.Printf("%s is signature after JSON round trip", jsonproblem.computeSignature(Config.DaycareSecret))

	if err := meddler.Save(tx, "problems", problem); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	dbproblem := new(Problem)
	meddler.Load(tx, "problems", dbproblem, int64(problem.ID))
	time.Sleep(3 * time.Second)
	log.Printf("%s is signature after DB round trip", dbproblem.computeSignature(Config.DaycareSecret))

	// return it with updated signature
	render.JSON(http.StatusOK, problem)
}
*/

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
		sig := commit.ComputeSignature(Config.DaycareSecret)
		bundle.CommitSignatures = append(bundle.CommitSignatures, sig)
	}

	render.JSON(http.StatusOK, &bundle)
}
