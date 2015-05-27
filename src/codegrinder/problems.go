package main

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-martini/martini"
	"github.com/martini-contrib/render"
	"github.com/russross/meddler"
)

// problem files in these directories do not have line endings cleaned up
var directoryWhitelist = map[string]bool{
	"in":   true,
	"out":  true,
	"_doc": true,
}

type Problem struct {
	ID          int            `json:"id" meddler:"id,pk"`
	ProblemType string         `json:"problemType" meddler:"problem_type"`
	Name        string         `json:"name" meddler:"name"`
	Unique      string         `json:"unique" meddler:"unique_id"`
	Description string         `json:"description" meddler:"description,zeroisnull"`
	Tags        []string       `json:"tags" meddler:"tags,json"`
	Options     []string       `json:"options" meddler:"options,json"`
	CreatedAt   time.Time      `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt   time.Time      `json:"updatedAt" meddler:"updated_at,localtime"`
	Steps       []*ProblemStep `json:"steps,omitempty" meddler:"steps,json"`
}

// filter out files with underscore prefix for non-instructors
func (problem *Problem) filterOutgoing(instructor bool) {
	for _, step := range problem.Steps {
		step.filterOutgoing(instructor)
	}
}

func (problem *Problem) filterIncoming() {
	for _, step := range problem.Steps {
		step.filterIncoming()
	}
}

type ProblemStep struct {
	Name        string            `json:"name" meddler:"name"`
	Description string            `json:"description" meddler:"description,zeroisnull"`
	ScoreWeight float64           `json:"scoreWeight" meddler:"score_weight"`
	Definition  map[string]string `json:"definition" meddler:"definition,json"`
}

// filter out files with underscore prefix for non-instructors
func (step *ProblemStep) filterOutgoing(instructor bool) {
	if instructor {
		return
	}
	clean := make(map[string]string)
	for name, contents := range step.Definition {
		if !strings.HasPrefix(name, "_") {
			clean[name] = contents
		}
	}
	step.Definition = clean
}

// fix line endings
func (step *ProblemStep) filterIncoming() {
	clean := make(map[string]string)
	for name, contents := range step.Definition {
		parts := strings.Split(name, "/")
		fixed := contents
		if (len(parts) < 2 || !directoryWhitelist[parts[0]]) && utf8.ValidString(contents) {
			fixed = fixLineEndings(contents)
			if fixed != contents {
				logi.Printf("fixed line endings for %s", name)
			}
		} else if utf8.ValidString(contents) {
			fixed = fixNewLines(contents)
			if fixed != contents {
				logi.Printf("fixed newlines for %s", name)
			}
		}
		clean[name] = fixed
	}
	step.Definition = clean
}

// GetProblems handles a request to /api/v2/problems,
// returning a list of all problems.
// If parameter steps=true, all problem steps will be included as well.
func GetProblems(w http.ResponseWriter, r *http.Request, tx *sql.Tx, render render.Render) {
	withStepsRaw := r.FormValue("steps")
	withSteps, err := strconv.ParseBool(withStepsRaw)
	if withStepsRaw != "" && err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "failed to parse steps parameter %q: %v", withStepsRaw, err)
		return
	} else if withStepsRaw == "" {
		withSteps = false
	}

	// get the problems
	problems := []*Problem{}
	fields := "id, problem_type, name, unique_id, description, tags, options, created_at, updated_at"
	if withSteps {
		fields += ", steps"
	}
	if err := meddler.QueryAll(tx, &problems, `SELECT `+fields+` FROM problems ORDER BY id`); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error getting problem list: %v", err)
		return
	}

	render.JSON(http.StatusOK, problems)
}

// GetProblem handles a request to /api/v2/problems/:problem_id,
// returning a single problem.
func GetProblem(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	problemID, err := strconv.Atoi(params["problem_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing problemID from URL: %v", err)
		return
	}

	problem := new(Problem)
	if err := meddler.Load(tx, "problems", problem, int64(problemID)); err != nil {
		if err == sql.ErrNoRows {
			loggedHTTPErrorf(w, http.StatusNotFound, "Problem not found")
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "DB error loading problem")
		}
		return
	}

	render.JSON(http.StatusOK, problem)
}

// PostProblem handles a request to /api/v2/problems,
// creating a new problem.
func PostProblem(w http.ResponseWriter, tx *sql.Tx, problem Problem, render render.Render) {

}

func PutProblem(w http.ResponseWriter, tx *sql.Tx, params martini.Params, problem Problem, render render.Render) {
}

// DeleteProblem handles request to /api/v2/problems/:problem_id,
// deleting the given problem.
// Note: this deletes all assignments and commits related to the problem.
func DeleteProblem(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	problemID, err := strconv.Atoi(params["problem_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing problemID from URL: %v", err)
		return
	}

	if _, err := tx.Exec(`DELETE FROM problems WHERE id = $1`, problemID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error deleting problem %d: %v", problemID, err)
		return
	}
}
