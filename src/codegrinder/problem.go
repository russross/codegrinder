package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
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

var beginningOfTime = time.Date(2015, 1, 1, 0, 0, 0, 0, time.UTC)

// problem files in these directories do not have line endings cleaned up
var directoryWhitelist = map[string]bool{
	"in":   true,
	"out":  true,
	"_doc": true,
}

// Problem defines a complete problem with all steps.
// A few special cases:
//
// * When creating a problem, submit it along with a full set of Commit objects
//   with a sample solution, one per problem step. When submitted,
//   Confirmed=false, Signature="", Timestamp=nil. Signature and Timestamp will
//   be filled in.
// * Submit the signed Problem with a Commit to the daycare for validation.
//   Upon success, it will return the signed commits with Transcript and
//   ReportCard objects.
// * Include a complete collection of signed commits when submitting so the
//   Problem can be confirmed and added to the set of active problems.
//
// * When using a problem, it will include a valid Timestamp and Signature. The
//   signature must be included when getting a Commit signed before sending it
//   to the daycare for validation.
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

	Signature string     `json:"signature,omitempty" meddler:"signature,zeroisnull"`
	Timestamp *time.Time `json:"timestamp,omitempty" meddler:"signature_timestamp"`

	// only included when a problem is being created/updated
	Commits []*Commit `json:"commits,omitempty" meddler:"-"`
}

func (problem *Problem) computeSignature(secret string) string {
	v := make(url.Values)

	// gather all relevant fields
	v.Add("id", strconv.Itoa(problem.ID))
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
	v.Add("createdAt", problem.CreatedAt.UTC().Format(time.RFC3339))
	v.Add("updatedAt", problem.UpdatedAt.UTC().Format(time.RFC3339))
	if problem.Timestamp != nil {
		v.Add("timestamp", problem.Timestamp.UTC().Format(time.RFC3339))
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

func (problem *Problem) normalize(now time.Time) error {
	// make sure the name is valid
	problem.Name = strings.TrimSpace(problem.Name)
	if problem.Name == "" {
		return fmt.Errorf("name cannot be empty")
	}

	// make sure the unique ID is valid
	problem.Unique = strings.TrimSpace(problem.Unique)
	if problem.Unique == "" {
		return fmt.Errorf("unique ID cannot be empty")
	}
	if url.QueryEscape(problem.Unique) != problem.Unique {
		return fmt.Errorf("unique ID must be URL friendly: %s is escaped as %s", problem.Unique, url.QueryEscape(problem.Unique))
	}

	// fix description
	problem.Description = strings.TrimSpace(problem.Description)

	// make sure the problem type is legitimate
	if _, exists := problemTypes[problem.ProblemType]; !exists {
		return fmt.Errorf("unrecognized problem type: %q", problem.ProblemType)
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
		return fmt.Errorf("problem must have at least one step")
	}
	for n, step := range problem.Steps {
		step.filterIncoming()
		description, err := buildDescription(step.Files)
		if err != nil {
			return fmt.Errorf("error building description for step %d: %v", n+1, err)
		}
		step.Name = strings.TrimSpace(step.Name)
		if step.Name == "" {
			return fmt.Errorf("missing name for step %d", n+1)
		}
		step.Description = description
		if step.ScoreWeight <= 0.0 {
			// default to 1.0
			step.ScoreWeight = 1.0
		}
	}

	// sanity check timestamps
	problem.CreatedAt = problem.CreatedAt.Round(time.Second)
	if problem.CreatedAt.Before(beginningOfTime) || problem.CreatedAt.After(now) {
		return fmt.Errorf("problem CreatedAt time of %v is invalid", problem.CreatedAt)
	}
	problem.UpdatedAt = problem.UpdatedAt.Round(time.Second)
	if problem.UpdatedAt.Before(beginningOfTime) || problem.UpdatedAt.After(now) {
		return fmt.Errorf("problem UpdatedAt time of %v is invalid", problem.UpdatedAt)
	}

	return nil
}

func getStepWhitelists(problem *Problem) []map[string]bool {
	var lists []map[string]bool

	// compute the white list of commit files for each step
	for _, step := range problem.Steps {
		// carry everything forward
		m := make(map[string]bool)
		if len(lists) > 0 {
			for name := range lists[len(lists)-1] {
				m[name] = true
			}
		}

		// add files defined in the root directory of the problem step
		for name := range step.Files {
			if len(strings.Split(name, "/")) == 1 {
				m[name] = true
			}
		}
		lists = append(lists, m)
	}

	return lists
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
//
// If parameter steps=true, all problem steps will be included as well.
// If parameter unique=<...> present, results will be filtered by matching Unique field.
// TODO: If parameter tags=<...> present, results will be filtered by matching tags (problem must include all supplied tags).
// If parameter problemType=<...> present, results will be filtered by matching ProblemType.
// If parameter name=<...> present, results will be filtered by case-insensitive substring match on Name field.
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
	fields := "id, name, unique_id, description, problem_type, confirmed, tags, options, created_at, updated_at, signature, signature_timestamp"
	if withSteps {
		fields += ", steps"
	}

	// build search terms
	where := ""
	args := []interface{}{}

	if unique := r.FormValue("unique"); unique != "" {
		where, args = addWhereEq(where, args, "unique_id", unique)
	}

	if problemType := r.FormValue("problemType"); problemType != "" {
		where, args = addWhereEq(where, args, "problem_type", problemType)
	}

	if name := r.FormValue("name"); name != "" {
		where, args = addWhereLike(where, args, "name", name)
	}

	if err := meddler.QueryAll(tx, &problems, `SELECT `+fields+` FROM problems`+where+` ORDER BY id`, args...); err != nil {
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

	// verify signature
	if problem.computeSignature(Config.DaycareSecret) != problem.Signature {
		loge.Printf("SIGNATURE MISMATCH: found %s but expected %s", problem.computeSignature(Config.DaycareSecret), problem.Signature)
	}
	render.JSON(http.StatusOK, problem)
}

// PostProblem handles a request to /api/v2/problems,
// creating a new problem.
// Confirmed must be false, and the problem must have a full set of passing commits signed by the daycare.
func PostProblem(w http.ResponseWriter, tx *sql.Tx, problem Problem, render render.Render) {
	if problem.ID != 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "new problem cannot already have a problem ID")
		return
	}

	saveProblemCommon(w, tx, &problem, render)
}

// PutProblem handles a request to /api/v2/problems/:problem_id,
// updating an existing problem.
// Confirmed must be false, and the problem must have a full set of passing commits signed by the daycare.
// If any assignments exist that refer to this problem, then the updates cannot change the number
// of steps in the problem.
func PutProblem(w http.ResponseWriter, tx *sql.Tx, params martini.Params, problem Problem, render render.Render) {
	if problem.ID <= 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "updated problem must have ID > 0")
		return
	}

	old := new(Problem)
	if err := meddler.Load(tx, "problems", old, int64(problem.ID)); err != nil {
		if err == sql.ErrNoRows {
			loggedHTTPErrorf(w, http.StatusNotFound, "problem with ID %d not found", problem.ID)
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error loading existing problem: %v", err)
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

	var assignmentCount int
	if err := tx.QueryRow(`SELECT COUNT(1) FROM assignments WHERE problem_id = $1`, problem.ID).Scan(&assignmentCount); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error counting assignments that use problem %d: %v", problem.ID, err)
		return
	}
	if assignmentCount > 0 && len(problem.Steps) != len(old.Steps) {
		loggedHTTPErrorf(w, http.StatusBadRequest, "cannot change the number of steps in a problem that is already in use")
		return
	}

	saveProblemCommon(w, tx, &problem, render)
}

func saveProblemCommon(w http.ResponseWriter, tx *sql.Tx, problem *Problem, render render.Render) {
	now := time.Now().Round(time.Second)

	// clean up basic fields and do some checks
	if err := problem.normalize(now); err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "%v", err)
		return
	}

	// confirmed must be false
	if problem.Confirmed {
		loggedHTTPErrorf(w, http.StatusBadRequest, "only unconfirmed problems can be saved")
		return
	}

	// note: unique constraint will be checked by the database

	// verify the signature
	sig := problem.computeSignature(Config.DaycareSecret)
	if sig != problem.Signature {
		loggedHTTPErrorf(w, http.StatusBadRequest, "problem signature does not check out: found %s but expected %s", problem.Signature, sig)
		return
	}

	// verify all the commits
	if len(problem.Steps) != len(problem.Commits) {
		loggedHTTPErrorf(w, http.StatusBadRequest, "problem must have exactly one commit for each problem step")
		return
	}
	for i, commit := range problem.Commits {
		// check the commit signature
		csig := commit.computeSignature(Config.DaycareSecret)
		if csig != commit.Signature {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit for step %d has a bad signature", i+1)
			return
		}

		// make sure it refers to the right step of this problem
		if commit.ProblemSignature != problem.Signature {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit for step %d does not match this problem", i+1)
			return
		}
		if commit.ProblemStepNumber != i {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit for step %d says it is for step %d", i+1, commit.ProblemStepNumber+1)
			return
		}

		// make sure this step passed
		if commit.Score != 1.0 || commit.ReportCard == nil || !commit.ReportCard.Passed {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit for step %d did not pass", i+1)
			return
		}
	}

	// save it with current timestamp and updated signature
	problem.CreatedAt = now
	problem.UpdatedAt = now
	problem.Commits = nil
	problem.Confirmed = true
	problem.Timestamp = &now
	problem.Signature = problem.computeSignature(Config.DaycareSecret)
	log.Printf("%s is signature at save time", problem.Signature)
	time.Sleep(3 * time.Second)
	log.Printf("%s is signature recomputed", problem.computeSignature(Config.DaycareSecret))
	raw, _ := json.Marshal(problem)
	jsonproblem := new(Problem)
	json.Unmarshal(raw, jsonproblem)
	time.Sleep(3 * time.Second)
	log.Printf("%s is signature after JSON round trip", jsonproblem.computeSignature(Config.DaycareSecret))

	if err := meddler.Save(tx, "problems", problem); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error saving problem: %v", err)
		return
	}

	dbproblem := new(Problem)
	meddler.Load(tx, "problems", dbproblem, int64(problem.ID))
	time.Sleep(3 * time.Second)
	log.Printf("%s is signature after DB round trip", dbproblem.computeSignature(Config.DaycareSecret))

	// return it with updated signature
	render.JSON(http.StatusOK, problem)
}

// PostProblemUnconfirmed handles a request to /api/v2/problems/unconfirmed,
// signing a new/updated problem that has not yet been tested on the daycare.
func PostProblemUnconfirmed(w http.ResponseWriter, tx *sql.Tx, currentUser *User, problem Problem, render render.Render) {
	now := time.Now().Round(time.Second)

	// clean up basic fields and do some checks
	if err := problem.normalize(now); err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "%v", err)
		return
	}

	// confirmed must be false
	if problem.Confirmed {
		loggedHTTPErrorf(w, http.StatusBadRequest, "a problem must not claim to be confirmed when preparing it to be confirmed")
		return
	}

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

	// make sure the unique ID is unique
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

	// timestamps
	problem.UpdatedAt = now

	// compute signature
	problem.Timestamp = &now
	problem.Signature = problem.computeSignature(Config.DaycareSecret)

	// check the commits
	if len(problem.Commits) != len(problem.Steps) {
		loggedHTTPErrorf(w, http.StatusBadRequest, "found %d commits for %d steps; must have the same number of commits as steps", len(problem.Commits), len(problem.Steps))
		return
	}

	whitelists := getStepWhitelists(&problem)

	for n, commit := range problem.Commits {
		commit.ID = 0
		commit.AssignmentID = 0
		if commit.ProblemStepNumber != n {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit %d has ProblemStepNumber of %d", n, commit.ProblemStepNumber)
			return
		}
		commit.UserID = currentUser.ID
		if commit.Action != "confirm" {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit %d has action %q, expected %q", n, commit.Action, "confirm")
			return
		}
		if err := commit.normalize(now, whitelists[n]); err != nil {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit %d: %v", n, err)
			return
		}

		// set timestamps and compute signature
		commit.CreatedAt = now
		commit.UpdatedAt = now
		commit.ProblemSignature = problem.Signature
		commit.Timestamp = &now
		commit.Signature = commit.computeSignature(Config.DaycareSecret)
	}

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
