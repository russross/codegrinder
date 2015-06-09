package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/net/html"

	"github.com/go-martini/martini"
	"github.com/martini-contrib/render"
	"github.com/russross/blackfriday"
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
	Name        string         `json:"name" meddler:"name"`
	Unique      string         `json:"unique" meddler:"unique_id"`
	Description string         `json:"description" meddler:"description,zeroisnull"`
	ProblemType string         `json:"problemType" meddler:"problem_type"`
	Confirmed   bool           `json:"confirmed" meddler:"confirmed"`
	Tags        []string       `json:"tags" meddler:"tags,json"`
	Options     []string       `json:"options" meddler:"options,json"`
	Steps       []*ProblemStep `json:"steps,omitempty" meddler:"steps,json"`
	CreatedAt   time.Time      `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt   time.Time      `json:"updatedAt" meddler:"updated_at,localtime"`

	Signature string     `json:"signature,omitempty" meddler:"-"`
	Timestamp *time.Time `json:"timestamp,omitempty" meddler:"-"`
}

func (problem *Problem) computeSignature(secret string) string {
	v := make(url.Values)

	// gather all relevant fields
	v.Add("name", problem.Name)
	v.Add("unique", problem.Unique)
	v.Add("description", problem.Description)
	v.Add("problemType", problem.ProblemType)
	v.Add("confirmed", strconv.FormatBool(problem.Confirmed))
	v["tags"] = problem.Tags
	v["options"] = problem.Options
	for n, step := range problem.Steps {
		v.Add(fmt.Sprintf("step-%d-name", n), step.Name)
		v.Add(fmt.Sprintf("step-%d-description", n), step.Description)
		v.Add(fmt.Sprintf("step-%d-scoreWeight", n), strconv.FormatFloat(step.ScoreWeight, 'g', -1, 64))
		for name, contents := range step.Files {
			v.Add(fmt.Sprintf("step-%d-file-%s", n, name), contents)
		}
	}
	v.Add("createdAt", problem.CreatedAt.UTC().Format(time.RFC3339Nano))
	v.Add("updatedAt", problem.UpdatedAt.UTC().Format(time.RFC3339Nano))
	if problem.Timestamp != nil {
		v.Add("timestamp", problem.Timestamp.UTC().Format(time.RFC3339Nano))
	}

	// compute signature
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(encode(v)))
	sum := mac.Sum(nil)
	return base64.StdEncoding.EncodeToString(sum)
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
	Name        string            `json:"name"`
	Description string            `json:"description"`
	ScoreWeight float64           `json:"scoreWeight"`
	Files       map[string]string `json:"files"`
}

// filter out files with underscore prefix for non-instructors
func (step *ProblemStep) filterOutgoing(instructor bool) {
	if instructor {
		return
	}
	clean := make(map[string]string)
	for name, contents := range step.Files {
		if !strings.HasPrefix(name, "_") {
			clean[name] = contents
		}
	}
	step.Files = clean
}

// fix line endings
func (step *ProblemStep) filterIncoming() {
	clean := make(map[string]string)
	for name, contents := range step.Files {
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
	step.Files = clean
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
// Confirmed must be true, and the problem must have a valid Signature from the daycare.
func PostProblem(w http.ResponseWriter, tx *sql.Tx, problem Problem, render render.Render) {

}

// PutProblem handles a request to /api/v2/problems/:problem_id,
// updating an existing problem.
// Confirmed must be true, and the problem must have a valid Signature from the daycare.
// If any assignments exist that refer to this problem, then the updates cannot change the number
// of steps in the problem.
func PutProblem(w http.ResponseWriter, tx *sql.Tx, params martini.Params, problem Problem, render render.Render) {
}

// PostProblemUnconfirmed handles a request to /api/v2/problems/unconfirmed,
// signing a new/updated problem that has not yet been tested on the daycare.
func PostProblemUnconfirmed(w http.ResponseWriter, tx *sql.Tx, problem Problem, render render.Render) {
	now := time.Now()

	// if this is an update to an existing problem, we need to check that some things match
	if problem.ID != 0 {
		old := new(Problem)
		if err := meddler.Load(tx, "problems", old, int64(problem.ID)); err != nil {
			if err == sql.ErrNoRows {
				loggedHTTPErrorf(w, http.StatusNotFound, "request to update problem %d, but that problem does not exist", problem.ID)
			} else {
				loggedHTTPErrorf(w, http.StatusInternalServerError, "db error getting problem %d: %v", problem.ID, err)
			}
			return
		}

		if problem.Unique != old.Unique {
			loggedHTTPErrorf(w, http.StatusBadRequest, "updating a problem cannot change its unique ID from %q to %q; create a new problem instead", old.Unique, problem.Unique)
			return
		}
		if problem.ProblemType != old.ProblemType {
			loggedHTTPErrorf(w, http.StatusBadRequest, "updating a problem cannot change its type from %q to %q; create a new problem instead", old.ProblemType, problem.ProblemType)
			return
		}
		if !problem.CreatedAt.Equal(old.CreatedAt) {
			loggedHTTPErrorf(w, http.StatusBadRequest, "updating a problem cannot change its created time from %v to %v", old.CreatedAt, problem.CreatedAt)
			return
		}
	} else {
		// for new problems, set the timestamps to now
		problem.CreatedAt = now
		problem.UpdatedAt = now
	}

	// make sure the name is valid
	problem.Name = strings.TrimSpace(problem.Name)
	if problem.Name == "" {
		loggedHTTPErrorf(w, http.StatusBadRequest, "name cannot be empty")
		return
	}

	// make sure the unique ID is valid and unique
	problem.Unique = strings.TrimSpace(problem.Unique)
	if problem.Unique == "" {
		loggedHTTPErrorf(w, http.StatusBadRequest, "unique ID cannot be empty")
		return
	}
	if url.QueryEscape(problem.Unique) != problem.Unique {
		loggedHTTPErrorf(w, http.StatusBadRequest, "unique ID must be URL friendly: %s is escaped as %s", problem.Unique, url.QueryEscape(problem.Unique))
		return
	}
	conflict := new(Problem)
	if err := meddler.QueryRow(tx, conflict, `SELECT * FROM problems WHERE unique_id = $1`, problem.Unique); err != nil {
		if err == sql.ErrNoRows {
			conflict.ID = 0
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error checking for Unique ID conflicts: %v", err)
			return
		}
	}
	if conflict.ID != 0 && conflict.ID != problem.ID {
		loggedHTTPErrorf(w, http.StatusBadRequest, "unique ID %q is already in use by problem %d", problem.Unique, conflict.ID)
		return
	}

	// check description
	problem.Description = strings.TrimSpace(problem.Description)

	// make sure the problem type is legitimate
	if _, exists := problemTypes[problem.ProblemType]; !exists {
		loggedHTTPErrorf(w, http.StatusBadRequest, "unrecognized problem type: %q", problem.ProblemType)
		return
	}

	// confirmed must be false
	if problem.Confirmed {
		loggedHTTPErrorf(w, http.StatusBadRequest, "a problem must not claim to be confirmed when preparing it to be confirmed")
		return
	}

	// check tags
	for i, tag := range problem.Tags {
		problem.Tags[i] = strings.TrimSpace(tag)
	}
	sort.Strings(problem.Tags)

	// check options
	for i, option := range problem.Options {
		problem.Options[i] = strings.TrimSpace(option)
	}

	// check steps
	if len(problem.Steps) == 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "problem must have at least one step")
		return
	}
	for n, step := range problem.Steps {
		step.filterIncoming()
		description, err := buildDescription(step.Files)
		if err != nil {
			loggedHTTPErrorf(w, http.StatusBadRequest, "error building description for step %d: %v", n+1, err)
			return
		}
		step.Name = strings.TrimSpace(step.Name)
		if step.Name == "" {
			loggedHTTPErrorf(w, http.StatusBadRequest, "missing name for step %d", n+1)
			return
		}
		step.Description = description
		if step.ScoreWeight <= 0.0 {
			// default to 1.0
			step.ScoreWeight = 1.0
		}
	}

	// timestamps
	problem.UpdatedAt = now

	// compute signature
	problem.Timestamp = &now
	problem.Signature = problem.computeSignature(Config.DaycareSecret)

	render.JSON(http.StatusOK, &problem)
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

// buildDescription builds the instructions for a problem step as a single
// html document. Markdown is processed and images are inlined.
func buildDescription(files map[string]string) (string, error) {
	// get a list of all files in the _doc directory
	used := make(map[string]bool)
	for name, _ := range files {
		if strings.HasPrefix(name, "_doc/") {
			used[name] = false
		}
	}

	var justHTML string
	if data, ok := files["_doc/index.html"]; ok {
		justHTML = data
		used["_doc/index.html"] = true
	} else if data, ok := files["_doc/index.md"]; ok {
		// render markdown
		extensions := 0
		extensions |= blackfriday.EXTENSION_NO_INTRA_EMPHASIS
		extensions |= blackfriday.EXTENSION_TABLES
		extensions |= blackfriday.EXTENSION_FENCED_CODE
		extensions |= blackfriday.EXTENSION_AUTOLINK
		extensions |= blackfriday.EXTENSION_STRIKETHROUGH
		extensions |= blackfriday.EXTENSION_SPACE_HEADERS

		justHTML = string(blackfriday.Markdown([]byte(data), blackfriday.HtmlRenderer(0, "", ""), extensions))
		used["_doc/index.md"] = true
	} else {
		return "", loggedErrorf("No documentation found: checked _doc/index.html and _doc/index.md")
	}

	// make sure it is well-formed utf8
	if !utf8.ValidString(justHTML) {
		return "", loggedErrorf("index.{html,md} is not valid utf8")
	}

	// parse the html
	doc, err := html.Parse(strings.NewReader(justHTML))
	if err != nil {
		loge.Printf("Error parsing index.html: %v", err)
		return "", err
	}
	if doc == nil {
		return "", loggedErrorf("Parsing the HTML yielded a nil document")
	}

	// find image tags
	var walk func(*html.Node) error
	walk = func(n *html.Node) error {
		if n.Type == html.ElementNode && n.Data == "img" {
			for i, a := range n.Attr {
				if a.Key == "src" {
					if contents, present := files["_doc/"+a.Val]; present {
						mime := ""
						switch {
						case strings.HasSuffix(a.Val, ".gif"):
							mime = "image/gif"
						case strings.HasSuffix(a.Val, ".png"):
							mime = "image/png"
						case strings.HasSuffix(a.Val, ".jpg"):
							mime = "image/jpeg"
						case strings.HasSuffix(a.Val, ".jpeg"):
							mime = "image/jpeg"
						case strings.HasSuffix(a.Val, ".svg"):
							mime = "image/svg+xml"
						default:
							return loggedErrorf("image tag found, but image type is unknown: %s", a.Val)
						}

						// base64 encode the image
						logi.Printf("encoding image %s as base64 data URI", a.Val)
						used["_doc/"+a.Val] = true
						s := base64.StdEncoding.EncodeToString([]byte(contents))
						a.Val = fmt.Sprintf("data:%s;base64,%s", mime, s)
						n.Attr[i] = a
					} else {
						return loggedErrorf("Warning: image tag found, but image file not found: %s", a.Val)
					}
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if err := walk(c); err != nil {
				return err
			}
		}
		return nil
	}
	if err = walk(doc); err != nil {
		return "", err
	}

	// warn about unused files in _doc
	for name, u := range used {
		if !u {
			logi.Printf("Warning: %s was not used in the description", name)
		}
	}

	// re-render it
	var buf bytes.Buffer
	if err = html.Render(&buf, doc); err != nil {
		loge.Printf("Error rendering HTML: %v", err)
		return "", err
	}

	return buf.String(), nil
}
