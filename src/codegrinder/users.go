package main

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-martini/martini"
	"github.com/martini-contrib/render"
	"github.com/russross/meddler"
)

type User struct {
	ID             int       `json:"id" meddler:"id,pk"`
	Name           string    `json:"name" meddler:"name"`
	Email          string    `json:"email" meddler:"email"`
	LtiID          string    `json:"ltiID" meddler:"lti_id"`
	ImageURL       string    `json:"imageURL" meddler:"lti_image_url"`
	CanvasLogin    string    `json:"canvasLogin" meddler:"canvas_login"`
	CanvasID       int       `json:"canvasID" meddler:"canvas_id"`
	CreatedAt      time.Time `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt      time.Time `json:"updatedAt" meddler:"updated_at,localtime"`
	LastSignedInAt time.Time `json:"lastSignedInAt" meddler:"last_signed_in_at,localtime"`
}

// GetUsers handles /api/v2/users requests,
// returning a list of all users.
func GetUsers(w http.ResponseWriter, tx *sql.Tx, render render.Render) {
	users := []*User{}
	if err := meddler.QueryAll(tx, &users, `SELECT * FROM users ORDER BY id`); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error getting all users: %v", err)
		return
	}
	render.JSON(http.StatusOK, users)
}

// GetUserMe handles /api/v2/users/me requests,
// returning the current user.
func GetUserMe(w http.ResponseWriter, tx *sql.Tx, currentUser *User, render render.Render) {
	render.JSON(http.StatusOK, currentUser)
}

// GetUser handles /api/v2/users/:user_id requests,
// returning a single user.
func GetUser(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	userID, err := strconv.Atoi(params["user_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing user_id from URL: %v", err)
		return
	}

	user := new(User)
	if err := meddler.Load(tx, "users", user, int64(userID)); err != nil {
		if err == sql.ErrNoRows {
			loggedHTTPErrorf(w, http.StatusNotFound, "user %d not found", userID)
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error loading user %d: %v", userID, err)
		}
		return
	}
	render.JSON(http.StatusOK, user)
}

// GetCourseUsers handles request to /api/v2/course/:course_id/users,
// returning a list of users in the given course.
func GetCourseUsers(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	courseID, err := strconv.Atoi(params["course_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing course_id from URL: %v", err)
		return
	}

	users := []*User{}
	if err := meddler.QueryAll(tx, &users, `SELECT DISTINCT users.* FROM users INNER JOIN assignments ON users.ID = assignments.user_id WHERE assignments.course_id = $1 ORDER BY users.ID`, courseID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error getting all users for course %d: %v", courseID, err)
		return
	}
	render.JSON(http.StatusOK, users)
}

// DeleteUser handles /api/v2/users/:user_id requests,
// deleting a single user.
// This will also delete all assignments and commits related to the user.
func DeleteUser(w http.ResponseWriter, tx *sql.Tx, params martini.Params) {
	userID, err := strconv.Atoi(params["user_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing user_id from URL: %v", err)
		return
	}

	if _, err := tx.Exec(`DELETE FROM users WHERE id = $1`, userID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error deleting user %d: %v", userID, err)
		return
	}
}

func (user *User) getInstructorCourses(db *sql.Tx) ([]int, error) {
	assts := []*Assignment{}
	err := meddler.QueryAll(db, &assts, `SELECT * FROM assignments WHERE user_id = $1 AND roles LIKE '%Instructor%' ORDER BY updated_at DESC LIMIT 50`, user.ID)
	if err != nil {
		return nil, loggedErrorf("db error loading instructor assignments for user %d: %v", user.ID, err)
	}
	courseIDs := []int{}
	for _, elt := range assts {
		for _, role := range strings.Split(elt.Roles, ",") {
			if role == "Instructor" {
				courseIDs = append(courseIDs, elt.CourseID)
				break
			}
		}
	}
	return courseIDs, nil
}

func (user *User) isInstructor(tx *sql.Tx) (bool, error) {
	courses, err := user.getInstructorCourses(tx)
	return len(courses) > 0, err
}

func (user *User) isAdministrator() bool {
	for _, email := range Config.AdministratorEmails {
		if email == user.Email {
			return true
		}
	}
	return false
}
