package main

import (
	"database/sql"
	"fmt"
	"io/ioutil"
	"net/http"
	"os"
	"path/filepath"

	"github.com/go-martini/martini"
	"github.com/martini-contrib/render"
	. "github.com/russross/codegrinder/types"
	"github.com/russross/meddler"
)

// getProblemTypes returns a complete list of problem types.
// Authorization: No authentication required (public endpoint).
func getProblemTypes(tx *sql.Tx) ([]*ProblemType, error) {
	problemTypes := []*ProblemType{}
	err := meddler.QueryAll(tx, &problemTypes, `SELECT * FROM problem_types ORDER BY name`)
	if err != nil {
		return nil, err
	}
	for i, elt := range problemTypes {
		pt, err := getProblemType(tx, elt.Name)
		if err != nil {
			return nil, fmt.Errorf("error loading problem type %s: %v", elt.Name, err)
		}
		problemTypes[i] = pt
	}

	return problemTypes, nil
}

// GetProblemTypes handles a request to /problemtypes,
// returning a complete list of problem types.
func GetProblemTypes(w http.ResponseWriter, tx *sql.Tx, render render.Render) {
	problemTypes, err := getProblemTypes(tx)
	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	render.JSON(http.StatusOK, problemTypes)
}

// getProblemType returns a single problem type with the given name.
// Authorization: No authentication required (public endpoint).
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

// getProblems returns a list of problems filtered by the given parameters.
// Authorization: currentUser must be logged in and an author.
func getProblems(tx *sql.Tx, currentUser *User, unique, problemType, note string) ([]*Problem, error) {
	// build search terms
	where := ""
	args := []interface{}{}

	if unique != "" {
		where, args = addWhereEq(where, args, "unique_id", unique)
	}

	if problemType != "" {
		where, args = addWhereEq(where, args, "problem_type", problemType)
	}

	if note != "" {
		where, args = addWhereLike(where, args, "note", note)
	}

	// get the problems
	problems := []*Problem{}
	var err error

	if currentUser.Author {
		err = meddler.QueryAll(tx, &problems, `SELECT * FROM problems`+where+` ORDER BY id`, args...)
	} else {
		where, args = addWhereEq(where, args, "user_id", currentUser.ID)
		err = meddler.QueryAll(tx, &problems, `SELECT problems.* FROM problems JOIN user_problems ON problems.id = problem_id`+where+` ORDER BY id`, args...)
	}

	if err != nil {
		return nil, err
	}

	return problems, nil
}

// GetProblems handles a request to /problems,
// returning a list of all problems.
//
// If parameter unique=<...> present, results will be filtered by matching Unique field.
// If parameter problemType=<...> present, results will be filtered by matching ProblemType.
// If parameter note=<...> present, results will be filtered by case-insensitive substring match on Note field.
func GetProblems(w http.ResponseWriter, r *http.Request, tx *sql.Tx, currentUser *User, render render.Render) {
	problems, err := getProblems(tx, currentUser, r.FormValue("unique"), r.FormValue("problemType"), r.FormValue("note"))
	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	render.JSON(http.StatusOK, problems)
}

// getProblem returns a single problem by ID.
// Authorization: currentUser must be logged in and an author.
func getProblem(tx *sql.Tx, problemID int64, currentUser *User) (*Problem, error) {
	problem := new(Problem)

	if currentUser.Author {
		err := meddler.Load(tx, "problems", problem, problemID)
		if err != nil {
			return nil, err
		}
	} else {
		err := meddler.QueryRow(tx, problem, `SELECT problems.* `+
			`FROM problems JOIN user_problems ON problems.id = problem_id `+
			`WHERE user_id = ? AND problem_id = ?`,
			currentUser.ID, problemID)
		if err != nil {
			return nil, err
		}
	}

	return problem, nil
}

// GetProblem handles a request to /problems/:problem_id,
// returning a single problem.
func GetProblem(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	problemID, err := parseID(w, "problem_id", params["problem_id"])
	if err != nil {
		return
	}

	problem, err := getProblem(tx, problemID, currentUser)
	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	render.JSON(http.StatusOK, problem)
}

// deleteProblem deletes the given problem.

// getProblemSteps returns a list of all steps for a problem.
// Authorization: currentUser must be logged in and an author.
func getProblemSteps(tx *sql.Tx, problemID int64, currentUser *User) ([]*ProblemStep, error) {
	problemSteps := []*ProblemStep{}

	if currentUser.Author {
		err := meddler.QueryAll(tx, &problemSteps, `SELECT * FROM problem_steps WHERE problem_id = ? ORDER BY step`, problemID)
		if err != nil {
			return nil, err
		}
	} else {
		err := meddler.QueryAll(tx, &problemSteps, `SELECT problem_steps.* `+
			`FROM problem_steps JOIN user_problems ON problem_steps.problem_id = user_problems.problem_id `+
			`WHERE user_problems.user_id = ? AND user_problems.problem_id = ? `+
			`ORDER BY step`,
			currentUser.ID, problemID)
		if err != nil {
			return nil, err
		}
	}

	if len(problemSteps) == 0 {
		return nil, fmt.Errorf("not found")
	}

	if !currentUser.Author {
		for _, elt := range problemSteps {
			elt.Solution = nil
		}
	}

	return problemSteps, nil
}

// GetProblemSteps handles a request to /problems/:problem_id/steps,
// returning a list of all steps for a problem.
func GetProblemSteps(w http.ResponseWriter, r *http.Request, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	problemID, err := parseID(w, "problem_id", params["problem_id"])
	if err != nil {
		return
	}

	problemSteps, err := getProblemSteps(tx, problemID, currentUser)
	if err != nil {
		if err.Error() == "not found" {
			loggedHTTPErrorf(w, http.StatusNotFound, "not found")
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		}
		return
	}

	render.JSON(http.StatusOK, problemSteps)
}

// getProblemStep returns a single problem step.
// Authorization: currentUser must be logged in and an author.
func getProblemStep(tx *sql.Tx, problemID int64, step int64, currentUser *User) (*ProblemStep, error) {
	problemStep := new(ProblemStep)

	if currentUser.Author {
		err := meddler.QueryRow(tx, problemStep, `SELECT * FROM problem_steps WHERE problem_id = ? AND step = ?`, problemID, step)
		if err != nil {
			return nil, err
		}
	} else {
		err := meddler.QueryRow(tx, problemStep, `SELECT problem_steps.* `+
			`FROM problem_steps JOIN user_problems ON problem_steps.problem_id = user_problems.problem_id `+
			`WHERE user_problems.user_id = ? AND problem_steps.problem_id = ? AND problem_steps.step = ?`,
			currentUser.ID, problemID, step)
		if err != nil {
			return nil, err
		}
	}

	if !currentUser.Author {
		problemStep.Solution = nil
	}

	return problemStep, nil
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

	problemStep, err := getProblemStep(tx, problemID, step, currentUser)
	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	render.JSON(http.StatusOK, problemStep)
}

// getProblemSets returns a list of problem sets filtered by the given parameters.
// Authorization: currentUser must be logged in and an author.
func getProblemSets(tx *sql.Tx, currentUser *User, unique, note string, search []string) ([]*ProblemSet, error) {
	// build search terms
	where := ""
	args := []interface{}{}

	// build search terms
	searchFlag := false
	for _, term := range search {
		where, args = addWhereLike(where, args, "problem_set_search_fields.search_text", term)
		searchFlag = true
	}
	if unique != "" {
		where, args = addWhereEq(where, args, "problem_sets.unique_id", unique)
	}
	if note != "" {
		where, args = addWhereLike(where, args, "problem_sets.note", note)
	}

	// get the problemsets
	problemSets := []*ProblemSet{}
	var err error

	if currentUser.Author {
		query := `SELECT problem_sets.* FROM problem_sets`
		if searchFlag {
			query += ` JOIN problem_set_search_fields ON problem_sets.id = problem_set_search_fields.problem_set_id`
		}
		query += where + ` ORDER BY problem_sets.id`
		err = meddler.QueryAll(tx, &problemSets, query, args...)
	} else {
		where, args = addWhereEq(where, args, "user_problem_sets.user_id", currentUser.ID)
		query := `SELECT problem_sets.* FROM problem_sets ` +
			`JOIN user_problem_sets ON problem_sets.id = user_problem_sets.problem_set_id`
		if searchFlag {
			query += ` JOIN problem_set_search_fields ON problem_sets.id = problem_set_search_fields.problem_set_id`
		}
		query += where + ` ORDER BY problem_sets.id`
		err = meddler.QueryAll(tx, &problemSets, query, args...)
	}

	if err != nil {
		return nil, err
	}

	return problemSets, nil
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

	problemSets, err := getProblemSets(tx, currentUser, r.FormValue("unique"), r.FormValue("note"), r.Form["search"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	render.JSON(http.StatusOK, problemSets)
}

// getProblemSet returns a single problem set by ID.
// Authorization: currentUser must be logged in and an author.
func getProblemSet(tx *sql.Tx, problemSetID int64, currentUser *User) (*ProblemSet, error) {
	problemSet := new(ProblemSet)

	if currentUser.Author {
		err := meddler.Load(tx, "problem_sets", problemSet, problemSetID)
		if err != nil {
			return nil, err
		}
	} else {
		err := meddler.QueryRow(tx, problemSet, `SELECT problem_sets.* `+
			`FROM problem_sets JOIN user_problem_sets ON problem_sets.id = problem_set_id `+
			`WHERE user_id = ? AND problem_set_id = ?`,
			currentUser.ID, problemSetID)
		if err != nil {
			return nil, err
		}
	}

	return problemSet, nil
}

// GetProblemSet handles a request to /problem_sets/:problem_set_id,
// returning a single problem set.
func GetProblemSet(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	problemSetID, err := parseID(w, "problem_set_id", params["problem_set_id"])
	if err != nil {
		return
	}

	problemSet, err := getProblemSet(tx, problemSetID, currentUser)
	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	render.JSON(http.StatusOK, problemSet)
}

// getProblemSetProblems returns a list of all problem set problems for a given problem set.
// Authorization: currentUser must be logged in and an author.
func getProblemSetProblems(tx *sql.Tx, problemSetID int64, currentUser *User) ([]*ProblemSetProblem, error) {
	problemSetProblems := []*ProblemSetProblem{}

	if currentUser.Author {
		err := meddler.QueryAll(tx, &problemSetProblems, `SELECT * FROM problem_set_problems WHERE problem_set_id = ? ORDER BY problem_id`, problemSetID)
		if err != nil {
			return nil, err
		}
	} else {
		err := meddler.QueryAll(tx, &problemSetProblems, `SELECT problem_set_problems.* `+
			`FROM problem_set_problems JOIN user_problem_sets ON problem_set_problems.problem_set_id = user_problem_sets.problem_set_id `+
			`WHERE user_problem_sets.user_id = ? AND problem_set_problems.problem_set_id = ? `+
			`ORDER BY problem_id`, currentUser.ID, problemSetID)
		if err != nil {
			return nil, err
		}
	}

	if len(problemSetProblems) == 0 {
		return nil, fmt.Errorf("not found")
	}

	return problemSetProblems, nil
}

// GetProblemSetProblems handles a request to /problem_sets/:problem_set_id/problems,
// returning a list of all problems set problems for a given problem set.
func GetProblemSetProblems(w http.ResponseWriter, r *http.Request, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	problemSetID, err := parseID(w, "problem_set_id", params["problem_set_id"])
	if err != nil {
		return
	}

	problemSetProblems, err := getProblemSetProblems(tx, problemSetID, currentUser)
	if err != nil {
		if err.Error() == "not found" {
			loggedHTTPErrorf(w, http.StatusNotFound, "not found")
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		}
		return
	}

	render.JSON(http.StatusOK, problemSetProblems)
}
