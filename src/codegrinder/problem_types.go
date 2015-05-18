package main

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/go-martini/martini"
	"github.com/martini-contrib/render"
	"github.com/russross/meddler"
)

// ProblemType defines one type of problem.
type ProblemType struct {
	ID         int                    `json:"id" meddler:"id,pk"`
	Name       string                 `json:"name" meddler:"name"`
	Definition *ProblemTypeDefinition `json:"definition" meddler:"definition,json"`
	CreatedAt  time.Time              `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt  time.Time              `json:"updatedAt" meddler:"updated_at,localtime"`
}

// ProblemTypeDefinition defines the default parameters and actions of a problem type.
type ProblemTypeDefinition struct {
	MaxCPU      int                  `json:"maxcpu"`
	MaxFD       int                  `json:"maxfd"`
	MaxFileSize int                  `json:"maxfilesize"`
	MaxMemory   int                  `json:"maxmemory"`
	MaxThreads  int                  `json:"maxthreads"`
	Actions     []*ProblemTypeAction `json:"actions"`
	Files       map[string]string    `json:"files,omitempty"`
}

// ProblemTypeAction defines the label, button, UI classes, and handler for a
// single problem type action.
type ProblemTypeAction struct {
	Action  string `json:"action,omitempty"`
	Button  string `json:"button,omitempty"`
	Message string `json:"message,omitempty"`
	Class   string `json:"className,omitempty"`
	handler autoHandler
}

type autoHandler func([]string, []string, chan *EventMessage)

func GetProblemTypes(w http.ResponseWriter, tx *sql.Tx, render render.Render) {
	problemsTypes := []*ProblemType{}
	if err := meddler.QueryAll(tx, &problemTypes, `SELECT * FROM problem_types`); err != nil {
		loge.Print(HTTPErrorf(w, http.StatusInternalServerError, "DB error getting problem list: %v", err))
		return
	}

	render.JSON(http.StatusOK, problemTypes)
}

func GetProblemType(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	problemTypeID, err := stdconv.Atoi(params["id"])
	if err != nil {
		loge.Print(HTTPErrorf(w, http.StatusBadRequest, "Malformed problem ID in URL: %v", err))
		return
	}

	problemType := new(ProblemType)
	if err := meddler.Load(db, "problem_types", problemType, int64(problemTypeID)); err != nil {
		if err == sql.ErrNoRows {
			loge.Print(HTTPErrorf(w, http.StatusNotFound, "Problem not found"))
		} else {
			loge.Print(HTTPErrorf(w, http.StatusInternalServerError, "DB error loading problem: %v", err))
		}
		return
	}

	render.JSON(http.StatusOK, problemType)
}
