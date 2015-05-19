package main

import (
	"database/sql"
	"net/http"
	"strings"
	"time"

	"github.com/go-martini/martini"
	"github.com/martini-contrib/render"
	"github.com/martini-contrib/sessions"
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

func LoadCurrentUser(w http.ResponseWriter, context martini.Context, db *sql.Tx, session sessions.Session) {
	// proceed only if user is already signed in
	rawID := session.Get("user_id")
	if rawID == nil {
		logi.Printf("invalid session: no user id found")
		http.Error(w, "must be logged in: try connecting through Canvas", http.StatusUnauthorized)
		return
	}

	userID, ok := rawID.(int)
	if !ok {
		session.Clear()
		loge.Printf("Error converting rawID value %#v to an int", rawID)
		http.Error(w, "error getting user ID", http.StatusUnauthorized)
		return
	}
	user := new(User)

	// load user from database using the session user ID
	if err := meddler.Load(db, "users", user, int64(userID)); err != nil {
		if err == sql.ErrNoRows {
			logi.Printf("no such user error")
			http.Error(w, "user not found", http.StatusUnauthorized)
			return
		}
		loge.Printf("error loading user %d: %v", userID, err)
		http.Error(w, "DB error loading user", http.StatusInternalServerError)
		return
	}

	// map the current user to the request context
	context.Map(user)
}

func UserMe(currentUser *User, render render.Render) {
	render.JSON(http.StatusOK, currentUser)
}

func (user *User) GetInstructorCourses(db *sql.Tx) ([]int, error) {
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
