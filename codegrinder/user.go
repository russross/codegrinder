package main

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"

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
func GetCourses(w http.ResponseWriter, r *http.Request, tx *sql.Tx, render render.Render) {
	where := ""
	args := []interface{}{}

	if ltiLabel := r.FormValue("lti_label"); ltiLabel != "" {
		where, args = addWhereEq(where, args, "lti_label", ltiLabel)
	}

	if name := r.FormValue("name"); name != "" {
		where, args = addWhereLike(where, args, "name", name)
	}

	courses := []*Course{}
	if err := meddler.QueryAll(tx, &courses, `SELECT * FROM courses`+where+` ORDER BY lti_label`, args...); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
	render.JSON(http.StatusOK, courses)
}

// GetCourse handles /v2/courses/:course_id requests,
// returning a single course.
func GetCourse(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	courseID, err := parseID(w, "course_id", params["course_id"])
	if err != nil {
		return
	}

	course := new(Course)
	if err := meddler.Load(tx, "courses", course, courseID); err != nil {
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
func GetUsers(w http.ResponseWriter, r *http.Request, tx *sql.Tx, render render.Render) {
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
	if err := meddler.QueryAll(tx, &users, `SELECT * FROM users`+where+` ORDER BY id`, args...); err != nil {
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

// GetUser handles /v2/users/:user_id requests,
// returning a single user.
func GetUser(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	userID, err := parseID(w, "user_id", params["user_id"])
	if err != nil {
		return
	}

	user := new(User)
	if err := meddler.Load(tx, "users", user, int64(userID)); err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}
	render.JSON(http.StatusOK, user)
}

// GetCourseUsers handles request to /v2/course/:course_id/users,
// returning a list of users in the given course.
func GetCourseUsers(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	courseID, err := parseID(w, "course_id", params["course_id"])
	if err != nil {
		return
	}

	users := []*User{}
	if err := meddler.QueryAll(tx, &users, `SELECT DISTINCT users.* FROM users INNER JOIN assignments ON users.ID = assignments.user_id WHERE assignments.course_id = $1 ORDER BY users.ID`, courseID); err != nil {
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

// UserCookie handlers /v2/users/me/cookie requests,
// returning the cookie for the current user session.
func UserCookie(w http.ResponseWriter, r *http.Request) {
	cookie := r.Header.Get("Cookie")
	for _, field := range strings.Fields(cookie) {
		if strings.HasPrefix(field, CookieName+"=") {
			fmt.Fprintf(w, "%s", field)
		}
	}
}

// getInstructorCourses returns a list of IDs of courses for which this
// user is an instructor according to LTI roles.
func getInstructorCourses(tx *sql.Tx, user *User) ([]int64, error) {
	rows, err := tx.Query(`SELECT DISTINCT course_id FROM assignments WHERE user_id = $1 AND instructor LIMIT 100`, user.ID)
	if err != nil {
		return nil, loggedErrorf("db error: %v", err)
	}
	defer rows.Close()

	courseIDs := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, loggedErrorf("db error scanning row: %v", err)
		}
		courseIDs = append(courseIDs, id)
	}
	if err = rows.Err(); err != nil {
		return nil, loggedErrorf("db error closing rows: %v", err)
	}

	return courseIDs, nil
}

// GetUsersMeAssignments handles requests to /v2/users/me/assignments,
// returning a list of assignments for the current user.
func GetUsersMeAssignments(w http.ResponseWriter, r *http.Request, tx *sql.Tx, currentUser *User, render render.Render) {
	assignments := []*Assignment{}
	if err := meddler.QueryAll(tx, &assignments, `SELECT * FROM assignments WHERE user_id = $1 ORDER BY course_id, updated_at`, currentUser.ID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	render.JSON(http.StatusOK, assignments)
}

// GetUserAssignments handles requests to /v2/users/me/assignments,
// returning a list of assignments for the current user.
func GetUserAssignments(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	userID, err := parseID(w, "user_id", params["user_id"])
	if err != nil {
		return
	}

	assignments := []*Assignment{}
	if err := meddler.QueryAll(tx, &assignments, `SELECT * FROM assignments WHERE user_id = $1 ORDER BY course_id, updated_at`, userID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	render.JSON(http.StatusOK, assignments)
}

// GetAssignment handles requests to /v2/assignments/:assignment_id,
// returning the given assignment.
func GetAssignment(w http.ResponseWriter, tx *sql.Tx, currentUser *User, params martini.Params, render render.Render) {
	assignmentID, err := parseID(w, "assignment_id", params["assignment_id"])
	if err != nil {
		return
	}

	assignment := new(Assignment)
	if currentUser.Admin {
		// admins can load any assignment
		if err := meddler.QueryRow(tx, assignment, `SELECT * FROM assignments WHERE id = $1`, assignmentID); err != nil {
			loggedHTTPDBNotFoundError(w, err)
			return
		}
	} else {
		// everyone else can load an assignment if:
		// 1) it belongs to the user
		// 2) the user is an instructor for that course
		instructorCourses, err := getInstructorCourses(tx, currentUser)
		if err != nil {
			return
		}
		if len(instructorCourses) == 0 {
			if err := meddler.QueryRow(tx, assignment, `SELECT * FROM assignments WHERE id = $1 AND user_id = $2`, assignmentID, currentUser.ID); err != nil {
				loggedHTTPDBNotFoundError(w, err)
				return
			}
		} else {
			in := ""
			for i, elt := range instructorCourses {
				if i > 0 {
					in += ","
				}
				in += strconv.FormatInt(elt, 10)
			}
			if err := meddler.QueryRow(tx, assignment, `SELECT * FROM assignments WHERE id = $1 AND (user_id = $2 OR course_id IN (`+in+`))`, assignmentID, currentUser.ID); err != nil {
				loggedHTTPDBNotFoundError(w, err)
				return
			}
		}
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

// GetUserMeAssignmentCommits handles requests to /v2/users/me/assignments/:assignment_id/commits,
// returning a list of commits for the given assignment for the current user.
func GetUserMeAssignmentCommits(w http.ResponseWriter, tx *sql.Tx, currentUser *User, params martini.Params, render render.Render) {
	assignmentID, err := strconv.Atoi(params["assignment_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	commits := []*Commit{}
	if err := meddler.QueryAll(tx, &commits, `SELECT * FROM commits WHERE user_id = $1 AND assignment_id = $2 ORDER BY created_at`, currentUser.ID, assignmentID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
	render.JSON(http.StatusOK, commits)
}

// GetUserMeAssignmentCommitLast handles requests to /v2/users/me/assignments/:assignment_id/commits/last,
// returning the most recent commit for the given assignment for the current user.
func GetUserMeAssignmentCommitLast(w http.ResponseWriter, tx *sql.Tx, currentUser *User, params martini.Params, render render.Render) {
	assignmentID, err := strconv.Atoi(params["assignment_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	commit := new(Commit)
	if err := meddler.QueryRow(tx, commit, `SELECT * FROM commits WHERE user_id = $1 AND assignment_id = $2 ORDER BY created_at DESC LIMIT 1`, currentUser.ID, assignmentID); err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}
	render.JSON(http.StatusOK, commit)
}

// GetUserMeAssignmentCommit handles requests to /v2/users/me/assignments/:assignment_id/commits/:commit_id,
// returning the given commit for the given assignment for the current user.
func GetUserMeAssignmentCommit(w http.ResponseWriter, tx *sql.Tx, currentUser *User, params martini.Params, render render.Render) {
	assignmentID, err := strconv.Atoi(params["assignment_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	commitID, err := strconv.Atoi(params["commit_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing commit_id from URL: %v", err)
		return
	}

	commit := new(Commit)
	if err := meddler.QueryRow(tx, commit, `SELECT * FROM commits WHERE id = $1 AND user_id = $2 AND assignment_id = $3`, commitID, currentUser.ID, assignmentID); err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}
	render.JSON(http.StatusOK, commit)
}

// GetUserAssignmentCommits handles requests to /v2/users/:user_id/assignments/:assignment_id/commits,
// returning a list of commits for the given assignment for the given user.
func GetUserAssignmentCommits(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	userID, err := strconv.Atoi(params["user_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	assignmentID, err := strconv.Atoi(params["assignment_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	commits := []*Commit{}
	if err := meddler.QueryAll(tx, &commits, `SELECT * FROM commits WHERE user_id = $1 AND assignment_id = $2 ORDER BY created_at`, userID, assignmentID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
	render.JSON(http.StatusOK, commits)
}

// GetUserAssignmentCommitLast handles requests to /v2/users/:user_id/assignments/:assignment_id/commits/last,
// returning the most recent commit for the given assignment for the given user.
func GetUserAssignmentCommitLast(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	userID, err := strconv.Atoi(params["user_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	assignmentID, err := strconv.Atoi(params["assignment_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	commit := new(Commit)
	if err := meddler.QueryRow(tx, commit, `SELECT * FROM commits WHERE user_id = $1 AND assignment_id = $2 ORDER BY created_at DESC LIMIT 1`, userID, assignmentID); err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}
	render.JSON(http.StatusOK, commit)
}

// GetUserAssignmentCommit handles requests to /v2/users/me/assignments/:assignment_id/commits/:commit_id,
// returning the given commit for the given assignment for the given user.
func GetUserAssignmentCommit(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	userID, err := strconv.Atoi(params["user_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	assignmentID, err := strconv.Atoi(params["assignment_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	commitID, err := strconv.Atoi(params["commit_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing commit_id from URL: %v", err)
		return
	}

	commit := new(Commit)
	if err := meddler.QueryRow(tx, commit, `SELECT * FROM commits WHERE id = $1 AND user_id = $2 AND assignment_id = $3`, commitID, userID, assignmentID); err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}
	render.JSON(http.StatusOK, commit)
}

// DeleteUserAssignmentCommits handles requests to /v2/users/:user_id/assignments/:assignment_id/commits,
// deleting all commits for the given assignment for the given user.
func DeleteUserAssignmentCommits(w http.ResponseWriter, tx *sql.Tx, params martini.Params) {
	userID, err := strconv.Atoi(params["user_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	assignmentID, err := strconv.Atoi(params["assignment_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	if _, err := tx.Exec(`DELETE FROM commits WHERE user_id = $1 AND assignment_id = $2`, userID, assignmentID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
}

// DeleteUserAssignmentCommit handles requests to /v2/users/:user_id/assignments/:assignment_id/commits/:commit_id,
// deleting the given commits for the given assignment for the given user.
func DeleteUserAssignmentCommit(w http.ResponseWriter, tx *sql.Tx, params martini.Params) {
	userID, err := strconv.Atoi(params["user_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	assignmentID, err := strconv.Atoi(params["assignment_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	commitID, err := strconv.Atoi(params["commit_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing commit_id from URL: %v", err)
		return
	}

	if _, err = tx.Exec(`DELETE FROM commits WHERE id = $1 AND user_id = $2 AND assignment_id = $3`, commitID, userID, assignmentID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
}

/*
// PostUserAssignmentCommit handles requests to /v2/users/me/assignments/:assignment_id/commits,
// adding a new commit (or updating the most recent one) for the given assignment for the current user.
func PostUserAssignmentCommit(w http.ResponseWriter, tx *sql.Tx, currentUser *User, params martini.Params, commit Commit, render render.Render) {
	now := time.Now()

	assignmentID, err := strconv.Atoi(params["assignment_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	// get the assignment and make sure it is for this user
	assignment := new(Assignment)
	if err = meddler.QueryRow(tx, assignment, `SELECT * FROM assignments WHERE id = $1 AND user_id = $2`, assignmentID, currentUser.ID); err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	// get the problem
	problem := new(Problem)
	if err = meddler.QueryRow(tx, problem, `SELECT problems.* FROM problems JOIN assignments ON problems.ID = assignments.problem_id WHERE assignments.id = $1 LIMIT 1`, assignmentID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	// validate commit
	if commit.Step > len(problem.Steps) {
		loggedHTTPErrorf(w, http.StatusBadRequest, "commit has step number %d, but there are only %d steps in the problem", commit.Step, len(problem.Steps))
		return
	}
	whitelists := getStepWhitelists(problem)
	if err = commit.normalize(now, whitelists[commit.Step-1]); err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "%v", err)
		return
	}

	// is this a signed commit from the daycare?
	if commit.Action != "" && commit.Signature != "" && commit.ReportCard != nil && len(commit.Transcript) > 0 {
		// validate the signature
		if commit.ProblemSignature != problem.Signature {
			loggedHTTPErrorf(w, http.StatusBadRequest, "problem signature for this commit does not match the current problem signature; please update the problem and re-run the test")
			return
		}
		age := now.Sub(commit.UpdatedAt)
		if age < 0 {
			age = -age
		}
		if age > signedCommitTimeout {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit signature has expired")
			return
		}
		if commit.computeSignature(Config.DaycareSecret) != commit.Signature {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit signature is incorrect")
			return
		}

		// post grade to LMS using LTI
		if err := saveGrade(tx, &commit, assignment, currentUser); err != nil {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "error posting grade back to LMS: %v", err)
			return
		}
	}

	openCommit := new(Commit)
	if err = meddler.QueryRow(tx, openCommit, `SELECT * FROM commits WHERE assignment_id = $1 AND problem_step_number = $2 AND action IS NULL AND updated_at > $3 LIMIT 1`, assignmentID, commit.ProblemStepNumber, now.Add(-openCommitTimeout)); err != nil {
		if err == sql.ErrNoRows {
			openCommit = nil
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
			return
		}
	}

	// update an existing commit?
	if openCommit != nil {
		commit.ID = openCommit.ID
		commit.CreatedAt = openCommit.CreatedAt
	} else {
		commit.ID = 0
		commit.CreatedAt = now
	}
	commit.AssignmentID = assignmentID
	commit.UserID = currentUser.ID
	commit.UpdatedAt = now

	if err := meddler.Save(tx, "commits", &commit); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	// sign the commit for execution
	if commit.Action != "" && commit.Signature == "" && commit.ReportCard == nil && len(commit.Transcript) == 0 {
		commit.ProblemSignature = problem.Signature
		commit.Signature = commit.computeSignature(Config.DaycareSecret)
	}

	render.JSON(http.StatusOK, &commit)
}
*/
