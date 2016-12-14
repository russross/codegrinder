package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"sort"
	"time"

	"github.com/go-martini/martini"
	"github.com/martini-contrib/render"
	. "github.com/russross/codegrinder/common"
	"github.com/russross/meddler"
)

// PostProblemBundleConfirmed handles a request to /v2/problem_bundles/confirmed,
// creating a new problem.
// The bundle must have a full set of passing commits signed by the daycare.
func PostProblemBundleConfirmed(w http.ResponseWriter, tx *sql.Tx, currentUser *User, bundle ProblemBundle, render render.Render) {
	if bundle.Problem == nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "bundle must contain a problem")
		return
	}
	if bundle.Problem.ID != 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "new problem cannot already have a problem ID")
		return
	}

	saveProblemBundleCommon(w, tx, currentUser, &bundle, render)
}

// PutProblemBundle handles a request to /v2/problem_bundles/:problem_id,
// updating an existing problem.
// The bundle must have a full set of passing commits signed by the daycare.
// If any assignments exist that refer to this problem, then the updates cannot change the number
// of steps in the problem.
func PutProblemBundle(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, bundle ProblemBundle, render render.Render) {
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

	saveProblemBundleCommon(w, tx, currentUser, &bundle, render)
}

func saveProblemBundleCommon(w http.ResponseWriter, tx *sql.Tx, currentUser *User, bundle *ProblemBundle, render render.Render) {
	now := time.Now()

	// clean up basic fields and do some checks
	problem, steps := bundle.Problem, bundle.ProblemSteps
	if err := problem.Normalize(now, steps); err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "%v", err)
		return
	}

	// note: unique constraint will be checked by the database

	// verify the problem type signature
	// note: we only need problem type signature, the problem type can be nil
	typeSig := bundle.ProblemType.ComputeSignature(Config.DaycareSecret)
	if bundle.ProblemTypeSignature != typeSig {
		loggedHTTPErrorf(w, http.StatusBadRequest, "problem type signature does not check out: found %s but expected %s", bundle.ProblemTypeSignature, typeSig)
		return
	}

	// verify the problem signature
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
	if bundle.UserID != currentUser.ID {
		loggedHTTPErrorf(w, http.StatusBadRequest, "user ID in problem bundle must match current user ID")
		return
	}
	for i, commit := range bundle.Commits {
		// check the commit signature
		csig := commit.ComputeSignature(Config.DaycareSecret, bundle.ProblemTypeSignature, bundle.ProblemSignature, bundle.Hostname, bundle.UserID)
		if csig != bundle.CommitSignatures[i] {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit for step %d has a bad signature", commit.Step)
			return
		}

		if commit.Step != steps[i].Step || commit.Step != int64(i+1) {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit for step %d says it is for step %d", steps[i].Step, commit.Step)
			return
		}

		// make sure this step passed
		if commit.Score != 1.0 || commit.ReportCard == nil || !commit.ReportCard.Passed {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit for step %d did not pass", i+1)
			return
		}
	}

	isUpdate, oldStepCount := false, 0
	if problem.ID != 0 {
		isUpdate = true

		// how many steps did the old version have?
		if err := tx.QueryRow(`SELECT COUNT(1) FROM problem_steps WHERE problem_id = $1`, problem.ID).Scan(&oldStepCount); err != nil {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
			return
		}
	}
	if err := meddler.Save(tx, "problems", problem); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
	for _, step := range steps {
		step.ProblemID = problem.ID

		// is this an update to an existing step?
		if step.Step <= int64(oldStepCount) {
			// meddler does not understand updating rows without a single integer primary key
			raw, err := json.Marshal(step.Files)
			if err != nil {
				loggedHTTPErrorf(w, http.StatusInternalServerError, "json error: %v", err)
				return
			}
			if _, err = tx.Exec(`UPDATE problem_steps SET note=$1,instructions=$2,weight=$3,files=$4 WHERE problem_id=$5 AND step=$6`,
				step.Note, step.Instructions, step.Weight, raw, step.ProblemID, step.Step); err != nil {
				loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
				return
			}
		} else {
			// insert a new record
			if err := meddler.Insert(tx, "problem_steps", step); err != nil {
				loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
				return
			}
		}
	}

	// did the old version have extra steps that need to be deleted?
	if len(steps) < oldStepCount {
		if _, err := tx.Exec(`DELETE FROM problem_steps WHERE problem_id = $1 AND step > $2`, problem.ID, len(steps)); err != nil {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
			return
		}
	}
	if isUpdate && len(steps) == oldStepCount {
		log.Printf("problem %s (%d) with %d step(s) updated", problem.Unique, problem.ID, len(steps))
	} else if isUpdate {
		log.Printf("problem %s (%d) with %d step(s) updated (old version had %d step(s))", problem.Unique, problem.ID, len(steps), oldStepCount)
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
	if bundle.ProblemType != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "bundle must not include problem type")
		return
	}
	if bundle.Problem == nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "bundle must include the problem")
		return
	}
	if len(bundle.ProblemSteps) == 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "problem must have at least one step")
		return
	}
	if len(bundle.ProblemSteps) != len(bundle.Commits) {
		loggedHTTPErrorf(w, http.StatusBadRequest, "problem must have exactly one commit for each step")
		return
	}
	if len(bundle.ProblemSignature) != 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "unconfirmed bundle must not have problem signature")
		return
	}
	if len(bundle.CommitSignatures) != 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "unconfirmed bundle must not have commit signatures")
		return
	}
	if len(bundle.Hostname) != 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "unconfirmed bundle must not have daycare hostname")
		return
	}
	if bundle.UserID != currentUser.ID {
		loggedHTTPErrorf(w, http.StatusBadRequest, "user ID in problem bundle must match current user ID")
		return
	}

	// provide the problem type
	problemType, err := getProblemType(tx, bundle.Problem.ProblemType)
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error loading problem type: %v", err)
		return
	}
	bundle.ProblemType = problemType
	bundle.ProblemTypeSignature = problemType.ComputeSignature(Config.DaycareSecret)

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

	// assign a daycare host
	host, err := daycareRegistrations.Assign(bundle.Problem.ProblemType)
	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError,
			"failed to find daycare for problem type %s: %v", bundle.Problem.ProblemType, err)
		return
	}
	bundle.Hostname = host

	// check the commits
	whitelists := bundle.Problem.GetStepWhitelists(bundle.ProblemSteps)
	bundle.CommitSignatures = nil

	for n, commit := range bundle.Commits {
		commit.ID = 0
		commit.AssignmentID = 0
		commit.ProblemID = bundle.Problem.ID
		commit.Step = int64(n) + 1
		if _, exists := problemType.Actions[commit.Action]; !exists {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit %d has action %q, which does not exist for problem type %s", n, commit.Action, problemType.Name)
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
		sig := commit.ComputeSignature(Config.DaycareSecret, bundle.ProblemTypeSignature, bundle.ProblemSignature, bundle.Hostname, bundle.UserID)
		bundle.CommitSignatures = append(bundle.CommitSignatures, sig)
	}

	render.JSON(http.StatusOK, &bundle)
}

// PostProblemSetBundle handles requests to /v2/problem_set_bundles,
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
	if len(bundle.ProblemSetProblems) == 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "a problem set must have at least one problem")
		return
	}

	// clean up basic fields and do some checks
	set.CreatedAt = now
	set.UpdatedAt = now
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
	for _, psp := range bundle.ProblemSetProblems {
		psp.ProblemSetID = set.ID
		if psp.Weight <= 0.0 {
			psp.Weight = 1.0
		}
		if err := meddler.Insert(tx, "problem_set_problems", psp); err != nil {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
			return
		}
	}

	log.Printf("problem set %s (%d) with %d problem(s) created", set.Unique, set.ID, len(bundle.ProblemSetProblems))

	render.JSON(http.StatusOK, bundle)
}

// PutProblemSetBundle handles requests to /v2/problem_set_bundles/:problem_set_id,
// updating an existing problem set.
func PutProblemSetBundle(w http.ResponseWriter, tx *sql.Tx, bundle ProblemSetBundle, render render.Render) {
	now := time.Now()

	if bundle.ProblemSet == nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "bundle must contain a problem set")
		return
	}
	set := bundle.ProblemSet
	if set.ID <= 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "updated problem set must have ID > 0")
		return
	}
	if len(bundle.ProblemSetProblems) == 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "a problem set must have at least one problem")
		return
	}

	// get the old problem set and check for illegal changes
	old := new(ProblemSet)
	if err := meddler.Load(tx, "problem_sets", old, set.ID); err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}
	if set.Unique != old.Unique {
		loggedHTTPErrorf(w, http.StatusBadRequest, "updating a problem set cannot change its unique ID from %q to %q; create a new problem set instead", old.Unique, set.Unique)
		return
	}
	if !set.CreatedAt.Equal(old.CreatedAt) {
		loggedHTTPErrorf(w, http.StatusBadRequest, "updating a problem set cannot change its created time from %v to %v", old.CreatedAt, set.CreatedAt)
		return
	}

	// clean up basic fields and do some checks
	set.UpdatedAt = now
	if err := set.Normalize(now); err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "%v", err)
		return
	}

	// get the list of problems
	var oldPSPs []*ProblemSetProblem
	if err := meddler.QueryAll(tx, &oldPSPs, `SELECT * FROM problem_set_problems WHERE problem_set_id = $1 ORDER BY problem_id`, set.ID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	sort.Slice(bundle.ProblemSetProblems, func(i, j int) bool {
		return bundle.ProblemSetProblems[i].ProblemID < bundle.ProblemSetProblems[j].ProblemID
	})

	// any changes in the set of problems?
	// note: changes to the weights are okay
	changes := len(oldPSPs) != len(bundle.ProblemSetProblems)
	for i := 0; !changes && i < len(oldPSPs); i++ {
		changes = oldPSPs[i].ProblemID != bundle.ProblemSetProblems[i].ProblemID
	}

	// cannot change the set of problems for a set that is already assigned
	var assignmentCount int
	if err := tx.QueryRow(`SELECT COUNT(1) FROM assignments WHERE problem_set_id = $1`, set.ID).Scan(&assignmentCount); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
	if assignmentCount > 0 && changes {
		loggedHTTPErrorf(w, http.StatusBadRequest, "cannot change the set of problems in a problem set that is already in use")
		return
	}

	// save the updated problem set object
	if err := meddler.Update(tx, "problem_sets", set); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	// walk through the two lists of problems in step, updating the database as needed
	i, j := 0, 0
	for i < len(oldPSPs) || j < len(bundle.ProblemSetProblems) {
		var oldPSP, newPSP *ProblemSetProblem
		if i < len(oldPSPs) {
			oldPSP = oldPSPs[i]
		}
		if j < len(bundle.ProblemSetProblems) {
			newPSP = bundle.ProblemSetProblems[j]
			newPSP.ProblemSetID = set.ID
			if newPSP.Weight <= 0.0 {
				newPSP.Weight = 1.0
			}
		}

		switch {
		case oldPSP != nil && (newPSP == nil || newPSP.ProblemID > oldPSP.ProblemID):
			// delete the old entry
			if _, err := tx.Exec(`DELETE FROM problem_set_problems WHERE problem_set_id = $1 AND problem_id = $2`, oldPSP.ProblemSetID, oldPSP.ProblemID); err != nil {
				loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
				return
			}
			i++
		case newPSP != nil && (oldPSP == nil || oldPSP.ProblemID > newPSP.ProblemID):
			// insert the new entry
			newPSP.ProblemSetID = set.ID
			if err := meddler.Insert(tx, "problem_set_problems", newPSP); err != nil {
				loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
				return
			}
			j++
		default:
			// update the entry in place (if it has changed)
			if oldPSP.Weight != newPSP.Weight {
				if _, err := tx.Exec(`UPDATE problem_set_problems SET weight = $1 WHERE problem_set_id = $2 AND problem_id = $3`, newPSP.Weight, set.ID, oldPSP.ProblemID); err != nil {
					loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
					return
				}
			}
			i++
			j++
		}
	}

	log.Printf("problem set %s (%d) with %d problem(s) updated", set.Unique, set.ID, len(bundle.ProblemSetProblems))

	render.JSON(http.StatusOK, bundle)
}
