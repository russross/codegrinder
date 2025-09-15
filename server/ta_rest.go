package main

import (
	"compress/gzip"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-martini/martini"
	"github.com/martini-contrib/binding"
	"github.com/martini-contrib/render"
	. "github.com/russross/codegrinder/types"
	"github.com/russross/meddler"
)

// restGetProblemTypes handles GET /problem_types
func restGetProblemTypes(w http.ResponseWriter, tx *sql.Tx, render render.Render) {
	problemTypes, err := getProblemTypes(tx)
	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	render.JSON(http.StatusOK, problemTypes)
}

// restGetProblemType handles GET /problem_types/:name
func restGetProblemType(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	name := params["name"]

	problemType, err := getProblemType(tx, name)
	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	render.JSON(http.StatusOK, problemType)
}

// restGetProblems handles GET /problems
func restGetProblems(w http.ResponseWriter, r *http.Request, tx *sql.Tx, currentUser *User, render render.Render) {
	problems, err := getProblems(tx, currentUser, r.FormValue("unique"), r.FormValue("problemType"), r.FormValue("note"))
	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	render.JSON(http.StatusOK, problems)
}

// restGetProblem handles GET /problems/:problem_id
func restGetProblem(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	problemID, err := parseID(w, "problem_id", params["problem_id"])
	if err != nil {
		return
	}

	problem, err := getProblem(tx, problemID, currentUser)
	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	render.JSON(http.StatusOK, problem)
}

// restGetProblemSteps handles GET /problems/:problem_id/steps
func restGetProblemSteps(w http.ResponseWriter, r *http.Request, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	problemID, err := parseID(w, "problem_id", params["problem_id"])
	if err != nil {
		return
	}

	problemSteps, err := getProblemSteps(tx, problemID, currentUser)
	if err != nil {
		if err.Error() == "not found" {
			loggedHTTPErrorf(w, http.StatusNotFound, "not found")
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		}
		return
	}

	render.JSON(http.StatusOK, problemSteps)
}

// restGetProblemStep handles GET /problems/:problem_id/steps/:step
func restGetProblemStep(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	problemID, err := parseID(w, "problem_id", params["problem_id"])
	if err != nil {
		return
	}
	step, err := parseID(w, "step", params["step"])
	if err != nil {
		return
	}

	problemStep, err := getProblemStep(tx, problemID, step, currentUser)
	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	render.JSON(http.StatusOK, problemStep)
}

// restGetProblemSets handles GET /problem_sets
func restGetProblemSets(w http.ResponseWriter, r *http.Request, tx *sql.Tx, currentUser *User, render render.Render) {
	if err := r.ParseForm(); err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "parsing form data: %v", err)
		return
	}

	problemSets, err := getProblemSets(tx, currentUser, r.FormValue("unique"), r.FormValue("note"), r.Form["search"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	render.JSON(http.StatusOK, problemSets)
}

// restGetProblemSet handles GET /problem_sets/:problem_set_id
func restGetProblemSet(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	problemSetID, err := parseID(w, "problem_set_id", params["problem_set_id"])
	if err != nil {
		return
	}

	problemSet, err := getProblemSet(tx, problemSetID, currentUser)
	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	render.JSON(http.StatusOK, problemSet)
}

// restGetProblemSetProblems handles GET /problem_sets/:problem_set_id/problems
func restGetProblemSetProblems(w http.ResponseWriter, r *http.Request, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	problemSetID, err := parseID(w, "problem_set_id", params["problem_set_id"])
	if err != nil {
		return
	}

	problemSetProblems, err := getProblemSetProblems(tx, problemSetID, currentUser)
	if err != nil {
		if err.Error() == "not found" {
			loggedHTTPErrorf(w, http.StatusNotFound, "not found")
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		}
		return
	}

	render.JSON(http.StatusOK, problemSetProblems)
}

// restGetCourses handles GET /courses
func restGetCourses(w http.ResponseWriter, r *http.Request, tx *sql.Tx, currentUser *User, render render.Render) {
	courses, err := getCourses(tx, currentUser, r.FormValue("lti_label"), r.FormValue("name"))
	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
	render.JSON(http.StatusOK, courses)
}

// restGetCourse handles GET /courses/:course_id
func restGetCourse(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	courseID, err := parseID(w, "course_id", params["course_id"])
	if err != nil {
		return
	}

	course, err := getCourse(tx, courseID, currentUser)
	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}
	render.JSON(http.StatusOK, course)
}

// restGetUsers handles GET /users
func restGetUsers(w http.ResponseWriter, r *http.Request, tx *sql.Tx, currentUser *User, render render.Render) {
	users, err := getUsers(tx, currentUser, r.FormValue("name"), r.FormValue("email"), r.FormValue("instructor"), r.FormValue("admin"))
	if err != nil {
		if strings.Contains(err.Error(), "parsing") {
			loggedHTTPErrorf(w, http.StatusBadRequest, "%v", err)
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		}
		return
	}
	render.JSON(http.StatusOK, users)
}

// restGetUserMe handles GET /users/me
func restGetUserMe(w http.ResponseWriter, tx *sql.Tx, currentUser *User, render render.Render) {
	user, err := getUserMe(tx, currentUser)
	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "error: %v", err)
		return
	}
	render.JSON(http.StatusOK, user)
}

// restGetUserSession handles GET /users/session
func restGetUserSession(w http.ResponseWriter, r *http.Request, render render.Render) {
	key := r.FormValue("key")
	session, err := getUserSession(key)
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "%v", err)
		return
	}

	// Save the session to set the cookie
	cookieValue := session.Save(w)

	result := map[string]string{"cookie": fmt.Sprintf("%s=%s", CookieName, cookieValue)}
	render.JSON(http.StatusOK, result)
}

// restGetUser handles GET /users/:user_id
func restGetUser(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	userID, err := parseID(w, "user_id", params["user_id"])
	if err != nil {
		return
	}

	user, err := getUser(tx, userID, currentUser)
	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}
	render.JSON(http.StatusOK, user)
}

// restGetCourseUsers handles GET /courses/:course_id/users
func restGetCourseUsers(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	courseID, err := parseID(w, "course_id", params["course_id"])
	if err != nil {
		return
	}

	users, err := getCourseUsers(tx, courseID, currentUser)
	if err != nil {
		if err.Error() == "not found" {
			loggedHTTPErrorf(w, http.StatusNotFound, "not found")
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		}
		return
	}
	render.JSON(http.StatusOK, users)
}

// restGetUserAssignments handles GET /users/:user_id/assignments
func restGetUserAssignments(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	userID, err := parseID(w, "user_id", params["user_id"])
	if err != nil {
		return
	}

	assignments, err := getUserAssignments(tx, userID, currentUser)
	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
	render.JSON(http.StatusOK, assignments)
}

// restGetCourseUserAssignments handles GET /courses/:course_id/users/:user_id/assignments
func restGetCourseUserAssignments(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	courseID, err := parseID(w, "course_id", params["course_id"])
	if err != nil {
		return
	}
	userID, err := parseID(w, "user_id", params["user_id"])
	if err != nil {
		return
	}

	assignments, err := getCourseUserAssignments(tx, courseID, userID, currentUser)
	if err != nil {
		if err.Error() == "not found" {
			loggedHTTPErrorf(w, http.StatusNotFound, "not found")
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		}
		return
	}
	render.JSON(http.StatusOK, assignments)
}

// restGetAssignments handles GET /assignments
func restGetAssignments(w http.ResponseWriter, r *http.Request, tx *sql.Tx, currentUser *User, render render.Render) {
	if err := r.ParseForm(); err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "parsing form data: %v", err)
		return
	}

	assignments, err := getAssignments(tx, currentUser, r.Form["search"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
	render.JSON(http.StatusOK, assignments)
}

// restGetAssignment handles GET /assignments/:assignment_id
func restGetAssignment(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	assignmentID, err := parseID(w, "assignment_id", params["assignment_id"])
	if err != nil {
		return
	}

	assignment, err := getAssignment(tx, assignmentID, currentUser)
	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}
	render.JSON(http.StatusOK, assignment)
}

// restGetAssignmentProblemCommitLast handles GET /assignments/:assignment_id/problems/:problem_id/commits/last
func restGetAssignmentProblemCommitLast(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	assignmentID, err := parseID(w, "assignment_id", params["assignment_id"])
	if err != nil {
		return
	}
	problemID, err := parseID(w, "problem_id", params["problem_id"])
	if err != nil {
		return
	}

	commit, err := getAssignmentProblemCommitLast(tx, assignmentID, problemID, currentUser)
	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}
	render.JSON(http.StatusOK, commit)
}

// restGetAssignmentProblemStepCommitLast handles GET /assignments/:assignment_id/problems/:problem_id/steps/:step/commits/last
func restGetAssignmentProblemStepCommitLast(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
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

	commit, err := getAssignmentProblemStepCommitLast(tx, assignmentID, problemID, step, currentUser)
	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}
	render.JSON(http.StatusOK, commit)
}

// restPostProblemBundleUnconfirmed handles POST /problem_bundles/unconfirmed
func restPostProblemBundleUnconfirmed(w http.ResponseWriter, tx *sql.Tx, currentUser *User, bundle ProblemBundle, render render.Render) {
	result, err := signProblemBundleUnconfirmed(tx, currentUser, &bundle)
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "problem bundle error: %v", err)
		return
	}
	render.JSON(http.StatusOK, result)
}

// restPostProblemBundleConfirmed handles POST /problem_bundles/confirmed
func restPostProblemBundleConfirmed(w http.ResponseWriter, tx *sql.Tx, currentUser *User, bundle ProblemBundle, render render.Render) {
	result, err := saveProblemBundleCommon(tx, currentUser, &bundle)
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "problem bundle error: %v", err)
		return
	}
	render.JSON(http.StatusOK, result)
}

// restPutProblemBundle handles PUT /problem_bundles/:problem_id
func restPutProblemBundle(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, bundle ProblemBundle, render render.Render) {
	problemID, err := parseID(w, "problem_id", params["problem_id"])
	if err != nil {
		return
	}

	result, err := updateProblemBundle(tx, currentUser, problemID, &bundle)
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "problem bundle error: %v", err)
		return
	}
	render.JSON(http.StatusOK, result)
}

// restPostProblemSetBundle handles POST /problem_set_bundles
func restPostProblemSetBundle(w http.ResponseWriter, tx *sql.Tx, currentUser *User, bundle ProblemSetBundle, render render.Render) {
	result, err := createProblemSetBundle(tx, &bundle)
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "problem set bundle error: %v", err)
		return
	}
	render.JSON(http.StatusOK, result)
}

// restPutProblemSetBundle handles PUT /problem_set_bundles/:problem_set_id
func restPutProblemSetBundle(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, bundle ProblemSetBundle, render render.Render) {
	result, err := updateProblemSetBundle(tx, &bundle)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			loggedHTTPErrorf(w, http.StatusNotFound, "%v", err)
		} else {
			loggedHTTPErrorf(w, http.StatusBadRequest, "problem set bundle error: %v", err)
		}
		return
	}
	render.JSON(http.StatusOK, result)
}

// restPostCommitBundlesUnsigned handles POST /commit_bundles/unsigned
func restPostCommitBundlesUnsigned(w http.ResponseWriter, tx *sql.Tx, currentUser *User, bundle CommitBundle, render render.Render) {
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
	result, err := saveCommitBundleCommon(now, tx, currentUser, &bundle)
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "commit bundle error: %v", err)
		return
	}
	render.JSON(http.StatusOK, result)
}

// restPostCommitBundlesSigned handles POST /commit_bundles/signed
func restPostCommitBundlesSigned(w http.ResponseWriter, tx *sql.Tx, currentUser *User, bundle CommitBundle, render render.Render) {
	now := time.Now()

	if bundle.Commit == nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "bundle must include a commit object")
		return
	}
	if len(bundle.CommitSignature) == 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "bundle must include commit signature")
		return
	}
	result, err := saveCommitBundleCommon(now, tx, currentUser, &bundle)
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "commit bundle error: %v", err)
		return
	}
	render.JSON(http.StatusOK, result)
}

// SetupTARest sets up all TA REST routes using martini.
// It takes the neutral withTx function and defines all martini middleware as closures.
func SetupTARest(r martini.Router, withTx func(func(*sql.Tx) error) error) {
	// martini service: wrap handler in a transaction
	martiniWithTx := func(c martini.Context, req *http.Request, w http.ResponseWriter) {
		status := 0
		err := withTx(func(tx *sql.Tx) error {
			// pass it on to the main handler
			c.Map(tx)
			c.Next()

			// check the result status
			rw := w.(martini.ResponseWriter)
			if status = rw.Status(); status >= http.StatusBadRequest {
				return fmt.Errorf("handler returned status %d", status)
			}
			return nil
		})
		if err != nil {
			if status >= http.StatusBadRequest && status != http.StatusNotFound {
				loggedHTTPErrorf(w, status, "%v", err)
			}
		}
	}

	// martini service: to require an active logged-in session
	martiniAuth := func(w http.ResponseWriter, req *http.Request) {
		_, err := GetSession(req)
		if err != nil {
			loggedHTTPErrorf(w, http.StatusUnauthorized, "authentication failed: try logging in again")
			log.Printf("%v", err)
			return
		}
	}

	// martini service: include the current logged-in user (requires martiniWithTx)
	martiniWithCurrentUser := func(c martini.Context, w http.ResponseWriter, req *http.Request, tx *sql.Tx) {
		session, err := GetSession(req)
		if err != nil {
			loggedHTTPErrorf(w, http.StatusUnauthorized, "authentication failed: try logging in again")
			log.Printf("%v", err)
			return
		}

		// load the user record
		userID := session.UserID
		user := new(User)
		if err := meddler.Load(tx, "users", user, userID); err != nil {
			session.Delete(w)

			if err == sql.ErrNoRows {
				loggedHTTPErrorf(w, http.StatusUnauthorized, "user %d not found", userID)
				return
			}
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
			return
		}

		// map the current user to the request context
		c.Map(user)
	}

	// martini service: require logged in user to be an author (requires martiniWithCurrentUser)
	martiniAuthorOnly := func(w http.ResponseWriter, tx *sql.Tx, currentUser *User) {
		if !currentUser.Author {
			loggedHTTPErrorf(w, http.StatusUnauthorized, "user %d (%s) is not an author", currentUser.ID, currentUser.Name)
			return
		}
	}

	// martini middleware: decompress incoming requests
	gunzipMiddleware := func(c martini.Context, w http.ResponseWriter, req *http.Request) {
		if req.Header.Get("Content-Encoding") != "gzip" {
			return
		}

		req.Header.Del("Content-Encoding")
		body := req.Body
		var err error
		req.Body, err = gzip.NewReader(body)
		defer body.Close()
		if err != nil {
			loggedHTTPErrorf(w, http.StatusBadRequest, "gzip error in request: %v", err)
			return
		}
		c.Next()
	}

	// version
	r.Get("/version", func(w http.ResponseWriter, render render.Render) {
		render.JSON(http.StatusOK, &CurrentVersion)
	})

	// daycare registration
	r.Get("/daycare_registrations",
		func(w http.ResponseWriter, render render.Render) {
			daycareRegistrations.Expire()
			render.JSON(http.StatusOK, daycareRegistrations.daycares)
		})
	r.Post("/daycare_registrations", gunzipMiddleware, binding.Json(DaycareRegistration{}),
		func(w http.ResponseWriter, reg DaycareRegistration) {
			daycareRegistrations.Expire()
			if err := daycareRegistrations.Insert(&reg); err != nil {
				loggedHTTPErrorf(w, http.StatusBadRequest, "bad daycare registration: %v", err)
				return
			}
		})

	// problem bundles--for problem creation only
	r.Post("/problem_bundles/unconfirmed", martiniWithTx, martiniWithCurrentUser, martiniAuthorOnly, gunzipMiddleware, binding.Json(ProblemBundle{}), restPostProblemBundleUnconfirmed)
	r.Post("/problem_bundles/confirmed", martiniWithTx, martiniWithCurrentUser, martiniAuthorOnly, gunzipMiddleware, binding.Json(ProblemBundle{}), restPostProblemBundleConfirmed)
	r.Put("/problem_bundles/:problem_id", martiniWithTx, martiniWithCurrentUser, martiniAuthorOnly, gunzipMiddleware, binding.Json(ProblemBundle{}), restPutProblemBundle)

	// problem set bundles--for problem set creation only
	r.Post("/problem_set_bundles", martiniWithTx, martiniWithCurrentUser, martiniAuthorOnly, gunzipMiddleware, binding.Json(ProblemSetBundle{}), restPostProblemSetBundle)
	r.Put("/problem_set_bundles/:problem_set_id", martiniWithTx, martiniWithCurrentUser, martiniAuthorOnly, gunzipMiddleware, binding.Json(ProblemSetBundle{}), restPutProblemSetBundle)

	// problem types
	r.Get("/problem_types", martiniAuth, martiniWithTx, restGetProblemTypes)
	r.Get("/problem_types/:name", martiniAuth, martiniWithTx, restGetProblemType)

	// problems
	r.Get("/problems", martiniWithTx, martiniWithCurrentUser, restGetProblems)
	r.Get("/problems/:problem_id", martiniWithTx, martiniWithCurrentUser, restGetProblem)
	r.Get("/problems/:problem_id/steps", martiniWithTx, martiniWithCurrentUser, restGetProblemSteps)
	r.Get("/problems/:problem_id/steps/:step", martiniWithTx, martiniWithCurrentUser, restGetProblemStep)
	// problem sets
	r.Get("/problem_sets", martiniWithTx, martiniWithCurrentUser, restGetProblemSets)
	r.Get("/problem_sets/:problem_set_id", martiniWithTx, martiniWithCurrentUser, restGetProblemSet)
	r.Get("/problem_sets/:problem_set_id/problems", martiniWithTx, martiniWithCurrentUser, restGetProblemSetProblems)

	// courses
	r.Get("/courses", martiniWithTx, martiniWithCurrentUser, restGetCourses)
	r.Get("/courses/:course_id", martiniWithTx, martiniWithCurrentUser, restGetCourse)

	// users
	r.Get("/users", martiniWithTx, martiniWithCurrentUser, restGetUsers)
	r.Get("/users/me", martiniWithTx, martiniWithCurrentUser, restGetUserMe)
	r.Get("/users/session", restGetUserSession)
	r.Get("/users/:user_id", martiniWithTx, martiniWithCurrentUser, restGetUser)
	r.Get("/courses/:course_id/users", martiniWithTx, martiniWithCurrentUser, restGetCourseUsers)

	// assignments
	r.Get("/users/:user_id/assignments", martiniWithTx, martiniWithCurrentUser, restGetUserAssignments)
	r.Get("/courses/:course_id/users/:user_id/assignments", martiniWithTx, martiniWithCurrentUser, restGetCourseUserAssignments)
	r.Get("/assignments", martiniWithTx, martiniWithCurrentUser, restGetAssignments)
	r.Get("/assignments/:assignment_id", martiniWithTx, martiniWithCurrentUser, restGetAssignment)

	// commits
	r.Get("/assignments/:assignment_id/problems/:problem_id/commits/last", martiniWithTx, martiniWithCurrentUser, restGetAssignmentProblemCommitLast)
	r.Get("/assignments/:assignment_id/problems/:problem_id/steps/:step/commits/last", martiniWithTx, martiniWithCurrentUser, restGetAssignmentProblemStepCommitLast)

	// commit bundles
	r.Post("/commit_bundles/unsigned", martiniWithTx, martiniWithCurrentUser, gunzipMiddleware, binding.Json(CommitBundle{}), restPostCommitBundlesUnsigned)
	r.Post("/commit_bundles/signed", martiniWithTx, martiniWithCurrentUser, gunzipMiddleware, binding.Json(CommitBundle{}), restPostCommitBundlesSigned)
}
