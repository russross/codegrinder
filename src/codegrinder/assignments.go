package main

import (
	"database/sql"
	"net/http"
	"strconv"
	"time"

	"github.com/go-martini/martini"
	"github.com/martini-contrib/render"
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

func GetAssignment(w http.ResponseWriter, currentUser *User, db *sql.Tx, params martini.Params, render render.Render) {
	assignmentID, err := strconv.Atoi(params["assignment_id"])
	if err != nil {
		loge.Printf("error parsing assignmentID from URL: %v", err)
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}

	assignment := loadAssignment(w, currentUser, db, assignmentID)
	if assignment == nil {
		return
	}

	render.JSON(http.StatusOK, assignment)
}
