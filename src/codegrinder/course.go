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

type Course struct {
	ID        int       `json:"id" meddler:"id,pk"`
	Name      string    `json:"name" meddler:"name"`
	Label     string    `json:"label" meddler:"lti_label"`
	LtiID     string    `json:"ltiID" meddler:"lti_id"`
	CanvasID  int       `json:"canvasID" meddler:"canvas_id"`
	CreatedAt time.Time `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt time.Time `json:"updatedAt" meddler:"updated_at,localtime"`
}

// GetCourses handles /api/v2/courses requests,
// returning a list of all courses.
//
// If parameter lti_label=<...> present, results will be filtered by matching lti_label field.
// If parameter name=<...> present, results will be filtered by case-insensitive substring matching on name field.
func GetCourses(w http.ResponseWriter, r *http.Request, tx *sql.Tx, render render.Render) {
	courses := []*Course{}
	where := ""
	args := []interface{}{}
	if lti_label := r.FormValue("lti_label"); lti_label != "" {
		where, args = addWhereEq(where, args, "lti_label", lti_label)
	}
	if name := r.FormValue("name"); name != "" {
		where, args = addWhereLike(where, args, "name", name)
	}
	if err := meddler.QueryAll(tx, &courses, `SELECT * FROM courses`+where+` ORDER BY lti_label`, args...); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error getting all courses: %v", err)
		return
	}
	render.JSON(http.StatusOK, courses)
}

// GetCourse handles /api/v2/courses/:course_id requests,
// returning a single course.
func GetCourse(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	courseID, err := strconv.Atoi(params["course_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing course_id from URL: %v", err)
		return
	}

	course := new(Course)
	if err := meddler.Load(tx, "courses", course, int64(courseID)); err != nil {
		if err == sql.ErrNoRows {
			loggedHTTPErrorf(w, http.StatusNotFound, "course %d not found", courseID)
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error loading course %d: %v", courseID, err)
		}
		return
	}
	render.JSON(http.StatusOK, course)
}

// DeleteCourse handles /api/v2/courses/:course_id requests,
// deleting a single course.
// This will also delete all assignments and commits related to the course.
func DeleteCourse(w http.ResponseWriter, tx *sql.Tx, params martini.Params) {
	courseID, err := strconv.Atoi(params["course_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing course_id from URL: %v", err)
		return
	}

	if _, err := tx.Exec(`DELETE FROM courses WHERE id = $1`, courseID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error deleting course %d: %v", courseID, err)
		return
	}
}
