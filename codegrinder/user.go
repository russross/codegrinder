package main

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-martini/martini"
	"github.com/martini-contrib/render"
	. "github.com/russross/codegrinder/types"
	"github.com/russross/meddler"
)

// GetCourses handles /v2/courses requests,
// returning a list of all courses.
//
// If parameter lti_label=<...> present, results will be filtered by matching lti_label field.
// If parameter name=<...> present, results will be filtered by case-insensitive substring matching on name field.
func GetCourses(w http.ResponseWriter, r *http.Request, tx *sql.Tx, currentUser *User, render render.Render) {
	where := ""
	args := []interface{}{}

	if ltiLabel := r.FormValue("lti_label"); ltiLabel != "" {
		where, args = addWhereEq(where, args, "lti_label", ltiLabel)
	}

	if name := r.FormValue("name"); name != "" {
		where, args = addWhereLike(where, args, "name", name)
	}

	courses := []*Course{}
	var err error

	if currentUser.Admin {
		err = meddler.QueryAll(tx, &courses, `SELECT * FROM courses`+where+` ORDER BY lti_label`, args...)
	} else {
		where, args = addWhereEq(where, args, "assignments.user_id", currentUser.ID)
		err = meddler.QueryAll(tx, &courses, `SELECT DISTINCT courses.* `+
			`FROM courses JOIN assignments ON courses.id = assignments.course_id`+
			where+` ORDER BY lti_label`, args...)
	}

	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
	render.JSON(http.StatusOK, courses)
}

// GetCourse handles /v2/courses/:course_id requests,
// returning a single course.
func GetCourse(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	courseID, err := parseID(w, "course_id", params["course_id"])
	if err != nil {
		return
	}

	course := new(Course)

	if currentUser.Admin {
		err = meddler.Load(tx, "courses", course, courseID)
	} else {
		err = meddler.QueryRow(tx, course, `SELECT courses.* `+
			`FROM courses JOIN assignments ON courses.id = assignments.course_id `+
			`WHERE assignments.user_id = $1 AND assignments.course_id = $2`,
			currentUser.ID, courseID)
	}

	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}
	render.JSON(http.StatusOK, course)
}

// DeleteCourse handles /v2/courses/:course_id requests,
// deleting a single course.
// This will also delete all assignments and commits related to the course.
func DeleteCourse(w http.ResponseWriter, tx *sql.Tx, params martini.Params) {
	courseID, err := parseID(w, "course_id", params["course_id"])
	if err != nil {
		return
	}

	if _, err := tx.Exec(`DELETE FROM courses WHERE id = $1`, courseID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
}

// GetUsers handles /v2/users requests,
// returning a list of all users.
//
// If parameter name=<...> present, results will be filtered by case-insensitive substring match on Name field.
// If parameter email=<...> present, results will be filtered by case-insensitive substring match on Email field.
// If parameter instructor=<...> present, results will be filtered matching instructor field (true or false).
// If parameter admin=<...> present, results will be filtered matching admin field (true or false).
func GetUsers(w http.ResponseWriter, r *http.Request, tx *sql.Tx, currentUser *User, render render.Render) {
	// build search terms
	where := ""
	args := []interface{}{}

	if name := r.FormValue("name"); name != "" {
		where, args = addWhereLike(where, args, "name", name)
	}

	if email := r.FormValue("email"); email != "" {
		where, args = addWhereLike(where, args, "email", email)
	}

	if instructor := r.FormValue("instructor"); instructor != "" {
		val, err := strconv.ParseBool(instructor)
		if err != nil {
			loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing instructor value as boolean: %v", err)
			return
		}
		where, args = addWhereEq(where, args, "instructor", val)
	}

	if admin := r.FormValue("admin"); admin != "" {
		val, err := strconv.ParseBool(admin)
		if err != nil {
			loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing admin value as boolean: %v", err)
			return
		}
		where, args = addWhereEq(where, args, "admin", val)
	}

	users := []*User{}
	var err error

	if currentUser.Admin {
		err = meddler.QueryAll(tx, &users, `SELECT * FROM users`+where+` ORDER BY id`, args...)
	} else {
		where, args = addWhereEq(where, args, "user_users.user_id", currentUser.ID)
		err = meddler.QueryAll(tx, &users, `SELECT users.* `+
			`FROM users JOIN user_users ON users.id = user_users.other_user_id`+
			where+` ORDER BY id`, args...)
	}

	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
	render.JSON(http.StatusOK, users)
}

// GetUserMe handles /v2/users/me requests,
// returning the current user.
func GetUserMe(w http.ResponseWriter, tx *sql.Tx, currentUser *User, render render.Render) {
	render.JSON(http.StatusOK, currentUser)
}

// GetUserMeCookie handlers /v2/users/me/cookie requests,
// returning the cookie for the current user session.
func GetUserMeCookie(w http.ResponseWriter, r *http.Request) {
	cookie := r.Header.Get("Cookie")
	for _, field := range strings.Fields(cookie) {
		if strings.HasPrefix(field, CookieName+"=") {
			fmt.Fprintf(w, "%s", field)
		}
	}
}

// GetUser handles /v2/users/:user_id requests,
// returning a single user.
func GetUser(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	userID, err := parseID(w, "user_id", params["user_id"])
	if err != nil {
		return
	}

	user := new(User)

	if currentUser.Admin {
		err = meddler.Load(tx, "users", user, int64(userID))
	} else {
		err = meddler.QueryRow(tx, &user, `SELECT users.* `+
			`FROM users JOIN user_users ON users.id = user_users.other_user_id `+
			`WHERE user_users.user_id = $1 AND user_users.other_user_id = $2`,
			currentUser.ID, userID)
	}

	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}
	render.JSON(http.StatusOK, user)
}

// GetCourseUsers handles request to /v2/course/:course_id/users,
// returning a list of users in the given course.
func GetCourseUsers(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	courseID, err := parseID(w, "course_id", params["course_id"])
	if err != nil {
		return
	}

	users := []*User{}

	if currentUser.Admin {
		err = meddler.QueryAll(tx, &users, `SELECT DISTINCT users.* `+
			`FROM users JOIN assignments ON users.id = assignments.user_id `+
			`WHERE assignments.course_id = $1 ORDER BY users.id`,
			courseID)
	} else {
		err = meddler.QueryAll(tx, &users, `SELECT DISTINCT users.* `+
			`FROM users JOIN assignments ON users.id = assignments.user_id `+
			`JOIN user_users ON assignments.user_id = user_users.other_user_id `+
			`WHERE assignments.course_id = $1 AND user_users.user_id = $2 `+
			`ORDER BY users.id`,
			courseID, currentUser.ID)
	}

	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	if len(users) == 0 {
		loggedHTTPErrorf(w, http.StatusNotFound, "not found")
		return
	}

	render.JSON(http.StatusOK, users)
}

// DeleteUser handles /v2/users/:user_id requests,
// deleting a single user.
// This will also delete all assignments and commits related to the user.
func DeleteUser(w http.ResponseWriter, tx *sql.Tx, params martini.Params) {
	userID, err := parseID(w, "user_id", params["user_id"])
	if err != nil {
		return
	}

	if _, err := tx.Exec(`DELETE FROM users WHERE id = $1`, userID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
}

// GetUserAssignments handles requests to /v2/users/:user_id/assignments,
// returning a list of assignments for the given user.
func GetUserAssignments(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	userID, err := parseID(w, "user_id", params["user_id"])
	if err != nil {
		return
	}

	assignments := []*Assignment{}

	if currentUser.Admin {
		err = meddler.QueryAll(tx, &assignments, `SELECT * FROM assignments WHERE user_id = $1 `+
			`ORDER BY course_id, updated_at`,
			userID)
	} else {
		err = meddler.QueryAll(tx, &assignments, `SELECT assignments.* `+
			`FROM assignments JOIN user_assignments ON assignments.id = user_assignments.assignment_id `+
			`WHERE assignments.user_id = $1 AND user_assignments.user_id = $2 `+
			`ORDER BY course_id, updated_at`,
			userID, currentUser.ID)
	}

	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	render.JSON(http.StatusOK, assignments)
}

// GetCourseUserAssignments handles requests to /v2/courses/:course_id/users/:user_id/assignments,
// returning a list of assignments for the given user in the given course.
func GetCourseUserAssignments(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	courseID, err := parseID(w, "course_id", params["course_id"])
	if err != nil {
		return
	}
	userID, err := parseID(w, "user_id", params["user_id"])
	if err != nil {
		return
	}

	assignments := []*Assignment{}

	if currentUser.Admin {
		err = meddler.QueryAll(tx, &assignments, `SELECT * FROM assignments `+
			`WHERE course_id = $1 AND user_id = $2 `+
			`ORDER BY updated_at`,
			courseID, userID)
	} else {
		err = meddler.QueryAll(tx, &assignments, `SELECT assignments.* `+
			`FROM assignments JOIN user_assignments ON assignments.id = user_assignments.assignment_id `+
			`WHERE course_id = $1 AND assignments.user_id = $2 AND user_assignments.user_id = $3 `+
			`ORDER BY updated_at`,
			courseID, userID, currentUser.ID)
	}

	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
	if len(assignments) == 0 {
		loggedHTTPErrorf(w, http.StatusNotFound, "not found")
		return
	}

	render.JSON(http.StatusOK, assignments)
}

// GetAssignment handles requests to /v2/assignments/:assignment_id,
// returning the given assignment.
func GetAssignment(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	assignmentID, err := parseID(w, "assignment_id", params["assignment_id"])
	if err != nil {
		return
	}

	assignment := new(Assignment)

	if currentUser.Admin {
		err = meddler.QueryRow(tx, assignment, `SELECT * FROM assignments WHERE id = $1`, assignmentID)
	} else {
		err = meddler.QueryRow(tx, assignment, `SELECT assignments.* `+
			`FROM assignments JOIN user_assignments ON assignments.id = user_assignments.assignment_id `+
			`WHERE id = $1 AND user_assignments.user_id = $2`,
			assignmentID, currentUser.ID)
	}

	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	render.JSON(http.StatusOK, assignment)
}

// DeleteAssignment handles requests to /v2/assignments/:assignment_id,
// deleting the given assignment.
func DeleteAssignment(w http.ResponseWriter, tx *sql.Tx, params martini.Params) {
	assignmentID, err := parseID(w, "assignment_id", params["assignment_id"])
	if err != nil {
		return
	}

	if _, err := tx.Exec(`DELETE FROM assignments WHERE id = $1`, assignmentID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
}

// GetAssignmentProblemCommitLast handles requests to /v2/assignments/:assignment_id/problems/:problem_id/commits/last,
// returning the most recent commit of the highest-numbered step for the given problem of the given assignment.
func GetAssignmentProblemCommitLast(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	assignmentID, err := parseID(w, "assignment_id", params["assignment_id"])
	if err != nil {
		return
	}
	problemID, err := parseID(w, "problem_id", params["problem_id"])
	if err != nil {
		return
	}

	commit := new(Commit)

	if currentUser.Admin {
		err = meddler.QueryRow(tx, commit, `SELECT * FROM commits WHERE assignment_id = $1 AND problem_id = $2 ORDER BY step DESC, created_at DESC LIMIT 1`,
			assignmentID, problemID)
	} else {
		err = meddler.QueryRow(tx, commit, `SELECT commits.* `+
			`FROM commits JOIN user_assignments ON commits.assignment_id = user_assignments.assignment_id `+
			`WHERE commits.assignment_id = $1 AND problem_id = $2 AND user_assignments.user_id = $3 `+
			`ORDER BY step DESC, created_at DESC LIMIT 1`, assignmentID, problemID, currentUser.ID)
	}

	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	render.JSON(http.StatusOK, commit)
}

// GetUserAssignmentProblemStepCommitLast handles requests to /v2/assignments/:assignment_id/problems/:problem_id/steps/:step/commits/last,
// returning the most recent commit for the given step of the given problem of the given assignment.
func GetAssignmentProblemStepCommitLast(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	assignmentID, err := parseID(w, "assignment_id", params["assignment_id"])
	if err != nil {
		return
	}
	problemID, err := parseID(w, "problem_id", params["problem_id"])
	if err != nil {
		return
	}
	step, err := parseID(w, "step", params["step"])
	if err != nil {
		return
	}

	commit := new(Commit)

	if currentUser.Admin {
		err = meddler.QueryRow(tx, commit, `SELECT * FROM commits WHERE assignment_id = $1 AND problem_id = $2 AND step = $3 ORDER BY created_at DESC LIMIT 1`, assignmentID, problemID, step)
	} else {
		err = meddler.QueryRow(tx, commit, `SELECT commits.* `+
			`FROM commits JOIN user_assignments ON commits.assignment_id = user_assignments.assignment_id `+
			`WHERE commits.assignment_id = $1 AND problem_id = $2 AND step = $3 AND user_assignments.user_id = $4 `+
			`ORDER BY created_at DESC LIMIT 1`,
			assignmentID, problemID, step, currentUser.ID)
	}

	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	render.JSON(http.StatusOK, commit)
}

// DeleteCommit handles requests to /v2/commits/:commit_id,
// deleting the given commit.
func DeleteCommit(w http.ResponseWriter, tx *sql.Tx, params martini.Params) {
	commitID, err := parseID(w, "commit_id", params["commit_id"])
	if err != nil {
		return
	}

	if _, err = tx.Exec(`DELETE FROM commits WHERE id = $1`, commitID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
}

// PostCommitBundlesUnsigned handles requests to /v2/commit_bundles/unsigned,
// saving a new commit (or updating the most recent one), gathering the problem data,
// signing everything, and returning it in a form ready to send to the daycare.
func PostCommitBundlesUnsigned(w http.ResponseWriter, tx *sql.Tx, currentUser *User, bundle CommitBundle, render render.Render) {
	now := time.Now()

	if bundle.Commit == nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "bundle must include a commit object")
		return
	}
	if len(bundle.CommitSignature) != 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "bundle must not include commit signature")
		return
	}
	bundle.Commit.Transcript = []*EventMessage{}
	bundle.Commit.ReportCard = nil
	bundle.Commit.Score = 0.0
	bundle.Commit.CreatedAt = now
	bundle.Commit.UpdatedAt = now
	saveCommitBundleCommon(now, w, tx, currentUser, bundle, render)
}

// PostCommitBundlesSigned handles requests to /v2/commit_bundles/signed,
// saving a new commit (or updating the most recent one), gathering the problem data,
// verifying signatures, and posting a grade (if appropriate).
func PostCommitBundlesSigned(w http.ResponseWriter, tx *sql.Tx, currentUser *User, bundle CommitBundle, render render.Render) {
	now := time.Now()

	if bundle.Commit == nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "bundle must include a commit object")
		return
	}
	if len(bundle.CommitSignature) == 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "bundle must include commit signature")
		return
	}
	saveCommitBundleCommon(now, w, tx, currentUser, bundle, render)
}

func saveCommitBundleCommon(now time.Time, w http.ResponseWriter, tx *sql.Tx, currentUser *User, bundle CommitBundle, render render.Render) {
	if bundle.Problem != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "bundle must not include a problem object")
		return
	}
	if len(bundle.ProblemSteps) != 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "bundle must not include problem step objects")
		return
	}
	if len(bundle.ProblemSignature) != 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "bundle must not include problem signature")
		return
	}
	commit := bundle.Commit

	// get the assignment and make sure it is for this user
	assignment := new(Assignment)
	if err := meddler.QueryRow(tx, assignment, `SELECT * FROM assignments WHERE id = $1 AND user_id = $2`, commit.AssignmentID, currentUser.ID); err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	// get the problem
	problem := new(Problem)
	if err := meddler.QueryRow(tx, problem, `SELECT * FROM problems WHERE id = $1`, commit.ProblemID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
	steps := []*ProblemStep{}
	if err := meddler.QueryAll(tx, &steps, `SELECT * FROM problem_steps WHERE problem_id = $1 ORDER BY step`, commit.ProblemID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
	if len(steps) == 0 {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "no steps found for problem %s (%d)", problem.Unique, problem.ID)
		return
	}

	// reject commit if a previous step remains incomplete
	if assignment.RawScores == nil {
		assignment.RawScores = map[string][]float64{}
	}
	scores := assignment.RawScores[problem.Unique]
	for i := 0; i < int(commit.Step)-1; i++ {
		if i >= len(scores) || scores[i] != 1.0 {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit is for step %d, but user has not passed step %d", commit.Step, i+1)
			return
		}
	}

	// validate commit
	if commit.Step > int64(len(steps)) {
		loggedHTTPErrorf(w, http.StatusBadRequest, "commit has step number %d, but there are only %d steps in the problem", commit.Step, len(steps))
		return
	}
	whitelists := problem.GetStepWhitelists(steps)
	if err := commit.Normalize(now, whitelists[commit.Step-1]); err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "%v", err)
		return
	}

	// update an existing commit if it exists
	// note: this used to include AND action IS NULL AND updated_at > now.Add(-OpenCommitTimeout)
	openCommit := new(Commit)
	if err := meddler.QueryRow(tx, openCommit, `SELECT * FROM commits WHERE assignment_id = $1 AND problem_id = $2 AND step = $3 LIMIT 1`, commit.AssignmentID, commit.ProblemID, commit.Step); err != nil {
		if err == sql.ErrNoRows {
			commit.ID = 0
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
			return
		}
	} else {
		commit.ID = openCommit.ID
		commit.CreatedAt = openCommit.CreatedAt
	}

	// sign the problem and the commit
	problemSig := problem.ComputeSignature(Config.DaycareSecret, steps)
	commitSig := commit.ComputeSignature(Config.DaycareSecret, problemSig)

	// verify signature
	if bundle.CommitSignature != "" {
		if bundle.CommitSignature != commitSig {
			loggedHTTPErrorf(w, http.StatusBadRequest, "found commit signature of %s, but expected %s", bundle.CommitSignature, commitSig)
			return
		}
		age := now.Sub(commit.UpdatedAt)
		if age < 0 {
			age = -age
		}
		if age > SignedCommitTimeout {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit signature has expired")
			return
		}
	}

	// save the commit
	action := commit.Action
	if bundle.CommitSignature == "" {
		// if unsigned, save it without the action
		commit.Action = ""
	}
	if err := meddler.Save(tx, "commits", commit); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
	commit.Action = action

	// recompute the signature as the ID may have changed when saving
	commitSig = commit.ComputeSignature(Config.DaycareSecret, problemSig)
	signed := &CommitBundle{
		Problem:          problem,
		ProblemSteps:     steps,
		ProblemSignature: problemSig,
		Commit:           commit,
		CommitSignature:  commitSig,
	}

	// save the grade update
	if signed.Commit.ReportCard != nil {
		// save the raw score for this problem step
		scores := assignment.RawScores[problem.Unique]
		for int(signed.Commit.Step) > len(scores) {
			scores = append(scores, 0.0)
		}
		scores[signed.Commit.Step-1] = signed.Commit.ReportCard.ComputeScore()
		assignment.RawScores[problem.Unique] = scores

		// get the weight of each step in the problem and problem in the set
		weights := []*StepWeights{}
		if err := meddler.QueryAll(tx, &weights, `SELECT problems.unique_id, problem_set_problems.weight AS problem_weight, problem_steps.step, problem_steps.weight AS step_weight `+
			`FROM problem_set_problems JOIN problems ON problem_set_problems.problem_id = problems.id `+
			`JOIN problem_steps ON problem_steps.problem_id = problems.id `+
			`WHERE problem_set_problems.problem_set_id = $1 `+
			`ORDER BY unique_id, step`, assignment.ProblemSetID); err != nil {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
			return
		}
		if len(weights) == 0 {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "no problem step weights found, unable to compute score")
			return
		}
		problemWeights := make(map[string]float64)
		stepWeights := make(map[string][]float64)
		for _, elt := range weights {
			problemWeights[elt.Unique] = elt.ProblemWeight
			stepWeights[elt.Unique] = append(stepWeights[elt.Unique], elt.StepWeight)
			if len(stepWeights[elt.Unique]) != int(elt.Step) {
				loggedHTTPErrorf(w, http.StatusInternalServerError, "step weights do not line up when computing score")
				return
			}
		}

		// compute an overall score
		setWeightTotal, setScore := 0.0, 0.0
		for unique, problemWeight := range problemWeights {
			setWeightTotal += problemWeight
			scores := assignment.RawScores[unique]
			problemWeightTotal, problemScore := 0.0, 0.0
			for i, stepWeight := range stepWeights[unique] {
				problemWeightTotal += stepWeight
				if i < len(scores) {
					problemScore += scores[i] * stepWeight
				}
			}
			if problemWeightTotal == 0.0 {
				loggedHTTPErrorf(w, http.StatusInternalServerError, "problem %s has no weight", unique)
				return
			}
			problemScore /= problemWeightTotal
			setScore += problemScore * problemWeight
		}
		if setWeightTotal == 0.0 {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "problem set has no weight")
			return
		}
		assignment.Score = setScore / setWeightTotal

		// save the updates to the assignment
		assignment.UpdatedAt = now
		if err := meddler.Save(tx, "assignments", assignment); err != nil {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
			return
		}
		// post grade to LMS using LTI
		if err := saveGrade(tx, assignment, currentUser); err != nil {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "error posting grade back to LMS: %v", err)
			return
		}
	}

	render.JSON(http.StatusOK, &signed)
}

type StepWeights struct {
	Unique        string  `meddler:"unique_id"`
	ProblemWeight float64 `meddler:"problem_weight"`
	Step          int64   `meddler:"step"`
	StepWeight    float64 `meddler:"step_weight"`
}
