package types

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"log"
	"net/url"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/russross/blackfriday/v2"
	"golang.org/x/net/html"
)

var BeginningOfTime = time.Date(2016, 1, 1, 0, 0, 0, 0, time.UTC)

// ProblemType defines one type of problem.
type ProblemType struct {
	Name    string                        `json:"name" meddler:"name"`
	Image   string                        `json:"image" meddler:"image"`
	Files   map[string][]byte             `json:"files,omitempty" meddler:"-"`
	Actions map[string]*ProblemTypeAction `json:"actions" meddler:"-"`
}

// ProblemTypeAction defines the labels, parser, interactivity, and handler for a
// single problem type action.
type ProblemTypeAction struct {
	ProblemType string `json:"problemType" meddler:"problem_type"`
	Action      string `json:"action,omitempty" meddler:"action"`
	Parser      string `json:"parser,omitempty" meddler:"parser,zeroisnull"`
	Message     string `json:"message,omitempty" meddler:"message"`
	Interactive bool   `json:"interactive,omitempty" meddler:"interactive"`

	MaxCPU      int64 `json:"maxCPU" meddler:"max_cpu"`
	MaxSession  int64 `json:"maxSession" meddler:"max_session"`
	MaxTimeout  int64 `json:"maxTimeout" meddler:"max_timeout"`
	MaxFD       int64 `json:"maxFD" meddler:"max_fd"`
	MaxFileSize int64 `json:"maxFileSize" meddler:"max_file_size"`
	MaxMemory   int64 `json:"maxMemory" meddler:"max_memory"`
	MaxThreads  int64 `json:"maxThreads" meddler:"max_threads"`
}

type Problem struct {
	ID          int64     `json:"id" meddler:"id,pk"`
	Unique      string    `json:"unique" meddler:"unique_id"`
	Note        string    `json:"note" meddler:"note"`
	ProblemType string    `json:"problemType" meddler:"problem_type"`
	Tags        []string  `json:"tags" meddler:"tags,json"`
	Options     []string  `json:"options" meddler:"options,json"`
	CreatedAt   time.Time `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt   time.Time `json:"updatedAt" meddler:"updated_at,localtime"`
}

// ProblemStep represents a single step of a problem.
// Anything in the root directory of Files is added to the working directory,
// possibly overwriting existing content. The subdirectory contents of Files
// replace all subdirectory contents in the problem from earlier steps.
type ProblemStep struct {
	ProblemID    int64             `json:"problemID" meddler:"problem_id"`
	Step         int64             `json:"step" meddler:"step"` // note: one-based
	Note         string            `json:"note" meddler:"note"`
	Instructions string            `json:"instructions" meddler:"instructions"`
	Weight       float64           `json:"weight" meddler:"weight"`
	Files        map[string][]byte `json:"files" meddler:"files,json"`
	Whitelist    map[string]bool   `json:"whitelist" meddler:"whitelist,json"`
}

type ProblemSet struct {
	ID        int64     `json:"id" meddler:"id,pk"`
	Unique    string    `json:"unique" meddler:"unique_id"`
	Note      string    `json:"note" meddler:"note"`
	Tags      []string  `json:"tags" meddler:"tags,json"`
	CreatedAt time.Time `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt time.Time `json:"updatedAt" meddler:"updated_at,localtime"`
}

type ProblemSetProblem struct {
	ProblemSetID int64   `json:"problemSetID,omitempty" meddler:"problem_set_id"`
	ProblemID    int64   `json:"problemID" meddler:"problem_id"`
	Weight       float64 `json:"weight" meddler:"weight"`
}

func (problem *Problem) Normalize(now time.Time, steps []*ProblemStep) error {
	// make sure the unique ID is valid
	problem.Unique = strings.TrimSpace(problem.Unique)
	if problem.Unique == "" {
		return fmt.Errorf("unique ID cannot be empty")
	}
	if url.QueryEscape(problem.Unique) != problem.Unique {
		return fmt.Errorf("unique ID must be URL friendly: %s is escaped as %s",
			problem.Unique, url.QueryEscape(problem.Unique))
	}

	// make sure the note is valid
	problem.Note = strings.TrimSpace(problem.Note)
	if problem.Note == "" {
		return fmt.Errorf("note cannot be empty")
	}

	// check tags
	if len(problem.Tags) == 0 {
		problem.Tags = []string{}
	}
	for i, tag := range problem.Tags {
		problem.Tags[i] = strings.TrimSpace(tag)
	}
	sort.Strings(problem.Tags)

	// check options
	if len(problem.Options) == 0 {
		problem.Options = []string{}
	}
	for i, option := range problem.Options {
		problem.Options[i] = strings.TrimSpace(option)
	}
	sort.Strings(problem.Tags)

	// check steps and make sure whitelists never drop names
	if len(steps) == 0 {
		return fmt.Errorf("problem must have at least one step")
	}
	for n, step := range steps {
		if err := step.Normalize(int64(n) + 1); err != nil {
			return err
		}

		if step.Whitelist == nil {
			step.Whitelist = make(map[string]bool)
		}
		if n > 0 {
			// make sure everything on the whitelist is carried forward
			for name := range steps[n-1].Whitelist {
				step.Whitelist[name] = true
			}
		}
	}

	// sanity check timestamps
	if problem.CreatedAt.Before(BeginningOfTime) || problem.CreatedAt.After(now) {
		return fmt.Errorf("problem CreatedAt time of %v is invalid", problem.CreatedAt)
	}
	if problem.UpdatedAt.Before(problem.CreatedAt) || problem.UpdatedAt.After(now) {
		return fmt.Errorf("problem UpdatedAt time of %v is invalid", problem.UpdatedAt)
	}

	return nil
}

func (problemType *ProblemType) ComputeSignature(secret string) string {
	v := make(url.Values)

	// gather all relevant fields
	v.Add("name", problemType.Name)
	v.Add("image", problemType.Image)
	for name, contents := range problemType.Files {
		v.Add(fmt.Sprintf("file-%s", name), string(contents))
	}
	for name, action := range problemType.Actions {
		v.Add(fmt.Sprintf("action-%s-parser", name), action.Parser)
		v.Add(fmt.Sprintf("action-%s-message", name), action.Message)
		v.Add(fmt.Sprintf("action-%s-interactive", name), strconv.FormatBool(action.Interactive))
		v.Add(fmt.Sprintf("action-%s-max-cpu", name), strconv.FormatInt(action.MaxCPU, 10))
		v.Add(fmt.Sprintf("action-%s-max-session", name), strconv.FormatInt(action.MaxSession, 10))
		v.Add(fmt.Sprintf("action-%s-max-timeout", name), strconv.FormatInt(action.MaxTimeout, 10))
		v.Add(fmt.Sprintf("action-%s-max-fd", name), strconv.FormatInt(action.MaxFD, 10))
		v.Add(fmt.Sprintf("action-%s-max-file-size", name), strconv.FormatInt(action.MaxFileSize, 10))
		v.Add(fmt.Sprintf("action-%s-max-memory", name), strconv.FormatInt(action.MaxMemory, 10))
		v.Add(fmt.Sprintf("action-%s-max-threads", name), strconv.FormatInt(action.MaxThreads, 10))
	}

	// compute signature
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(encode(v))
	sum := mac.Sum(nil)
	sig := base64.StdEncoding.EncodeToString(sum)
	return sig
}

func (problem *Problem) ComputeSignature(secret string, steps []*ProblemStep) string {
	v := make(url.Values)

	// gather all relevant fields
	v.Add("id", strconv.FormatInt(problem.ID, 10))
	v.Add("unique", problem.Unique)
	v.Add("note", problem.Note)
	v.Add("problemType", problem.ProblemType)
	v["tags"] = problem.Tags
	v["options"] = problem.Options
	v.Add("createdAt", problem.CreatedAt.Round(time.Second).UTC().Format(time.RFC3339))
	v.Add("updatedAt", problem.UpdatedAt.Round(time.Second).UTC().Format(time.RFC3339))
	for _, step := range steps {
		v.Add(fmt.Sprintf("step-%d-note", step.Step), step.Note)
		v.Add(fmt.Sprintf("step-%d-weight", step.Step), strconv.FormatFloat(step.Weight, 'g', -1, 64))
		for name, contents := range step.Files {
			v.Add(fmt.Sprintf("step-%d-file-%s", step.Step, name), string(contents))
		}
		for name := range step.Whitelist {
			v.Add(fmt.Sprintf("step-%d-whitelist-%s", step.Step, name), "true")
		}
	}

	// compute signature
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(encode(v))
	sum := mac.Sum(nil)
	sig := base64.StdEncoding.EncodeToString(sum)
	//log.Printf("problem signature: %s data: %s", sig, encode(v))
	return sig
}

// problem files in these directories do not have line endings cleaned up
var ProblemStepDirectoryWhitelist = map[string]bool{
	"inputs": true,
	"doc":    true,
}

// fix line endings
func (step *ProblemStep) Normalize(n int64) error {
	step.Step = n
	step.Note = strings.TrimSpace(step.Note)
	if step.Note == "" {
		return fmt.Errorf("missing note for step %d", n+1)
	}
	instructions, err := step.BuildInstructions()
	if err != nil {
		return fmt.Errorf("error building instructions for step %d: %v", n, err)
	}
	step.Instructions = instructions
	if step.Weight <= 0.0 {
		// default to 1.0
		step.Weight = 1.0
	}
	clean := make(map[string][]byte)
	for name, contents := range step.Files {
		dir := filepath.Dir(filepath.FromSlash(name))
		fixed := contents
		if (dir == "." || !ProblemStepDirectoryWhitelist[dir]) && utf8.Valid(contents) {
			fixed = fixLineEndings(contents)
			if !bytes.Equal(fixed, contents) {
				log.Printf("fixed line endings for %s", name)
			}
		} else if utf8.Valid(contents) {
			fixed = fixNewLines(contents)
			if !bytes.Equal(fixed, contents) {
				log.Printf("fixed newlines for %s", name)
			}
		}
		clean[name] = fixed
	}
	step.Files = clean
	return nil
}

// buildInstructions builds the instructions for a problem step as a single
// html document. Markdown is processed and images are inlined.
func (step *ProblemStep) BuildInstructions() (string, error) {
	// get a list of all files in the doc directory
	used := make(map[string]bool)
	for name := range step.Files {
		if filepath.Dir(name) == "doc" {
			used[name] = false
		}
	}

	var justHTML []byte
	dochtml := filepath.Join("doc", "doc.html")
	docmd := filepath.Join("doc", "doc.md")
	if data, ok := step.Files[dochtml]; ok {
		justHTML = data
		used[dochtml] = true
	} else if data, ok := step.Files[docmd]; ok {
		// render markdown
		var extensions blackfriday.Extensions
		extensions |= blackfriday.NoIntraEmphasis
		extensions |= blackfriday.Tables
		extensions |= blackfriday.FencedCode
		extensions |= blackfriday.Autolink
		extensions |= blackfriday.Strikethrough
		extensions |= blackfriday.SpaceHeadings

		justHTML = blackfriday.Run(data, blackfriday.WithExtensions(extensions))
		used[docmd] = true
	} else {
		return "", loggedErrorf("no documentation found: checked doc/doc.html and doc/doc.md")
	}

	// make sure it is well-formed utf8
	if !utf8.Valid(justHTML) {
		return "", loggedErrorf("doc.{html,md} is not valid utf8")
	}

	// parse the html
	doc, err := html.Parse(bytes.NewReader(justHTML))
	if err != nil {
		log.Printf("Error parsing doc.html: %v", err)
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
					if strings.HasPrefix(a.Val, "data:") {
						// do nothing--the data is already encoded in the tag
					} else if contents, present := step.Files[filepath.Join("doc", a.Val)]; present {
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
						log.Printf("encoding image %s as base64 data URI", a.Val)
						used[filepath.Join("doc", a.Val)] = true
						s := base64.StdEncoding.EncodeToString(contents)
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

	// warn about unused files in doc
	for name, u := range used {
		if !u {
			log.Printf("Warning: %s was not used in the instructions", name)
		}
	}

	// re-render it
	var buf bytes.Buffer
	if err = html.Render(&buf, doc); err != nil {
		log.Printf("Error rendering HTML: %v", err)
		return "", err
	}

	return buf.String(), nil
}

func (set *ProblemSet) Normalize(now time.Time) error {
	// make sure the unique ID is valid
	set.Unique = strings.TrimSpace(set.Unique)
	if set.Unique == "" {
		return fmt.Errorf("unique ID cannot be empty")
	}
	if url.QueryEscape(set.Unique) != set.Unique {
		return fmt.Errorf("unique ID must be URL friendly: %s is escaped as %s",
			set.Unique, url.QueryEscape(set.Unique))
	}

	// make sure the note is valid
	set.Note = strings.TrimSpace(set.Note)
	if set.Note == "" {
		return fmt.Errorf("note cannot be empty")
	}

	// check tags
	for i, tag := range set.Tags {
		set.Tags[i] = strings.TrimSpace(tag)
	}
	sort.Strings(set.Tags)

	// sanity check timestamps
	if set.CreatedAt.Before(BeginningOfTime) || set.CreatedAt.After(now) {
		return fmt.Errorf("problem set CreatedAt time of %v is invalid", set.CreatedAt)
	}
	if set.UpdatedAt.Before(set.CreatedAt) || set.UpdatedAt.After(now) {
		return fmt.Errorf("problem set UpdatedAt time of %v is invalid", set.UpdatedAt)
	}

	return nil
}

func fixLineEndings(s []byte) []byte {
	s = append(bytes.Replace(s, []byte("\r\n"), []byte("\n"), -1), '\n')
	for bytes.Contains(s, []byte(" \n")) {
		s = bytes.Replace(s, []byte(" \n"), []byte("\n"), -1)
	}
	for bytes.HasSuffix(s, []byte("\n\n")) {
		s = s[:len(s)-1]
	}
	if bytes.Equal(s, []byte("\n")) {
		s = []byte{}
	}
	return s
}

func fixNewLines(s []byte) []byte {
	s = append(bytes.Replace(s, []byte("\r\n"), []byte("\n"), -1), '\n')
	for bytes.HasSuffix(s, []byte("\n\n")) {
		s = s[:len(s)-1]
	}
	if bytes.Equal(s, []byte("\n")) {
		s = []byte{}
	}
	return s
}

func loggedErrorf(f string, params ...interface{}) error {
	log.Print(logPrefix() + fmt.Sprintf(f, params...))
	return fmt.Errorf(f, params...)
}

func logPrefix() string {
	prefix := ""
	if _, file, line, ok := runtime.Caller(2); ok {
		short := file
		for i := len(file) - 1; i > 0; i-- {
			if file[i] == '/' {
				short = file[i+1:]
				break
			}
		}
		file = short
		prefix = fmt.Sprintf("%s:%d: ", file, line)
	}
	return prefix
}
