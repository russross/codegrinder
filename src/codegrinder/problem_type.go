package main

import (
	"net/http"
	"time"

	"github.com/go-martini/martini"
	"github.com/martini-contrib/render"
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
	Image       string                        `json:"image"`
	MaxCPU      int                           `json:"maxcpu"`
	MaxFD       int                           `json:"maxfd"`
	MaxFileSize int                           `json:"maxfilesize"`
	MaxMemory   int                           `json:"maxmemory"`
	MaxThreads  int                           `json:"maxthreads"`
	Actions     map[string]*ProblemTypeAction `json:"actions"`
	Files       map[string]string             `json:"files,omitempty"`
}

// ProblemTypeAction defines the label, button, UI classes, and handler for a
// single problem type action.
type ProblemTypeAction struct {
	Action  string `json:"action,omitempty"`
	Button  string `json:"button,omitempty"`
	Message string `json:"message,omitempty"`
	Class   string `json:"className,omitempty"`
	handler nannyHandler
}

type nannyHandler func(*Nanny, []string, []string, map[string]string)

// GetProblemTypes handles a request to /api/v2/problemtypes,
// returning a complete list of problem types.
func GetProblemTypes(w http.ResponseWriter, render render.Render) {
	render.JSON(http.StatusOK, problemTypes)
}

// GetProblemType handles a request to /api/v2/problemtypes/:name,
// returning a single problem type with the given name.
func GetProblemType(w http.ResponseWriter, params martini.Params, render render.Render) {
	name := params["name"]

	problemType, exists := problemTypes[name]

	if !exists {
		loggedHTTPErrorf(w, http.StatusNotFound, "Problem type %q not found", name)
		return
	}

	render.JSON(http.StatusOK, problemType)
}
