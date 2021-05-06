package main

import (
	"bytes"
	"database/sql"
	"fmt"
	"html"
	"log"
	"math/rand"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/go-martini/martini"
	"github.com/martini-contrib/render"
	. "github.com/russross/codegrinder/types"
	"github.com/russross/meddler"
)

const loginRecordTimeout = 5 * time.Minute

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
			`WHERE assignments.user_id = ? AND assignments.course_id = ?`,
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

	if _, err := tx.Exec(`DELETE FROM courses WHERE id = ?`, courseID); err != nil {
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

// GetUserSession handlers /v2/users/session requests,
// returning a cookie for a user session.
//
// Parameter key=<...> must be present, and must be a valid session key that was issued
// within the last 5 minutes. The key is deleted after its first use.
func GetUserSession(w http.ResponseWriter, r *http.Request, render render.Render) {
	key := r.FormValue("key")
	if key == "" {
		loggedHTTPErrorf(w, http.StatusBadRequest, "missing key= parameter")
		return
	}
	userID, err := loginRecords.Get(key)
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "%v", err)
		return
	}
	if userID < 1 {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "illegal user ID found: %d", userID)
		return
	}
	session := NewSession(userID)
	cookie := session.Save(w)

	result := map[string]string{"Cookie": cookie}
	render.JSON(http.StatusOK, result)
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
		err = meddler.QueryRow(tx, user, `SELECT users.* `+
			`FROM users JOIN user_users ON users.id = user_users.other_user_id `+
			`WHERE user_users.user_id = ? AND user_users.other_user_id = ?`,
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
			`WHERE assignments.course_id = ? ORDER BY users.id`,
			courseID)
	} else {
		err = meddler.QueryAll(tx, &users, `SELECT DISTINCT users.* `+
			`FROM users JOIN assignments ON users.id = assignments.user_id `+
			`JOIN user_users ON assignments.user_id = user_users.other_user_id `+
			`WHERE assignments.course_id = ? AND user_users.user_id = ? `+
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

	if _, err := tx.Exec(`DELETE FROM users WHERE id = ?`, userID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
}

// GetAssignments handles requests to /v2/assignments,
// returning a list of assignments.
//
// If parameter search=<...> present (can be repeated), it will be interpreted as search terms,
// and results will be filtered by case-insensitive substring match on several fields
// related to the assignment, including the assignment canvas title, user name, user email, course name,
// problem set unique ID, problem set note, and problem set tags. The returned assignments match
// all search terms.
func GetAssignments(w http.ResponseWriter, r *http.Request, tx *sql.Tx, currentUser *User, render render.Render) {
	if err := r.ParseForm(); err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "parsing form data: %v", err)
		return
	}

	// build search terms
	where := ""
	args := []interface{}{}
	for _, term := range r.Form["search"] {
		where, args = addWhereLike(where, args, "assignment_search_fields.search_text", term)
	}

	assignments := []*Assignment{}
	var err error
	if currentUser.Admin {
		err = meddler.QueryAll(tx, &assignments, `SELECT assignments.* FROM assignments JOIN assignment_search_fields `+
			`ON assignments.id = assignment_search_fields.assignment_id`+where+` ORDER BY assignments.id`, args...)
	} else {
		where, args = addWhereEq(where, args, "user_assignments.user_id", currentUser.ID)
		err = meddler.QueryAll(tx, &assignments, `SELECT assignments.* FROM assignments JOIN assignment_search_fields `+
			`ON assignments.id = assignment_search_fields.assignment_id `+
			`JOIN user_assignments ON user_assignments.assignment_id = assignments.id`+where+` ORDER BY assignments.id`, args...)
	}

	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
	render.JSON(http.StatusOK, assignments)
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
		err = meddler.QueryAll(tx, &assignments, `SELECT * FROM assignments WHERE user_id = ? `+
			`ORDER BY course_id, updated_at`,
			userID)
	} else {
		err = meddler.QueryAll(tx, &assignments, `SELECT assignments.* `+
			`FROM assignments JOIN user_assignments ON assignments.id = user_assignments.assignment_id `+
			`WHERE assignments.user_id = ? AND user_assignments.user_id = ? `+
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
			`WHERE course_id = ? AND user_id = ? `+
			`ORDER BY updated_at`,
			courseID, userID)
	} else {
		err = meddler.QueryAll(tx, &assignments, `SELECT assignments.* `+
			`FROM assignments JOIN user_assignments ON assignments.id = user_assignments.assignment_id `+
			`WHERE course_id = ? AND assignments.user_id = ? AND user_assignments.user_id = ? `+
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
		err = meddler.QueryRow(tx, assignment, `SELECT * FROM assignments WHERE id = ?`, assignmentID)
	} else {
		err = meddler.QueryRow(tx, assignment, `SELECT assignments.* `+
			`FROM assignments JOIN user_assignments ON assignments.id = user_assignments.assignment_id `+
			`WHERE assignments.id = ? AND user_assignments.user_id = ?`,
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

	if _, err := tx.Exec(`DELETE FROM assignments WHERE id = ?`, assignmentID); err != nil {
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
		err = meddler.QueryRow(tx, commit, `SELECT * FROM commits WHERE assignment_id = ? AND problem_id = ? ORDER BY step DESC, updated_at DESC LIMIT 1`,
			assignmentID, problemID)
	} else {
		err = meddler.QueryRow(tx, commit, `SELECT commits.* `+
			`FROM commits JOIN user_assignments ON commits.assignment_id = user_assignments.assignment_id `+
			`WHERE commits.assignment_id = ? AND problem_id = ? AND user_assignments.user_id = ? `+
			`ORDER BY step DESC, updated_at DESC LIMIT 1`, assignmentID, problemID, currentUser.ID)
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
		err = meddler.QueryRow(tx, commit, `SELECT * FROM commits WHERE assignment_id = ? AND problem_id = ? AND step = ? ORDER BY updated_at DESC LIMIT 1`, assignmentID, problemID, step)
	} else {
		err = meddler.QueryRow(tx, commit, `SELECT commits.* `+
			`FROM commits JOIN user_assignments ON commits.assignment_id = user_assignments.assignment_id `+
			`WHERE commits.assignment_id = ? AND problem_id = ? AND step = ? AND user_assignments.user_id = ? `+
			`ORDER BY updated_at DESC LIMIT 1`,
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

	if _, err = tx.Exec(`DELETE FROM commits WHERE id = ?`, commitID); err != nil {
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
	if len(bundle.Hostname) != 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "bundle must not include daycare hostname")
		return
	}
	if bundle.Commit.Action == "" {
	}

	bundle.Hostname = ""
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
	if bundle.ProblemType != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "bundle must not include a problem type object")
		return
	}
	if len(bundle.ProblemTypeSignature) != 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "bundle must not include a problem type signature")
		return
	}
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
	if len(bundle.CommitSignature) != 0 && len(bundle.Hostname) == 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "bundle must include daycare hostname")
		return
	}
	if bundle.UserID != currentUser.ID {
		loggedHTTPErrorf(w, http.StatusBadRequest, "bundle must include user's ID")
		return
	}
	commit := bundle.Commit

	// get the assignment and figure out if this is the student or the instructor
	isInstructor := false
	assignment := new(Assignment)
	err := meddler.QueryRow(tx, assignment, `SELECT * FROM assignments WHERE id = ? AND user_id = ?`, commit.AssignmentID, currentUser.ID)
	if err == sql.ErrNoRows {
		// try loading it as the instructor
		err = meddler.QueryRow(tx, assignment, `SELECT assignments.* FROM assignments JOIN user_assignments ON assignments.id = user_assignments.assignment_id `+
			`WHERE user_assignments.assignment_id = ? AND user_assignments.user_id = ?`, commit.AssignmentID, currentUser.ID)
		if err == nil {
			isInstructor = true
		}
	}
	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	// assignment cannot be past the lock date:
	// * a student's lock at deadline is normally honored if present
	// * however, if there is no course-wide lock at (attached to an instructor),
	//   the student lock at is ignored on the assumption that the deadline was lifted course wide
	// * if the student does not have an individual deadline but there is a course-wide deadline,
	//   it is observed on the assumption that a deadline was imposed after the student started work
	// to decide if a submission is past the deadline:
	// * if there is no course-wide lock at, accept
	// * else if the student has a lock at:
	//     * if it is in the past, reject
	//     * else accept
	// * else if the course-wide lock at has passed, reject
	// * else accept
	var courseWideLockAt time.Time
	err = tx.QueryRow(`SELECT lock_at FROM assignments WHERE instructor AND lti_id = ? AND lock_at IS NOT NULL ORDER BY lock_at DESC LIMIT 1`,
		assignment.LtiID).Scan(&courseWideLockAt)
	if err != nil && err != sql.ErrNoRows {
		loggedHTTPDBNotFoundError(w, err)
		return
	} else if err == nil {
		// there is a course-wide deadline, should we reject?
		if (assignment.LockAt != nil && now.After(*assignment.LockAt)) ||
			(assignment.LockAt == nil && now.After(courseWideLockAt)) {
			loggedHTTPErrorf(w, http.StatusForbidden, "a commit cannot be submitted after the assignment is locked")
			return
		}
	}

	// get the problem
	problem := new(Problem)
	if err = meddler.QueryRow(tx, problem, `SELECT * FROM problems WHERE id = ?`, commit.ProblemID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
	steps := []*ProblemStep{}
	if err = meddler.QueryAll(tx, &steps, `SELECT * FROM problem_steps WHERE problem_id = ? ORDER BY step`, commit.ProblemID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
	if len(steps) == 0 {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "no steps found for problem %s (%d)", problem.Unique, problem.ID)
		return
	}

	// get the problem type
	problemType, err := getProblemType(tx, problem.ProblemType)
	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "error loading problem type: %v", err)
		return
	}

	if assignment.RawScores == nil {
		assignment.RawScores = map[string][]float64{}
	}

	// reject commit if a previous step remains incomplete
	scores := assignment.RawScores[problem.Unique]
	for i := 0; i < int(commit.Step)-1; i++ {
		if i >= len(scores) || scores[i] != 1.0 {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit is for step %d, but user has not passed step %d", commit.Step, i+1)
			return
		}
	}

	// reject commit if user has started work on a later step
	var latestStep int64
	if err = tx.QueryRow(`SELECT step FROM commits WHERE assignment_id = ? AND problem_id = ? ORDER BY step DESC LIMIT 1`, commit.AssignmentID, commit.ProblemID).Scan(&latestStep); err != nil {
		if err != sql.ErrNoRows {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
			return
		}
	} else if latestStep > commit.Step {
		loggedHTTPErrorf(w, http.StatusBadRequest, "commit is for step %d, but user has already started work on step %d", commit.Step, latestStep)
		return
	}

	// validate commit
	if commit.Step > int64(len(steps)) {
		loggedHTTPErrorf(w, http.StatusBadRequest, "commit has step number %d, but there are only %d steps in the problem", commit.Step, len(steps))
		return
	}
	if err := commit.Normalize(now, steps[commit.Step-1].Whitelist); err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "%v", err)
		return
	}

	// update an existing commit if it exists
	// note: this used to include AND action IS NULL AND updated_at > now.Add(-OpenCommitTimeout)
	openCommit := new(Commit)
	if err := meddler.QueryRow(tx, openCommit, `SELECT * FROM commits WHERE assignment_id = ? AND problem_id = ? AND step = ? LIMIT 1`, commit.AssignmentID, commit.ProblemID, commit.Step); err != nil {
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
	typeSig := problemType.ComputeSignature(Config.DaycareSecret)
	problemSig := problem.ComputeSignature(Config.DaycareSecret, steps)
	commitSig := commit.ComputeSignature(Config.DaycareSecret, typeSig, problemSig, bundle.Hostname, bundle.UserID)

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
	if isInstructor {
		log.Printf("instructor is testing student code, skipping save step")
	} else {
		if err := meddler.Save(tx, "commits", commit); err != nil {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
			return
		}

		// save an updated timestamp on the assignment if it would otherwise not be updated
		if commit.ReportCard == nil {
			assignment.UpdatedAt = now
			if err := meddler.Save(tx, "assignments", assignment); err != nil {
				loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
				return
			}
		}
	}
	commit.Action = action

	// assign a daycare host if needed
	if bundle.Hostname == "" {
		host, err := daycareRegistrations.Assign(problem.ProblemType)
		if err != nil {
			log.Printf("error assigning a daycare for this commit: %v", err)
		} else {
			bundle.Hostname = host
		}
	}

	// recompute the signature as the ID may have changed when saving
	commitSig = commit.ComputeSignature(Config.DaycareSecret, typeSig, problemSig, bundle.Hostname, bundle.UserID)
	signed := &CommitBundle{
		ProblemType:          problemType,
		ProblemTypeSignature: typeSig,
		Problem:              problem,
		ProblemSteps:         steps,
		ProblemSignature:     problemSig,
		Hostname:             bundle.Hostname,
		UserID:               bundle.UserID,
		Commit:               commit,
		CommitSignature:      commitSig,
	}

	// save the grade update
	if !isInstructor && signed.Commit.ReportCard != nil {
		assignment.SetMinorScore(problem.Unique, int(signed.Commit.Step-1), signed.Commit.ReportCard.ComputeScore())

		// get the weight of each step in the problem and problem in the set
		majorWeights, minorWeights, err := GetProblemWeights(tx, assignment)
		if err != nil {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "%v", err)
			return
		}

		// compute an overall score
		score, err := assignment.ComputeScore(majorWeights, minorWeights)
		if err != nil {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "%v", err)
			return
		}
		assignment.Score = score

		// save the updates to the assignment
		assignment.UpdatedAt = now
		if err := meddler.Save(tx, "assignments", assignment); err != nil {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
			return
		}

		// post grade to LMS using LTI
		var transcript bytes.Buffer
		if err := signed.Commit.DumpTranscript(&transcript); err != nil {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "error writing transcript: %v", err)
			return
		}

		// record the grading transcript
		var report bytes.Buffer
		if len(majorWeights) > 1 && len(signed.ProblemSteps) > 1 {
			fmt.Fprintf(&report, "<h1>Grading transcript for problem %s step %d</h1>\n", signed.Problem.Unique, signed.Commit.Step)
		} else if len(majorWeights) > 1 {
			fmt.Fprintf(&report, "<h1>Grading transcript for problem %s</h1>\n", signed.Problem.Unique)
		} else if len(signed.ProblemSteps) > 1 {
			fmt.Fprintf(&report, "<h1>Grading transcript for step %d</h1>\n", signed.Commit.Step)
		} else {
			fmt.Fprintf(&report, "<h1>Grading transcript</h1>\n")
		}
		fmt.Fprintf(&report, "<pre>%s</pre>\n", html.EscapeString(transcript.String()))

		// add all of the student files
		var names []string
		for name := range signed.Commit.Files {
			names = append(names, name)
		}
		sort.Strings(names)
		for _, name := range names {
			contents := signed.Commit.Files[name]
			if utf8.Valid(contents) {
				fmt.Fprintf(&report, "<h1>File: <code>%s</code></h1>\n<pre><code>%s</code></pre>\n",
					html.EscapeString(name), html.EscapeString(string(contents)))
			} else {
				fmt.Fprintf(&report, "<h1>File: <code>%s</code> (binary contents)</h1>\n", html.EscapeString(name))
			}
		}

		// send grade to the LMS in a goroutine
		// so we can wrap up the transaction and return to the user
		go func(asst *Assignment, msg string) {
			// try up to 10 times before giving up
			tries := 10
			minSleepTime := 10 * time.Second
			maxSleepTime := 5 * time.Minute
			sleepTime := minSleepTime
			for i := 0; i < tries; i++ {
				err := saveGrade(asst, msg)
				if err == nil {
					return
				}
				log.Printf("error posting grade back to LMS (attempt %d/%d): %v", i+1, tries, err)
				if i+1 < 10 {
					log.Printf("  will try again in %v", sleepTime)
					time.Sleep(sleepTime)
					sleepTime *= 2
					if sleepTime > maxSleepTime {
						sleepTime = maxSleepTime
					}
				} else {
					log.Printf("  giving up")
				}
			}
		}(assignment, report.String())
	}

	note := ""
	if bundle.Commit.Note != "" {
		note = " (" + bundle.Commit.Note + ")"
	}
	if bundle.Commit.Action == "" && bundle.CommitSignature == "" {
		log.Printf("save request: user %s saving %s step %d%s",
			currentUser.Name, problem.Note, bundle.Commit.Step, note)
	} else if bundle.Commit.Action != "" && bundle.CommitSignature == "" {
		log.Printf(" pre-daycare commit: user %s (%d) action %s for %s step %d%s",
			currentUser.Name, currentUser.ID, bundle.Commit.Action, problem.Note, bundle.Commit.Step, note)
	} else if bundle.Commit.Action != "" {
		log.Printf("post-daycare commit: user %s (%d) action %s for %s step %d%s",
			currentUser.Name, currentUser.ID, bundle.Commit.Action, problem.Note, bundle.Commit.Step, note)
	}

	render.JSON(http.StatusOK, &signed)
}

type StepWeight struct {
	MajorKey    string  `meddler:"major_key"`
	MajorWeight float64 `meddler:"major_weight"`
	MinorKey    int64   `meddler:"minor_key"`
	MinorWeight float64 `meddler:"minor_weight"`
}

func GetProblemWeights(tx *sql.Tx, assignment *Assignment) (majorWeights map[string]float64, minorWeights map[string][]float64, err error) {
	weights := []*StepWeight{}
	if err := meddler.QueryAll(tx, &weights, `SELECT problems.unique_id AS major_key, problem_set_problems.weight AS major_weight, problem_steps.step AS minor_key, problem_steps.weight AS minor_weight `+
		`FROM problem_set_problems JOIN problems ON problem_set_problems.problem_id = problems.id `+
		`JOIN problem_steps ON problem_steps.problem_id = problems.id `+
		`WHERE problem_set_problems.problem_set_id = ? `+
		`ORDER BY unique_id, step`, assignment.ProblemSetID); err != nil {
		return nil, nil, fmt.Errorf("db error: %v", err)
	}
	if len(weights) == 0 {
		return nil, nil, fmt.Errorf("no problem step weights found, unable to compute score")
	}
	majorWeights = make(map[string]float64)
	minorWeights = make(map[string][]float64)
	for _, elt := range weights {
		majorWeights[elt.MajorKey] = elt.MajorWeight
		minorWeights[elt.MajorKey] = append(minorWeights[elt.MajorKey], elt.MinorWeight)
		if len(minorWeights[elt.MajorKey]) != int(elt.MinorKey) {
			return nil, nil, fmt.Errorf("step weights do not line up when computing score")
		}
	}
	return majorWeights, minorWeights, nil
}

type loginRecord struct {
	userID int64
	time   time.Time
}

type logins struct {
	sync.Mutex
	logins map[string]*loginRecord
}

var loginRecords logins

func init() {
	loginRecords.logins = make(map[string]*loginRecord)
}

func (l *logins) expire() {
	now := time.Now()
	for key, elt := range l.logins {
		if now.Sub(elt.time) >= loginRecordTimeout {
			delete(l.logins, key)
		}
	}
}

func (l *logins) Insert(userID int64) string {
	l.Lock()
	defer l.Unlock()

	key := ""
	for {
		key = makeLoginKey()
		if _, exists := l.logins[key]; !exists {
			break
		}
	}

	elt := &loginRecord{
		userID: userID,
		time:   time.Now(),
	}

	l.logins[key] = elt
	l.expire()

	return key
}

func (l *logins) Get(key string) (int64, error) {
	l.Lock()
	defer l.Unlock()

	l.expire()

	elt, exists := l.logins[key]
	if !exists {
		return 0, fmt.Errorf("session %q not found: key expires after 5 minutes and can only be used once", key)
	}

	delete(l.logins, key)
	return elt.userID, nil
}

const keyCharSet string = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"

func makeLoginKey() string {
	var key string
	for i := 0; i < 8; i++ {
		n := rand.Intn(len(keyCharSet))
		key += keyCharSet[n : n+1]
	}
	return key
}
