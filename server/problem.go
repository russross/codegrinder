package main

import (
	"database/sql"
	"io/ioutil"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/go-martini/martini"
	"github.com/martini-contrib/render"
	. "github.com/russross/codegrinder/types"
	"github.com/russross/meddler"
)

// GetProblemTypes handles a request to /problemtypes,
// returning a complete list of problem types.
func GetProblemTypes(w http.ResponseWriter, tx *sql.Tx, render render.Render) {
	problemTypes := []*ProblemType{}
	err := meddler.QueryAll(tx, &problemTypes, `SELECT * FROM problem_types ORDER BY name`)
	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}
	for i, elt := range problemTypes {
		pt, err := getProblemType(tx, elt.Name)
		if err != nil {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "error loading problem type %s: %v", elt.Name, err)
			return
		}
		problemTypes[i] = pt
	}

	render.JSON(http.StatusOK, problemTypes)
}

// GetProblemType handles a request to /problemtypes/:name,
// returning a single problem type with the given name.
func GetProblemType(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	name := params["name"]

	problemType, err := getProblemType(tx, name)
	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	render.JSON(http.StatusOK, problemType)
}

func getProblemType(tx *sql.Tx, name string) (*ProblemType, error) {
	problemType := new(ProblemType)
	err := meddler.QueryRow(tx, problemType, `SELECT * FROM problem_types WHERE name = ?`, name)
	if err != nil {
		return nil, err
	}

	// gather files
	problemType.Files = make(map[string][]byte)
	dir := filepath.Join(root, "files", name)
	dirInfo, err := os.Lstat(dir)
	if err == nil && dirInfo.IsDir() {
		err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
			// skip errors, directories, non-regular files
			if err != nil {
				return err
			}
			if info.IsDir() {
				return nil
			}
			relpath, err := filepath.Rel(dir, path)
			if err != nil {
				return err
			}
			raw, err := ioutil.ReadFile(path)
			if err != nil {
				return err
			}
			problemType.Files[relpath] = raw

			return nil
		})
		if err != nil && err != os.ErrNotExist {
			return nil, err
		}
	}

	problemTypeActions := []*ProblemTypeAction{}
	err = meddler.QueryAll(tx, &problemTypeActions, `SELECT * FROM problem_type_actions WHERE problem_type = ?`, name)
	if err != nil {
		return nil, err
	}

	problemType.Actions = make(map[string]*ProblemTypeAction)
	for _, elt := range problemTypeActions {
		problemType.Actions[elt.Action] = elt
	}

	return problemType, nil
}

// GetProblems handles a request to /problems,
// returning a list of all problems.
//
// If parameter unique=<...> present, results will be filtered by matching Unique field.
// If parameter problemType=<...> present, results will be filtered by matching ProblemType.
// If parameter note=<...> present, results will be filtered by case-insensitive substring match on Note field.
func GetProblems(w http.ResponseWriter, r *http.Request, tx *sql.Tx, currentUser *User, render render.Render) {
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
	var err error

	if currentUser.Admin || currentUser.Author {
		err = meddler.QueryAll(tx, &problems, `SELECT * FROM problems`+where+` ORDER BY id`, args...)
	} else {
		where, args = addWhereEq(where, args, "user_id", currentUser.ID)
		err = meddler.QueryAll(tx, &problems, `SELECT problems.* FROM problems JOIN user_problems ON problems.id = problem_id`+where+` ORDER BY id`, args...)
	}

	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	render.JSON(http.StatusOK, problems)
}

// GetProblem handles a request to /problems/:problem_id,
// returning a single problem.
func GetProblem(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	problemID, err := parseID(w, "problem_id", params["problem_id"])
	if err != nil {
		return
	}

	problem := new(Problem)

	if currentUser.Admin || currentUser.Author {
		err = meddler.Load(tx, "problems", problem, problemID)
	} else {
		err = meddler.QueryRow(tx, problem, `SELECT problems.* `+
			`FROM problems JOIN user_problems ON problems.id = problem_id `+
			`WHERE user_id = ? AND problem_id = ?`,
			currentUser.ID, problemID)
	}

	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	render.JSON(http.StatusOK, problem)
}

// DeleteProblem handles request to /problems/:problem_id,
// deleting the given problem.
// Note: this deletes all steps, assignments, and commits related to the problem,
// and it removes it from any problem sets it was part of.
func DeleteProblem(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	problemID, err := strconv.ParseInt(params["problem_id"], 10, 64)
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing problem_id from URL: %v", err)
		return
	}

	if _, err := tx.Exec(`DELETE FROM problems WHERE id = ?`, problemID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
}

// GetProblemSteps handles a request to /problems/:problem_id/steps,
// returning a list of all steps for a problem.
func GetProblemSteps(w http.ResponseWriter, r *http.Request, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	problemID, err := parseID(w, "problem_id", params["problem_id"])
	if err != nil {
		return
	}

	problemSteps := []*ProblemStep{}

	if currentUser.Admin || currentUser.Author {
		err = meddler.QueryAll(tx, &problemSteps, `SELECT * FROM problem_steps WHERE problem_id = ? ORDER BY step`, problemID)

	} else {
		err = meddler.QueryAll(tx, &problemSteps, `SELECT problem_steps.* `+
			`FROM problem_steps JOIN user_problems ON problem_steps.problem_id = user_problems.problem_id `+
			`WHERE user_problems.user_id = ? AND user_problems.problem_id = ? `+
			`ORDER BY step`,
			currentUser.ID, problemID)
	}

	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	if len(problemSteps) == 0 {
		loggedHTTPErrorf(w, http.StatusNotFound, "not found")
		return
	}

	if !currentUser.Admin && !currentUser.Author {
		for _, elt := range problemSteps {
			elt.Solution = nil
		}
	}

	render.JSON(http.StatusOK, problemSteps)
}

// GetProblemStep handles a request to /problems/:problem_id/steps/:step,
// returning a single problem step.
func GetProblemStep(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	problemID, err := parseID(w, "problem_id", params["problem_id"])
	if err != nil {
		return
	}
	step, err := parseID(w, "step", params["step"])
	if err != nil {
		return
	}

	problemStep := new(ProblemStep)

	if currentUser.Admin || currentUser.Author {
		err = meddler.QueryRow(tx, problemStep, `SELECT * FROM problem_steps WHERE problem_id = ? AND step = ?`, problemID, step)
	} else {
		err = meddler.QueryRow(tx, problemStep, `SELECT problem_steps.* `+
			`FROM problem_steps JOIN user_problems ON problem_steps.problem_id = user_problems.problem_id `+
			`WHERE user_problems.user_id = ? AND problem_steps.problem_id = ? AND problem_steps.step = ?`,
			currentUser.ID, problemID, step)
	}

	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	if !currentUser.Admin && !currentUser.Author {
		problemStep.Solution = nil
	}
	render.JSON(http.StatusOK, problemStep)
}

// GetProblemSets handles a request to /problem_sets,
// returning a list of all problem sets.
//
// If parameter unique=<...> present, results will be filtered by matching Unique field.
// If parameter note=<...> present, results will be filtered by case-insensitive substring match on Note field.
//
// If parameter search=<...> present (cat be repeated), it will be interpreted as search terms,
// and results will be filtered by case-insensitive substring match on several fields
// related to the problem set, including the unique ID, note, tags, and the same fields
// on each problem in the problem set. The returned problem sets match all search terms.
func GetProblemSets(w http.ResponseWriter, r *http.Request, tx *sql.Tx, currentUser *User, render render.Render) {
	if err := r.ParseForm(); err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "parsing form data: %v", err)
		return
	}

	// build search terms
	where := ""
	args := []interface{}{}

	// build search terms
	search := false
	for _, term := range r.Form["search"] {
		where, args = addWhereLike(where, args, "problem_set_search_fields.search_text", term)
		search = true
	}
	if unique := r.FormValue("unique"); unique != "" {
		where, args = addWhereEq(where, args, "problem_sets.unique_id", unique)
	}
	if name := r.FormValue("note"); name != "" {
		where, args = addWhereLike(where, args, "problem_sets.note", name)
	}

	// get the problemsets
	problemSets := []*ProblemSet{}
	var err error

	if currentUser.Admin || currentUser.Author {
		query := `SELECT problem_sets.* FROM problem_sets`
		if search {
			query += ` JOIN problem_set_search_fields ON problem_sets.id = problem_set_search_fields.problem_set_id`
		}
		query += where + ` ORDER BY problem_sets.id`
		err = meddler.QueryAll(tx, &problemSets, query, args...)
	} else {
		query := `SELECT problem_sets.* FROM problem_sets ` +
			`JOIN user_problem_sets ON problem_sets.id = problem_set_id`
		if search {
			query += ` JOIN problem_set_search_fields ON problem_sets.id = problem_set_search_fields.problem_set_id`
		}
		query += where + ` ORDER BY problem_sets.id`
		err = meddler.QueryAll(tx, &problemSets, query, args...)
	}

	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	render.JSON(http.StatusOK, problemSets)
}

// GetProblemSet handles a request to /problem_sets/:problem_set_id,
// returning a single problem set.
func GetProblemSet(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	problemSetID, err := parseID(w, "problem_set_id", params["problem_set_id"])
	if err != nil {
		return
	}

	problemSet := new(ProblemSet)

	if currentUser.Admin || currentUser.Author {
		err = meddler.Load(tx, "problem_sets", problemSet, problemSetID)
	} else {
		err = meddler.QueryRow(tx, problemSet, `SELECT problem_sets.* `+
			`FROM problem_sets JOIN user_problem_sets ON problem_sets.id = problem_set_id `+
			`WHERE user_id = ? AND problem_set_id = ?`,
			currentUser.ID, problemSetID)
	}

	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	render.JSON(http.StatusOK, problemSet)
}

// GetProblemSetProblems handles a request to /problem_sets/:problem_set_id/problems,
// returning a list of all problems set problems for a given problem set.
func GetProblemSetProblems(w http.ResponseWriter, r *http.Request, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	problemSetID, err := parseID(w, "problem_set_id", params["problem_set_id"])
	if err != nil {
		return
	}

	problemSetProblems := []*ProblemSetProblem{}

	if currentUser.Admin || currentUser.Author {
		err = meddler.QueryAll(tx, &problemSetProblems, `SELECT * FROM problem_set_problems WHERE problem_set_id = ? ORDER BY problem_id`, problemSetID)
	} else {
		err = meddler.QueryAll(tx, &problemSetProblems, `SELECT problem_set_problems.* `+
			`FROM problem_set_problems JOIN user_problem_sets ON problem_set_problems.problem_set_id = user_problem_sets.problem_set_id `+
			`WHERE user_problem_sets.user_id = ? AND problem_set_problems.problem_set_id = ? `+
			`ORDER BY problem_id`, currentUser.ID, problemSetID)
	}

	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	if len(problemSetProblems) == 0 {
		loggedHTTPErrorf(w, http.StatusNotFound, "not found")
		return
	}

	render.JSON(http.StatusOK, problemSetProblems)
}

// DeleteProblemSet handles request to /problem_sets/:problem_set_id,
// deleting the given problem set.
// Note: this deletes all assignments and commits related to the problem set.
func DeleteProblemSet(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	problemSetID, err := parseID(w, "problem_set_id", params["problem_set_id"])
	if err != nil {
		return
	}

	if _, err := tx.Exec(`DELETE FROM problem_sets WHERE id = ?`, problemSetID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
}
