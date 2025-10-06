package rpc

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

// BeginningOfTime is the earliest valid timestamp
var BeginningOfTime = time.Date(2016, 1, 1, 0, 0, 0, 0, time.UTC)

// ProblemStepDirectoryWhitelist lists directories where line endings should not be cleaned
var ProblemStepDirectoryWhitelist = map[string]bool{
	"inputs":  true,
	"outputs": true,
	"doc":     true,
}

// Normalize validates and normalizes a Problem
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
	incomplete := false
	for n, step := range steps {
		if step == nil {
			// this is a commit bundle and does not include all steps, so
			// do not try to validate and/or normalize whitelist
			//
			// whitelist is handled in problem validation
			incomplete = true
			continue
		}
		if err := step.Normalize(int64(n) + 1); err != nil {
			return err
		}

		if incomplete {
			continue
		}
		// build a temporary map for whitelist processing
		wlMap := make(map[string]bool)
		for _, name := range step.Whitelist {
			wlMap[name] = true
		}

		if n > 0 {
			// make sure everything on the whitelist is carried forward
			for _, name := range steps[n-1].Whitelist {
				wlMap[name] = true
			}
		}
		// convert back to slice
		step.Whitelist = make([]string, 0, len(wlMap))
		for name := range wlMap {
			step.Whitelist = append(step.Whitelist, name)
		}
		sort.Strings(step.Whitelist)
	}

	// sanity check timestamps
	if problem.CreatedAt.AsTime().Before(BeginningOfTime) || problem.CreatedAt.AsTime().After(now) {
		return fmt.Errorf("problem CreatedAt time of %v is invalid", problem.CreatedAt.AsTime())
	}
	if problem.UpdatedAt.AsTime().Before(problem.CreatedAt.AsTime()) || problem.UpdatedAt.AsTime().After(now) {
		return fmt.Errorf("problem UpdatedAt time of %v is invalid", problem.UpdatedAt.AsTime())
	}

	return nil
}

// ComputeSignature computes the signature for a Problem
func (problem *Problem) ComputeSignature(secret string, steps []*ProblemStep) string {
	v := make(url.Values)

	// gather all relevant fields
	v.Add("id", strconv.FormatInt(problem.Id, 10))
	v.Add("unique", problem.Unique)
	v.Add("note", problem.Note)
	v["tags"] = problem.Tags
	v["options"] = problem.Options
	v.Add("createdAt", problem.CreatedAt.AsTime().Round(time.Second).UTC().Format(time.RFC3339))
	v.Add("updatedAt", problem.UpdatedAt.AsTime().Round(time.Second).UTC().Format(time.RFC3339))
	   for n, step := range steps {
			if step == nil {
				v.Add(fmt.Sprintf("step-%d-nil", n+1), "")
				continue
			}
			v.Add(fmt.Sprintf("step-%d-problem-type", step.Step), step.ProblemType)
			v.Add(fmt.Sprintf("step-%d-note", step.Step), step.Note)
			v.Add(fmt.Sprintf("step-%d-weight", step.Step), strconv.FormatFloat(step.Weight, 'g', -1, 64))
			for _, file := range step.Files {
				v.Add(fmt.Sprintf("step-%d-file-%s", step.Step, file.Path), string(file.Contents))
			}
			for _, name := range step.Whitelist {
				v.Add(fmt.Sprintf("step-%d-whitelist-%s", step.Step, name), "true")
			}
	   }
	// compute signature
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(encode(v))
	sum := mac.Sum(nil)
	sig := base64.StdEncoding.EncodeToString(sum)
	return sig
}

// ComputeSignature computes the signature for a ProblemType
func (problemType *ProblemType) ComputeSignature(secret string) string {
	v := make(url.Values)

	// gather all relevant fields
	   v.Add("name", problemType.Name)
	   v.Add("image", problemType.Image)
	   for _, file := range problemType.Files {
			v.Add(fmt.Sprintf("file-%s", file.Path), string(file.Contents))
	   }
	   for _, action := range problemType.Actions {
			v.Add(fmt.Sprintf("action-%s-command", action.Action), action.Command)
			v.Add(fmt.Sprintf("action-%s-parser", action.Action), action.Parser)
			v.Add(fmt.Sprintf("action-%s-message", action.Action), action.Message)
			v.Add(fmt.Sprintf("action-%s-interactive", action.Action), strconv.FormatBool(action.Interactive))
			v.Add(fmt.Sprintf("action-%s-max-cpu", action.Action), strconv.FormatInt(action.MaxCpu, 10))
			v.Add(fmt.Sprintf("action-%s-max-session", action.Action), strconv.FormatInt(action.MaxSession, 10))
			v.Add(fmt.Sprintf("action-%s-max-timeout", action.Action), strconv.FormatInt(action.MaxTimeout, 10))
			v.Add(fmt.Sprintf("action-%s-max-fd", action.Action), strconv.FormatInt(action.MaxFd, 10))
			v.Add(fmt.Sprintf("action-%s-max-file-size", action.Action), strconv.FormatInt(action.MaxFileSize, 10))
			v.Add(fmt.Sprintf("action-%s-max-memory", action.Action), strconv.FormatInt(action.MaxMemory, 10))
			v.Add(fmt.Sprintf("action-%s-max-threads", action.Action), strconv.FormatInt(action.MaxThreads, 10))
	   }
	// compute signature
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(encode(v))
	sum := mac.Sum(nil)
	sig := base64.StdEncoding.EncodeToString(sum)
	return sig
}

// Normalize validates and normalizes a ProblemStep
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
		clean := []*File{}
		for _, file := range step.Files {
			dir := filepath.Dir(filepath.FromSlash(file.Path))
			fixed := file.Contents
			if (dir == "." || !ProblemStepDirectoryWhitelist[dir]) && utf8.Valid(file.Contents) {
				fixed = fixLineEndings(file.Contents)
				if !bytes.Equal(fixed, file.Contents) {
					log.Printf("fixed line endings for %s", file.Path)
				}
			} else if utf8.Valid(file.Contents) {
				fixed = fixNewLines(file.Contents)
				if !bytes.Equal(fixed, file.Contents) {
					log.Printf("fixed newlines for %s", file.Path)
				}
			}
			clean = append(clean, &File{Path: file.Path, Contents: fixed})
		}
		step.Files = clean
		return nil
	}
// BuildInstructions builds the instructions for a ProblemStep as HTML
func (step *ProblemStep) BuildInstructions() (string, error) {
	// get a list of all files in the doc directory
	used := make(map[string]bool)
	fileMap := make(map[string]*File)
	for _, file := range step.Files {
		fileMap[file.Path] = file
		if filepath.Dir(file.Path) == "doc" {
			used[file.Path] = false
		}
	}

	var justHTML []byte
	dochtml := filepath.Join("doc", "doc.html")
	docmd := filepath.Join("doc", "doc.md")
	if file, ok := fileMap[dochtml]; ok {
		justHTML = file.Contents
		used[dochtml] = true
	} else if file, ok := fileMap[docmd]; ok {
		// render markdown
		var extensions blackfriday.Extensions
		extensions |= blackfriday.NoIntraEmphasis
		extensions |= blackfriday.Tables
		extensions |= blackfriday.FencedCode
		extensions |= blackfriday.Autolink
		extensions |= blackfriday.Strikethrough
		extensions |= blackfriday.SpaceHeadings

		renderer := blackfriday.NewHTMLRenderer(blackfriday.HTMLRendererParameters{})

		justHTML = blackfriday.Run(file.Contents,
			blackfriday.WithExtensions(extensions),
			blackfriday.WithRenderer(renderer))
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
					} else if file, present := fileMap[filepath.Join("doc", a.Val)]; present {
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
						s := base64.StdEncoding.EncodeToString(file.Contents)
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

// Normalize validates and normalizes a ProblemSet
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
	if set.CreatedAt.AsTime().Before(BeginningOfTime) || set.CreatedAt.AsTime().After(now) {
		return fmt.Errorf("problem set CreatedAt time of %v is invalid", set.CreatedAt.AsTime())
	}
	if set.UpdatedAt.AsTime().Before(set.CreatedAt.AsTime()) || set.UpdatedAt.AsTime().After(now) {
		return fmt.Errorf("problem set UpdatedAt time of %v is invalid", set.UpdatedAt.AsTime())
	}

	return nil
}

// fixLineEndings normalizes line endings
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

// fixNewLines fixes newlines
func fixNewLines(s []byte) []byte {
	return bytes.Replace(s, []byte("\r\n"), []byte("\n"), -1)
}

// loggedErrorf logs and returns an error
func loggedErrorf(f string, params ...interface{}) error {
	log.Print(logPrefix() + fmt.Sprintf(f, params...))
	return fmt.Errorf(f, params...)
}

// logPrefix returns a prefix for log messages
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

// encode is url.URL.Encode from the standard library, but using escape instead of url.QueryEscape
func encode(v url.Values) []byte {
	if v == nil {
		return []byte{}
	}
	var buf bytes.Buffer
	keys := make([]string, 0, len(v))
	for k := range v {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		vs := v[k]
		prefix := escape(k) + "="
		for _, v := range vs {
			if buf.Len() > 0 {
				buf.WriteByte('&')
			}
			buf.WriteString(prefix)
			buf.WriteString(escape(v))
		}
	}
	return buf.Bytes()
}

// escape URL encodes a string
func escape(s string) string {
	var buf bytes.Buffer
	for _, b := range []byte(s) {
		if b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || b == '-' || b == '.' || b == '_' || b == '~' {
			buf.WriteByte(b)
		} else {
			fmt.Fprintf(&buf, "%%%02X", b)
		}
	}
	return buf.String()
}
