package main

import . "github.com/russross/codegrinder/types"

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

// PostProblemUnconfirmed handles a request to /v2/problems/unconfirmed,
// signing a new/updated problem that has not yet been tested on the daycare.
/*
func PostProblemUnconfirmed(w http.ResponseWriter, tx *sql.Tx, currentUser *User, problem Problem, render render.Render) {
	now := time.Now()

	// clean up basic fields and do some checks
	if err := problem.normalize(now); err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "%v", err)
		return
	}

	// confirmed must be false
	if problem.Confirmed {
		loggedHTTPErrorf(w, http.StatusBadRequest, "a problem must not claim to be confirmed when preparing it to be confirmed")
		return
	}

	// if this is an update to an existing problem, we need to check that some things match
	if problem.ID != 0 {
		old := new(Problem)
		if err := meddler.Load(tx, "problems", old, int64(problem.ID)); err != nil {
			if err == sql.ErrNoRows {
				loggedHTTPErrorf(w, http.StatusNotFound, "request to update problem %d, but that problem does not exist", problem.ID)
			} else {
				loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
			}
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
	} else {
		// for new problems, set the timestamps to now
		problem.CreatedAt = now
		problem.UpdatedAt = now
	}

	// make sure the unique ID is unique
	conflict := new(Problem)
	if err := meddler.QueryRow(tx, conflict, `SELECT * FROM problems WHERE unique_id = $1`, problem.Unique); err != nil {
		if err == sql.ErrNoRows {
			conflict.ID = 0
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
			return
		}
	}
	if conflict.ID != 0 && conflict.ID != problem.ID {
		loggedHTTPErrorf(w, http.StatusBadRequest, "unique ID %q is already in use by problem %d", problem.Unique, conflict.ID)
		return
	}

	// timestamps
	problem.UpdatedAt = now

	// compute signature
	problem.Signature = problem.computeSignature(Config.DaycareSecret)

	// check the commits
	if len(problem.Commits) != len(problem.Steps) {
		loggedHTTPErrorf(w, http.StatusBadRequest, "found %d commits for %d steps; must have the same number of commits as steps", len(problem.Commits), len(problem.Steps))
		return
	}

	whitelists := getStepWhitelists(&problem)

	for n, commit := range problem.Commits {
		commit.ID = 0
		commit.AssignmentID = 0
		if commit.ProblemStepNumber != n {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit %d has ProblemStepNumber of %d", n, commit.ProblemStepNumber)
			return
		}
		commit.UserID = currentUser.ID
		if commit.Action != "confirm" {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit %d has action %q, expected %q", n, commit.Action, "confirm")
			return
		}
		if err := commit.normalize(now, whitelists[n]); err != nil {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit %d: %v", n, err)
			return
		}

		// set timestamps and compute signature
		commit.CreatedAt = now
		commit.UpdatedAt = now
		commit.ProblemSignature = problem.Signature
		commit.Signature = commit.computeSignature(Config.DaycareSecret)
	}

	render.JSON(http.StatusOK, &problem)
}
*/
