package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"time"

	. "github.com/russross/codegrinder/types"
	"github.com/russross/meddler"
)

// signProblemBundleUnconfirmed signs a new/updated problem that has not yet been tested on the daycare.
// Authorization: currentUser must be logged in and an author.
func signProblemBundleUnconfirmed(tx *sql.Tx, currentUser *User, bundle *ProblemBundle) (*ProblemBundle, error) {
	now := time.Now()

	// basic sanity checks
	if bundle.ProblemTypes != nil && len(bundle.ProblemTypes) > 0 || bundle.ProblemTypeSignatures != nil && len(bundle.ProblemTypeSignatures) > 0 {
		return nil, fmt.Errorf("bundle must not include problem type")
	}
	if bundle.Problem == nil {
		return nil, fmt.Errorf("bundle must include the problem")
	}
	if len(bundle.ProblemSteps) == 0 {
		return nil, fmt.Errorf("problem must have at least one step")
	}
	if len(bundle.ProblemSteps) != len(bundle.Commits) {
		return nil, fmt.Errorf("problem must have exactly one commit for each step")
	}
	if len(bundle.ProblemSignature) != 0 {
		return nil, fmt.Errorf("unconfirmed bundle must not have problem signature")
	}
	if len(bundle.CommitSignatures) != 0 {
		return nil, fmt.Errorf("unconfirmed bundle must not have commit signatures")
	}
	if len(bundle.Hostname) != 0 {
		return nil, fmt.Errorf("unconfirmed bundle must not have daycare hostname")
	}
	if bundle.UserID != currentUser.ID {
		return nil, fmt.Errorf("user ID in problem bundle must match current user ID")
	}

	// provide the problem types with signatures
	bundle.ProblemTypes = make(map[string]*ProblemType)
	bundle.ProblemTypeSignatures = make(map[string]string)
	typeSet := make(map[string]bool)
	for _, step := range bundle.ProblemSteps {
		name := step.ProblemType
		if _, exists := typeSet[name]; !exists {
			problemType, err := getProblemType(tx, name)
			if err != nil {
				return nil, fmt.Errorf("error loading problem type %q: %v", name, err)
			}
			typeSet[name] = true
			bundle.ProblemTypes[name] = problemType
			bundle.ProblemTypeSignatures[name] = problemType.ComputeSignature(Config.DaycareSecret)
		}
	}

	// new problems are created and updated now
	// existing problems will have their created time verified after loading the old object
	if bundle.Problem.ID > 0 {
		bundle.Problem.UpdatedAt = now
	} else {
		bundle.Problem.CreatedAt = now
		bundle.Problem.UpdatedAt = now
	}

	// clean up basic fields and do some checks
	if err := bundle.Problem.Normalize(now, bundle.ProblemSteps); err != nil {
		return nil, err
	}

	// if this is an update to an existing problem, we need to check that some things match
	if bundle.Problem.ID != 0 {
		old := new(Problem)
		if err := meddler.Load(tx, "problems", old, int64(bundle.Problem.ID)); err != nil {
			if err == sql.ErrNoRows {
				return nil, fmt.Errorf("request to update problem %d, but that problem does not exist", bundle.Problem.ID)
			} else {
				return nil, fmt.Errorf("db error: %v", err)
			}
		}

		if bundle.Problem.Unique != old.Unique {
			return nil, fmt.Errorf("updating a problem cannot change its unique ID from %q to %q; create a new problem instead", old.Unique, bundle.Problem.Unique)
		}
		if !bundle.Problem.CreatedAt.Equal(old.CreatedAt) {
			return nil, fmt.Errorf("updating a problem cannot change its created time from %v to %v", old.CreatedAt, bundle.Problem.CreatedAt)
		}
	}

	// make sure the unique ID is unique
	conflict := new(Problem)
	if err := meddler.QueryRow(tx, conflict, `SELECT * FROM problems WHERE unique_id = ?`, bundle.Problem.Unique); err != nil {
		if err == sql.ErrNoRows {
			conflict.ID = 0
		} else {
			return nil, fmt.Errorf("db error: %v", err)
		}
	}
	if conflict.ID != 0 && conflict.ID != bundle.Problem.ID {
		return nil, fmt.Errorf("unique ID %q is already in use by problem %d", bundle.Problem.Unique, conflict.ID)
	}

	// update the timestamp
	bundle.Problem.UpdatedAt = now

	// compute signature
	bundle.ProblemSignature = bundle.Problem.ComputeSignature(Config.DaycareSecret, bundle.ProblemSteps)

	// assign a daycare host
	host, err := daycareRegistrations.Assign(typeSet)
	if err != nil {
		names := ""
		for name := range typeSet {
			if names != "" {
				names += ", "
			}
			names += name
		}
		return nil, fmt.Errorf("failed to find daycare for problem type(s) %s: %v", names, err)
	}
	bundle.Hostname = host

	// check the commits
	bundle.CommitSignatures = nil

	for n, commit := range bundle.Commits {
		commit.ID = 0
		commit.AssignmentID = 0
		commit.ProblemID = bundle.Problem.ID
		commit.Step = int64(n) + 1
		problemType := bundle.ProblemTypes[bundle.ProblemSteps[n].ProblemType]
		if _, exists := problemType.Actions[commit.Action]; !exists {
			return nil, fmt.Errorf("commit %d has action %q, which does not exist for problem type %s", n, commit.Action, problemType.Name)
		}
		commit.Transcript = []*EventMessage{}
		commit.ReportCard = nil
		commit.Score = 0.0
		commit.CreatedAt = now
		commit.UpdatedAt = now
		if err := commit.Normalize(now, bundle.ProblemSteps[n].Whitelist); err != nil {
			return nil, fmt.Errorf("commit %d: %v", n, err)
		}

		// set timestamps and compute signature
		sig := commit.ComputeSignature(Config.DaycareSecret, bundle.ProblemTypeSignatures[problemType.Name], bundle.ProblemSignature, bundle.Hostname, bundle.UserID)
		bundle.CommitSignatures = append(bundle.CommitSignatures, sig)
	}

	return bundle, nil
}

func saveProblemBundleCommon(tx *sql.Tx, currentUser *User, bundle *ProblemBundle) (*ProblemBundle, error) {
	now := time.Now()

	// clean up basic fields and do some checks
	problem, steps := bundle.Problem, bundle.ProblemSteps
	if err := problem.Normalize(now, steps); err != nil {
		return nil, err
	}

	// note: unique constraint will be checked by the database

	// make sure the set of problem types included matches the list of steps
	typeSet := make(map[string]bool)
	for _, elt := range bundle.ProblemSteps {
		typeSet[elt.ProblemType] = true
	}
	if len(typeSet) != len(bundle.ProblemTypeSignatures) {
		return nil, fmt.Errorf("problem bundle includes %d problem type signatures, but %d expected based on the step list",
			len(bundle.ProblemTypeSignatures), len(typeSet))
	}

	// gather canonical problem types and check signatures as we go
	bundle.ProblemTypes = make(map[string]*ProblemType)
	for name := range bundle.ProblemTypeSignatures {
		if !typeSet[name] {
			return nil, fmt.Errorf("the problem requires problem type %q but no signature provided for that type", name)
		}
		pt, err := getProblemType(tx, name)
		if err != nil {
			return nil, fmt.Errorf("loading problem type %q: %v", name, err)
		}
		bundle.ProblemTypes[name] = pt
		typeSig := pt.ComputeSignature(Config.DaycareSecret)
		if bundle.ProblemTypeSignatures[name] != typeSig {
			return nil, fmt.Errorf("problem type signature for %q does not check out: found %s but expected %s",
				name, bundle.ProblemTypeSignatures[name], typeSig)
		}
	}

	// verify the problem signature
	sig := problem.ComputeSignature(Config.DaycareSecret, steps)
	if sig != bundle.ProblemSignature {
		return nil, fmt.Errorf("problem signature does not check out: found %s but expected %s", bundle.ProblemSignature, sig)
	}

	// verify all the commits
	if len(steps) != len(bundle.Commits) {
		return nil, fmt.Errorf("problem must have exactly one commit for each problem step")
	}
	if len(bundle.CommitSignatures) != len(bundle.Commits) {
		return nil, fmt.Errorf("problem must have exactly one commit signature for each commit")
	}
	if bundle.UserID != currentUser.ID {
		return nil, fmt.Errorf("user ID in problem bundle must match current user ID")
	}
	for i, commit := range bundle.Commits {
		// check the commit signature
		csig := commit.ComputeSignature(Config.DaycareSecret, bundle.ProblemTypeSignatures[steps[i].ProblemType], bundle.ProblemSignature, bundle.Hostname, bundle.UserID)
		if csig != bundle.CommitSignatures[i] {
			return nil, fmt.Errorf("commit for step %d has a bad signature", commit.Step)
		}

		if commit.Step != steps[i].Step || commit.Step != int64(i+1) {
			return nil, fmt.Errorf("commit for step %d says it is for step %d", steps[i].Step, commit.Step)
		}

		// make sure this step passed
		if commit.Score != 1.0 || commit.ReportCard == nil || !commit.ReportCard.Passed {
			return nil, fmt.Errorf("commit for step %d did not pass", i+1)
		}

		// keep a copy of the solution
		steps[i].Solution = commit.Files
	}

	isUpdate, oldStepCount := false, 0
	if problem.ID != 0 {
		isUpdate = true

		// how many steps did the old version have?
		if err := tx.QueryRow(`SELECT COUNT(1) FROM problem_steps WHERE problem_id = ?`, problem.ID).Scan(&oldStepCount); err != nil {
			return nil, fmt.Errorf("db error: %v", err)
		}
	}
	if err := meddler.Save(tx, "problems", problem); err != nil {
		return nil, fmt.Errorf("db error: %v", err)
	}

	// insert/update all the new steps
	for _, step := range steps {
		step.ProblemID = problem.ID

		if step.Step > int64(oldStepCount) {
			// insert a new record
			if err := meddler.Insert(tx, "problem_steps", step); err != nil {
				return nil, fmt.Errorf("db error: %v", err)
			}
		} else {
			// update an existing record
			// meddler only understands integer primary keys, so we have to do it the long way
			filesJSON, err := json.Marshal(step.Files)
			if err != nil {
				return nil, fmt.Errorf("json encoding error for step.Files: %v", err)
			}
			whitelistJSON, err := json.Marshal(step.Whitelist)
			if err != nil {
				return nil, fmt.Errorf("json encoding error for step.Whitelist: %v", err)
			}
			solutionJSON, err := json.Marshal(step.Solution)
			if err != nil {
				return nil, fmt.Errorf("json encoding error for step.Solution: %v", err)
			}
			result, err := tx.Exec(`UPDATE problem_steps SET `+
				`problem_type=?, `+
				`note=?, `+
				`instructions=?, `+
				`weight=?, `+
				`files=?, `+
				`whitelist=?, `+
				`solution=? `+
				`WHERE problem_id=? AND step=?`,
				step.ProblemType,
				step.Note,
				step.Instructions,
				step.Weight,
				filesJSON,
				whitelistJSON,
				solutionJSON,
				step.ProblemID,
				step.Step)
			if err != nil {
				return nil, fmt.Errorf("db error: %v", err)
			}
			affected, err := result.RowsAffected()
			if err != nil {
				return nil, fmt.Errorf("db error testing rows affected by update: %v", err)
			}
			if affected != 1 {
				return nil, fmt.Errorf("expected 1 row up be updated, found %d", affected)
			}
		}
	}

	// delete any extra steps from the old version
	if len(steps) < oldStepCount {
		if _, err := tx.Exec(`DELETE FROM problem_steps WHERE problem_id = ? AND step > ?`, problem.ID, len(steps)); err != nil {
			return nil, fmt.Errorf("db error: %v", err)
		}
	}

	if isUpdate {
		log.Printf("problem %s (%d) with %d step(s) updated", problem.Unique, problem.ID, len(steps))
	} else {
		log.Printf("problem %s (%d) with %d step(s) created", problem.Unique, problem.ID, len(steps))
	}

	return bundle, nil
}

// updateProblemBundle updates an existing problem bundle.
// Authorization: currentUser must be logged in and an author.
func updateProblemBundle(tx *sql.Tx, currentUser *User, problemID int64, bundle *ProblemBundle) (*ProblemBundle, error) {
	if bundle.Problem == nil {
		return nil, fmt.Errorf("bundle must contain a problem")
	}
	if bundle.Problem.ID <= 0 {
		return nil, fmt.Errorf("updated problem must have ID > 0")
	}
	if bundle.Problem.ID != problemID {
		return nil, fmt.Errorf("problem ID in URL (%d) does not match problem ID in bundle (%d)", problemID, bundle.Problem.ID)
	}

	old := new(Problem)
	if err := meddler.Load(tx, "problems", old, bundle.Problem.ID); err != nil {
		return nil, err
	}
	if bundle.Problem.Unique != old.Unique {
		return nil, fmt.Errorf("updating a problem cannot change its unique ID from %q to %q; create a new problem instead", old.Unique, bundle.Problem.Unique)
	}
	if !bundle.Problem.CreatedAt.Equal(old.CreatedAt) {
		return nil, fmt.Errorf("updating a problem cannot change its created time from %v to %v", old.CreatedAt, bundle.Problem.CreatedAt)
	}

	var assignmentCount int
	if err := tx.QueryRow(
		`SELECT COUNT(1) `+
			`FROM assignments `+
			`INNER JOIN problem_sets ON assignments.problem_set_id = problem_sets.id `+
			`INNER JOIN problem_set_problems ON problem_sets.id = problem_set_problems.problem_set_id `+
			`WHERE problem_set_problems.problem_id = ?`,
		bundle.Problem.ID).Scan(&assignmentCount); err != nil {
		return nil, fmt.Errorf("db error: %v", err)
	}
	if assignmentCount > 0 {
		// if this is an active problem, it must have the same number of steps
		// and steps must be of the same problem types
		var oldSteps []*ProblemStep
		if err := meddler.QueryAll(tx, &oldSteps, `SELECT * FROM problem_steps WHERE problem_id = ?`, bundle.Problem.ID); err != nil {
			return nil, fmt.Errorf("db error: %v", err)
		}
		if len(bundle.ProblemSteps) != len(oldSteps) {
			return nil, fmt.Errorf("cannot change the number of steps in a problem that is already in use")
		}
		for i := 0; i < len(oldSteps); i++ {
			if bundle.ProblemSteps[i].ProblemType != oldSteps[i].ProblemType {
				return nil, fmt.Errorf("cannot change the problem type of step %d in a problem that is already in use", i+1)
			}
		}
	}

	return saveProblemBundleCommon(tx, currentUser, bundle)
}

// createProblemSetBundle creates a new problem set.
// Authorization: currentUser must be logged in and an author.
func createProblemSetBundle(tx *sql.Tx, bundle *ProblemSetBundle) (*ProblemSetBundle, error) {
	now := time.Now()

	if bundle.ProblemSet == nil {
		return nil, fmt.Errorf("bundle must contain a problem set")
	}
	set := bundle.ProblemSet
	if set.ID != 0 {
		return nil, fmt.Errorf("a new problem set must not have an ID")
	}
	if len(bundle.ProblemSetProblems) == 0 {
		return nil, fmt.Errorf("a problem set must have at least one problem")
	}

	// clean up basic fields and do some checks
	set.CreatedAt = now
	set.UpdatedAt = now
	if err := set.Normalize(now); err != nil {
		return nil, err
	}

	// save the problem set object
	if err := meddler.Insert(tx, "problem_sets", set); err != nil {
		return nil, fmt.Errorf("db error: %v", err)
	}

	// save the problem set problem list
	for _, psp := range bundle.ProblemSetProblems {
		psp.ProblemSetID = set.ID
		if psp.Weight <= 0.0 {
			psp.Weight = 1.0
		}
		if err := meddler.Insert(tx, "problem_set_problems", psp); err != nil {
			return nil, fmt.Errorf("db error: %v", err)
		}
	}

	log.Printf("problem set %s (%d) with %d problem(s) created", set.Unique, set.ID, len(bundle.ProblemSetProblems))

	return bundle, nil
}

// updateProblemSetBundle updates an existing problem set.
// Authorization: currentUser must be logged in and an author.
func updateProblemSetBundle(tx *sql.Tx, bundle *ProblemSetBundle) (*ProblemSetBundle, error) {
	now := time.Now()

	if bundle.ProblemSet == nil {
		return nil, fmt.Errorf("bundle must contain a problem set")
	}
	set := bundle.ProblemSet
	if set.ID <= 0 {
		return nil, fmt.Errorf("updated problem set must have ID > 0")
	}
	if len(bundle.ProblemSetProblems) == 0 {
		return nil, fmt.Errorf("a problem set must have at least one problem")
	}

	// get the old problem set and check for illegal changes
	old := new(ProblemSet)
	if err := meddler.Load(tx, "problem_sets", old, set.ID); err != nil {
		return nil, err
	}
	if set.Unique != old.Unique {
		return nil, fmt.Errorf("updating a problem set cannot change its unique ID from %q to %q; create a new problem set instead", old.Unique, set.Unique)
	}
	if !set.CreatedAt.Equal(old.CreatedAt) {
		return nil, fmt.Errorf("updating a problem set cannot change its created time from %v to %v", old.CreatedAt, set.CreatedAt)
	}

	// clean up basic fields and do some checks
	set.UpdatedAt = now
	if err := set.Normalize(now); err != nil {
		return nil, err
	}

	// get the list of problems
	var oldPSPs []*ProblemSetProblem
	if err := meddler.QueryAll(tx, &oldPSPs, `SELECT * FROM problem_set_problems WHERE problem_set_id = ? ORDER BY problem_id`, set.ID); err != nil {
		return nil, fmt.Errorf("db error: %v", err)
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
	if err := tx.QueryRow(`SELECT COUNT(1) FROM assignments WHERE problem_set_id = ?`, set.ID).Scan(&assignmentCount); err != nil {
		return nil, fmt.Errorf("db error: %v", err)
	}
	if assignmentCount > 0 && changes {
		return nil, fmt.Errorf("cannot change the set of problems in a problem set that is already in use")
	}

	// save the updated problem set object
	if err := meddler.Update(tx, "problem_sets", set); err != nil {
		return nil, fmt.Errorf("db error: %v", err)
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
			if _, err := tx.Exec(`DELETE FROM problem_set_problems WHERE problem_set_id = ? AND problem_id = ?`, oldPSP.ProblemSetID, oldPSP.ProblemID); err != nil {
				return nil, fmt.Errorf("db error: %v", err)
			}
			i++
		case newPSP != nil && (oldPSP == nil || oldPSP.ProblemID > newPSP.ProblemID):
			// insert the new entry
			newPSP.ProblemSetID = set.ID
			if err := meddler.Insert(tx, "problem_set_problems", newPSP); err != nil {
				return nil, fmt.Errorf("db error: %v", err)
			}
			j++
		default:
			// update the entry in place (if it has changed)
			if oldPSP.Weight != newPSP.Weight {
				if _, err := tx.Exec(`UPDATE problem_set_problems SET weight = ? WHERE problem_set_id = ? AND problem_id = ?`, newPSP.Weight, set.ID, oldPSP.ProblemID); err != nil {
					return nil, fmt.Errorf("db error: %v", err)
				}
			}
			i++
			j++
		}
	}

	log.Printf("problem set %s (%d) with %d problem(s) updated", set.Unique, set.ID, len(bundle.ProblemSetProblems))

	return bundle, nil
}
