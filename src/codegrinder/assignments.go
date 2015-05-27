package main

import (
	"database/sql"
	"net/http"
	"strconv"
	"time"

	"github.com/go-martini/martini"
	"github.com/martini-contrib/render"
	"github.com/russross/meddler"
)

type Assignment struct {
	ID                 int            `json:"id" meddler:"id,pk"`
	CourseID           int            `json:"courseID" meddler:"course_id"`
	ProblemID          int            `json:"problemID" meddler:"problem_id"`
	UserID             int            `json:"userID" meddler:"user_id"`
	Roles              string         `json:"roles" meddler:"roles"`
	Points             float64        `json:"points" meddler:"points,zeroisnull"`
	Survey             map[string]int `json:"survey" meddler:"survey,json"`
	GradeID            string         `json:"-" meddler:"grade_id,zeroisnull"`
	LtiID              string         `json:"-" meddler:"lti_id"`
	CanvasTitle        string         `json:"canvasTitle" meddler:"canvas_title"`
	CanvasID           int            `json:"canvasID" meddler:"canvas_id"`
	CanvasAPIDomain    string         `json:"canvasAPIDomain" meddler:"canvas_api_domain"`
	OutcomeURL         string         `json:"-" meddler:"outcome_url"`
	OutcomeExtURL      string         `json:"-" meddler:"outcome_ext_url"`
	OutcomeExtAccepted string         `json:"-" meddler:"outcome_ext_accepted"`
	FinishedURL        string         `json:"finishedURL" meddler:"finished_url"`
	ConsumerKey        string         `json:"-" meddler:"consumer_key"`
	CreatedAt          time.Time      `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt          time.Time      `json:"updatedAt" meddler:"updated_at,localtime"`
}

// GetMeAssignments handles requests to /api/v2/users/me/assignments,
// returning a list of assignments for the current user.
func GetMeAssignments(w http.ResponseWriter, tx *sql.Tx, currentUser *User, render render.Render) {
	assignments := []*Assignment{}
	if err := meddler.QueryAll(tx, &assignments, `SELECT * FROM assignments WHERE user_id = $1`, currentUser.ID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error getting all assignments for user %d: %v", currentUser.ID, err)
		return
	}
	render.JSON(http.StatusOK, assignments)
}

// GetMeAssignment handles requests to /api/v2/users/me/assignments/:assignment_id,
// returning the given assignment for the current user.
func GetMeAssignment(w http.ResponseWriter, tx *sql.Tx, currentUser *User, params martini.Params, render render.Render) {
	assignmentID, err := strconv.Atoi(params["assignment_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	assignment := new(Assignment)
	if err := meddler.QueryRow(tx, assignment, `SELECT * FROM assignments WHERE id = $1 AND user_id = $2`, assignmentID, currentUser.ID); err != nil {
		if err == sql.ErrNoRows {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "no assignment %d found for user %d", assignmentID, currentUser.ID)
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error getting assignment %d for user %d: %v", assignmentID, currentUser.ID, err)
		}
		return
	}
	render.JSON(http.StatusOK, assignment)
}

// GetUserAssignments handles requests to /api/v2/users/me/assignments,
// returning a list of assignments for the current user.
func GetUserAssignments(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	userID, err := strconv.Atoi(params["user_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing user_id from URL: %v", err)
		return
	}

	assignments := []*Assignment{}
	if err := meddler.QueryAll(tx, &assignments, `SELECT * FROM assignments WHERE user_id = $1`, userID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error getting all assignments for user %d: %v", userID, err)
		return
	}
	render.JSON(http.StatusOK, assignments)
}

// GetUserAssignment handles requests to /api/v2/users/:user_id/assignments/:assignment_id,
// returning the given assignment for the given user.
func GetUserAssignment(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	userID, err := strconv.Atoi(params["user_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing user_id from URL: %v", err)
		return
	}

	assignmentID, err := strconv.Atoi(params["assignment_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	assignment := new(Assignment)
	if err := meddler.QueryRow(tx, assignment, `SELECT * FROM assignments WHERE id = $1 AND user_id = $1`, assignmentID, userID); err != nil {
		if err == sql.ErrNoRows {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "no assignment %d found for user %d", assignmentID, userID)
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error getting assignment %d for user %d: %v", assignmentID, userID, err)
		}
		return
	}
	render.JSON(http.StatusOK, assignment)
}

// DeleteUserAssignment handles requests to /api/v2/users/:user_id/assignments/:assignment_id,
// deleting the given assignment for the given user.
func DeleteUserAssignment(w http.ResponseWriter, tx *sql.Tx, params martini.Params) {
	userID, err := strconv.Atoi(params["user_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing user_id from URL: %v", err)
		return
	}

	assignmentID, err := strconv.Atoi(params["assignment_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	if _, err := tx.Exec(`DELETE FROM assignments WHERE id = $1 AND user_id = $2`, assignmentID, userID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error deleting assignment %d for user %d: %v", assignmentID, userID, err)
		return
	}
}
