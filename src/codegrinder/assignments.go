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
	CourseID           int            `json:"courseId" meddler:"course_id"`
	ProblemID          int            `json:"problemId" meddler:"problem_id"`
	UserID             int            `json:"userId" meddler:"user_id"`
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

func GetAssignment(w http.ResponseWriter, currentUser *User, tx *sql.Tx, params martini.Params, render render.Render) {
	assignmentID, err := strconv.Atoi(params["assignment_id"])
	if err != nil {
		loge.Print(HTTPErrorf(w, http.StatusBadRequest, "error parsing assignmentID from URL: %v", err))
		return
	}

	assignment := new(Assignment)
	if err := meddler.Load(tx, "assignments", assignment, int64(assignmentID)); err != nil {
		if err == sql.ErrNoRows {
			loge.Print(HTTPErrorf(w, http.StatusNotFound, "Assignment not found"))
			return
		}
		loge.Print(HTTPErrorf(w, http.StatusInternalServerError, "db error loading assignment %d: %v", assignmentID, err))
		return
	}

	// authorized?
	if currentUser.ID != assignment.UserID {
		// see if this user is an instructor for the course
		// if so, access to student commits is okay
		courses, err := currentUser.GetInstructorCourses(tx)
		if err != nil {
			loge.Print(HTTPErrorf(w, http.StatusInternalServerError, "DB error checking if the user is an instructor"))
			return
		}
		if !intContains(courses, assignment.CourseID) {
			loge.Print(HTTPErrorf(w, http.StatusUnauthorized, "user %d (%s) attempting to access assignment %d, belonging to user %d",
				currentUser.ID, currentUser.Email, assignment.ID, assignment.UserID))
			return
		}
	}

	render.JSON(http.StatusOK, assignment)
}
