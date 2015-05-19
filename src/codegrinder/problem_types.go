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

func GetProblemTypes(w http.ResponseWriter, render render.Render) {
	render.JSON(http.StatusOK, problemTypes)
}

func GetProblemType(w http.ResponseWriter, params martini.Params, render render.Render) {
	name := params["name"]

	if problemType, exists := problemTypes[name]; !exists {
		loge.Print(HTTPErrorf(w, http.StatusNotFound, "Problem type %q not found", name))
		return
	} else {
		render.JSON(http.StatusOK, problemType)
	}
}
