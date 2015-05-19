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

type Problem struct {
	ID            int       `json:"id" meddler:"id,pk"`
	ProblemTypeID int       `json:"problemTypeId" meddler:"problem_type_id"`
	Name          string    `json:"name" meddler:"name"`
	Unique        string    `json:"unique" meddler:"unique_id"`
	Description   string    `json:"description" meddler:"description,zeroisnull"`
	Tags          []string  `json:"tags" meddler:"tags,json"`
	Options       []string  `json:"options" meddler:"options,json"`
	CreatedAt     time.Time `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt     time.Time `json:"updatedAt" meddler:"updated_at,localtime"`

	problemSteps []*ProblemStep `json:"-" meddler:"-"`
	problemType  *ProblemType   `json:"-" meddler:"-"`
}

// filter out files with underscore prefix
func (p *Problem) FilterOutgoing() {
	for _, step := range p.problemSteps {
		step.FilterOutgoing()
	}
}

// fix line endings
func (p *Problem) FilterIncoming() {
	for _, step := range p.problemSteps {
		step.FilterIncoming()
	}
}

// GetProblems handles /api/v2/problems requests, returning a list of all problems.
func GetProblems(w http.ResponseWriter, db *sql.Tx, render render.Render) {
	problems := []*Problem{}
	if err := meddler.QueryAll(db, &problems, `SELECT * FROM problems`); err != nil {
		loge.Printf("db error getting problem list: %v", err)
		http.Error(w, "DB error getting problem list", http.StatusInternalServerError)
		return
	}

	render.JSON(http.StatusOK, problems)
}

// GetProblem handles /api/v2/problems/:problem_id requests, returning a single problem.
func GetProblem(w http.ResponseWriter, db *sql.Tx, params martini.Params, render render.Render) {
	problemID, err := strconv.Atoi(params["problem_id"])
	if err != nil {
		loge.Printf("error parsing problemID from URL: %v", err)
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}

	problem := new(Problem)
	if err := meddler.Load(db, "problems", problem, int64(problemID)); err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "Problem not found", http.StatusNotFound)
		} else {
			http.Error(w, "DB error loading problem", http.StatusInternalServerError)
		}
		return
	}

	problem.FilterOutgoing()
	render.JSON(http.StatusOK, problem)
}
