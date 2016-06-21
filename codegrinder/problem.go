package main

import (
	"database/sql"
	"net/http"
	"strconv"

	"github.com/go-martini/martini"
	"github.com/martini-contrib/render"
	. "github.com/russross/codegrinder/types"
	"github.com/russross/meddler"
)

// GetProblemTypes handles a request to /v2/problemtypes,
// returning a complete list of problem types.
func GetProblemTypes(w http.ResponseWriter, render render.Render) {
	render.JSON(http.StatusOK, problemTypes)
}

// GetProblemType handles a request to /v2/problemtypes/:name,
// returning a single problem type with the given name.
func GetProblemType(w http.ResponseWriter, params martini.Params, render render.Render) {
	name := params["name"]

	problemType, exists := problemTypes[name]

	if !exists {
		loggedHTTPErrorf(w, http.StatusNotFound, "not found")
		return
	}

	render.JSON(http.StatusOK, problemType)
}

// GetProblems handles a request to /v2/problems,
// returning a list of all problems.
//
// If parameter unique=<...> present, results will be filtered by matching Unique field.
// If parameter problemType=<...> present, results will be filtered by matching ProblemType.
// If parameter note=<...> present, results will be filtered by case-insensitive substring match on Note field.
func GetProblems(w http.ResponseWriter, r *http.Request, tx *sql.Tx, render render.Render) {
	// build search terms
	where := ""
	args := []interface{}{}

	if unique := r.FormValue("unique"); unique != "" {
		where, args = addWhereEq(where, args, "unique_id", unique)
	}

	if problemType := r.FormValue("problemType"); problemType != "" {
		where, args = addWhereEq(where, args, "problem_type", problemType)
	}

	if name := r.FormValue("note"); name != "" {
		where, args = addWhereLike(where, args, "note", name)
	}

	// get the problems
	problems := []*Problem{}
	if err := meddler.QueryAll(tx, &problems, `SELECT * FROM problems`+where+` ORDER BY id`, args...); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	render.JSON(http.StatusOK, problems)
}

// GetProblem handles a request to /v2/problems/:problem_id,
// returning a single problem.
func GetProblem(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	problemID, err := parseID(w, "problem_id", params["problem_id"])
	if err != nil {
		return
	}

	problem := new(Problem)
	if err := meddler.Load(tx, "problems", problem, problemID); err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	render.JSON(http.StatusOK, problem)
}

// DeleteProblem handles request to /v2/problems/:problem_id,
// deleting the given problem.
// Note: this deletes all steps, assignments, and commits related to the problem,
// and it removes it from any problem sets it was part of.
func DeleteProblem(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	problemID, err := strconv.ParseInt(params["problem_id"], 10, 64)
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing problem_id from URL: %v", err)
		return
	}

	if _, err := tx.Exec(`DELETE FROM problems WHERE id = $1`, problemID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
}

// GetProblemSteps handles a request to /v2/problems/:problem_id/steps,
// returning a list of all steps for a problem.
func GetProblemSteps(w http.ResponseWriter, r *http.Request, tx *sql.Tx, params martini.Params, render render.Render) {
	problemID, err := parseID(w, "problem_id", params["problem_id"])
	if err != nil {
		return
	}

	problemSteps := []*ProblemStep{}
	if err := meddler.QueryAll(tx, &problemSteps, `SELECT * FROM problem_steps WHERE problem_id = $1 ORDER BY step`, problemID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	if len(problemSteps) == 0 {
		loggedHTTPErrorf(w, http.StatusNotFound, "not found")
		return
	}

	render.JSON(http.StatusOK, problemSteps)
}

// GetProblemStep handles a request to /v2/problems/:problem_id/steps/:step,
// returning a single problem step.
func GetProblemStep(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	problemID, err := parseID(w, "problem_id", params["problem_id"])
	if err != nil {
		return
	}
	step, err := parseID(w, "step", params["step"])
	if err != nil {
		return
	}

	problemStep := new(ProblemStep)
	if err := meddler.QueryRow(tx, problemStep, `SELECT * FROM problem_steps WHERE problem_id = $1 AND step = $2 LIMIT 1`, problemID, step); err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	render.JSON(http.StatusOK, problemStep)
}

// GetProblemSet handles a request to /v2/problem_sets/:problem_set_id,
// returning a single problem set.
func GetProblemSet(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	problemSetID, err := parseID(w, "problem_set_id", params["problem_set_id"])
	if err != nil {
		return
	}

	problemSet := new(ProblemSet)
	if err := meddler.Load(tx, "problem_sets", problemSet, problemSetID); err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	render.JSON(http.StatusOK, problemSet)
}

// GetProblemSets handles a request to /v2/problem_sets,
// returning a list of all problem sets.
//
// If parameter unique=<...> present, results will be filtered by matching Unique field.
// If parameter note=<...> present, results will be filtered by case-insensitive substring match on Note field.
func GetProblemSets(w http.ResponseWriter, r *http.Request, tx *sql.Tx, render render.Render) {
	// get the problemsets
	problemSets := []*ProblemSet{}

	// build search terms
	where := ""
	args := []interface{}{}

	if unique := r.FormValue("unique"); unique != "" {
		where, args = addWhereEq(where, args, "unique_id", unique)
	}

	if name := r.FormValue("note"); name != "" {
		where, args = addWhereLike(where, args, "note", name)
	}

	if err := meddler.QueryAll(tx, &problemSets, `SELECT * FROM problem_sets`+where+` ORDER BY id`, args...); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	render.JSON(http.StatusOK, problemSets)
}

// GetProblemSetProblems handles a request to /v2/problem_sets/:problem_set_id/problems,
// returning a list of all problems set problems for a given problem set.
func GetProblemSetProblems(w http.ResponseWriter, r *http.Request, tx *sql.Tx, params martini.Params, render render.Render) {
	problemSetID, err := parseID(w, "problem_set_id", params["problem_set_id"])
	if err != nil {
		return
	}

	problemSetProblems := []*ProblemSetProblem{}
	if err = meddler.QueryAll(tx, &problemSetProblems, `SELECT * FROM problem_set_problems WHERE problem_set_id = $1 ORDER BY problem_id`, problemSetID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	if len(problemSetProblems) == 0 {
		loggedHTTPErrorf(w, http.StatusNotFound, "not found")
		return
	}

	render.JSON(http.StatusOK, problemSetProblems)
}

// DeleteProblemSet handles request to /v2/problem_sets/:problem_set_id,
// deleting the given problem set.
// Note: this deletes all assignments and commits related to the problem set.
func DeleteProblemSet(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	problemSetID, err := parseID(w, "problem_set_id", params["problem_set_id"])
	if err != nil {
		return
	}

	if _, err := tx.Exec(`DELETE FROM problem_sets WHERE id = $1`, problemSetID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
}
