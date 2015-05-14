package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"strings"
	"time"

	"github.com/sergi/go-diff/diffmatchpatch"
)

const MaxDetailsLen = 50e3

// An ActionMessage follows one of these forms:
//   auto ProblemType ProblemAction ProblemArguments ProblemOptions
//   stdin StreamData
//   stdinclosed
//   put Files
//   get Globs
//   exec ExecCommand
//   kill Signal
//   shutdown
type ActionMessage struct {
	Action           string            `json:"action"`
	ProblemType      string            `json:"problemtype,omitempty"`
	ProblemAction    string            `json:"problemaction,omitempty"`
	ProblemArguments []string          `json:"problemarguments,omitempty"`
	ProblemOptions   []string          `json:"problemoptions,omitempty"`
	StreamData       string            `json:"streamdata,omitempty"`
	Files            map[string]string `json:"files,omitempty"`
	Globs            []string          `json:"globs,omitempty"`
	ExecCommand      []string          `json:"execcommand,omitempty"`
	Signal           int               `json:"signal,omitempty"`
}

func (a *ActionMessage) String() string {
	switch a.Action {
	case "auto":
		return fmt.Sprintf("action: auto %s %s %s (%s)",
			a.ProblemType,
			a.ProblemAction,
			strings.Join(a.ProblemArguments, " "),
			strings.Join(a.ProblemOptions, " "))
	case "stdin":
		return fmt.Sprintf("action: stdin %q", a.StreamData)
	case "stdinclosed", "shutdown":
		return fmt.Sprintf("action: %s", a.Action)
	case "put":
		names := []string{}
		for name := range a.Files {
			names = append(names, name)
		}
		return fmt.Sprintf("action: put %s", strings.Join(names, ", "))
	case "get":
		return fmt.Sprintf("action: get %s", strings.Join(a.Globs, ", "))
	case "exec":
		return fmt.Sprintf("action: exec %s", strings.Join(a.ExecCommand, " "))
	case "kill":
		return fmt.Sprintf("action: kill %d", a.Signal)
	default:
		return fmt.Sprintf("unknown action: %s", a.Action)
	}
}

// An EventMessage follows one of these forms:
//   exec ExecCommand
//   exit ExitStatus
//   ended
//   stdinblocked
//   stdin StreamData
//   stdout StreamData
//   stderr StreamData
//   error Error
//   reportcard ReportCard
//   files Files
//   shutdown
type EventMessage struct {
	Pid         int               `json:"pid,omitempty"`
	When        time.Time         `json:"-"`
	Since       time.Duration     `json:"since"`
	Event       string            `json:"event"`
	ExecCommand []string          `json:"execcommand,omitempty"`
	ExitStatus  string            `json:"exitstatus,omitempty"`
	StreamData  string            `json:"streamdata,omitempty"`
	Error       string            `json:"error,omitempty"`
	ReportCard  *ReportCard       `json:"reportcard,omitempty"`
	Files       map[string]string `json:"files,omitempty"`
}

func (e *EventMessage) String() string {
	switch e.Event {
	case "exec":
		return fmt.Sprintf("event[%d]: exec %s", e.Pid, strings.Join(e.ExecCommand, " "))
	case "exit":
		return fmt.Sprintf("event[%d]: exit %s", e.Pid, e.ExitStatus)
	case "ended", "stdinblocked", "stdinclosed":
		return fmt.Sprintf("event[%d]: %s", e.Pid, e.Event)
	case "stdin", "stdout", "stderr":
		return fmt.Sprintf("event[%d]: %s %q", e.Pid, e.Event, e.StreamData)
	case "error":
		return fmt.Sprintf("event[%d]: error %s", e.Pid, e.Error)
	case "reportcard":
		return fmt.Sprintf("event[%d]: reportcard passed=%v %s in %v",
			e.Pid,
			e.ReportCard.Passed,
			e.ReportCard.Message,
			e.ReportCard.Time)
	case "files":
		names := []string{}
		for name := range e.Files {
			names = append(names, name)
		}
		return fmt.Sprintf("event[%d]: files %s", e.Pid, strings.Join(names, ", "))
	case "shutdown":
		return fmt.Sprintf("event[%d]: shutdown", e.Pid)
	default:
		return fmt.Sprintf("unknown event[%d]: %s", e.Pid, e.Event)
	}
}

// ReportCardResult types:
//   passed
//   failed
//   skipped
// Details: a multi-line message that should
//   be displayed in a monospace font
// Context:
//   path/to/file.py:line#
type ReportCardResult struct {
	Name    string `json:"name"`
	Outcome string `json:"outcome"`
	Details string `json:"details,omitempty"`
	Context string `json:"context,omitempty"`
}

// ReportCard gives the results of a graded run
type ReportCard struct {
	Passed  bool                `json:"passed"`
	Message string              `json:"message"`
	Time    time.Duration       `json:"time"`
	Results []*ReportCardResult `json:"results"`
}

func NewReportCard() *ReportCard {
	return &ReportCard{
		Passed:  true,
		Results: []*ReportCardResult{},
	}
}

func (elt *ReportCard) AddTime(duration time.Duration) {
	elt.Time += duration
}

func (elt *ReportCard) Failf(message string, params ...interface{}) {
	elt.Passed = false
	if elt.Message != "" {
		elt.Message += ", "
	}
	elt.Message += fmt.Sprintf(message, params...)
}

func (elt *ReportCard) LogAndFailf(message string, params ...interface{}) {
	msg := fmt.Sprintf(message, params...)
	log.Print(msg)

	elt.Passed = false
	if elt.Message != "" {
		elt.Message += ", "
	}
	elt.Message += msg
}

func (elt *ReportCard) AddFailedResult(name, details, context string) *ReportCardResult {
	elt.Passed = false
	r := &ReportCardResult{
		Name:    name,
		Outcome: "failed",
		Details: details,
		Context: context,
	}
	elt.Results = append(elt.Results, r)
	return r
}

func (elt *ReportCard) AddPassedResult(name, details string) *ReportCardResult {
	r := &ReportCardResult{
		Name:    name,
		Outcome: "passed",
		Details: details,
	}
	elt.Results = append(elt.Results, r)
	return r
}

func htmlEscapePre(txt string) string {
	if len(txt) > MaxDetailsLen {
		txt = txt[:MaxDetailsLen] + "\n\n[TRUNCATED]"
	}
	if strings.HasSuffix(txt, "\n") {
		txt = txt[:len(txt)-1]
	}
	escaped := html.EscapeString(txt)
	pre := "<pre>" + escaped + "</pre>"
	return pre
}

func htmlEscapeUl(txt string) string {
	if len(txt) > MaxDetailsLen {
		txt = txt[:MaxDetailsLen] + "\n\n[TRUNCATED]"
	}
	if strings.HasSuffix(txt, "\n") {
		txt = txt[:len(txt)-1]
	}
	var buf bytes.Buffer
	buf.WriteString("<ul>\n")
	lines := strings.Split(txt, "\n")
	for _, line := range lines {
		buf.WriteString("<li>")
		buf.WriteString(html.EscapeString(line))
		buf.WriteString("</li>\n")
	}
	buf.WriteString("</ul>\n")
	return buf.String()
}

func htmlEscapePara(txt string) string {
	if len(txt) > MaxDetailsLen {
		txt = txt[:MaxDetailsLen] + "\n\n[TRUNCATED]"
	}
	if strings.HasSuffix(txt, "\n") {
		txt = txt[:len(txt)-1]
	}
	var buf bytes.Buffer
	lines := strings.Split(txt, "\n")
	for _, line := range lines {
		buf.WriteString("<p>")
		buf.WriteString(html.EscapeString(line))
		buf.WriteString("</p>\n")
	}
	return buf.String()
}

func writeDiffHTML(out *bytes.Buffer, from, to, header string) {
	dmp := diffmatchpatch.New()
	diff := dmp.DiffMain(from, to, true)
	diff = dmp.DiffCleanupSemantic(diff)

	out.WriteString("<h1>" + html.EscapeString(header) + "</h1>\n<pre>")

	// write the diff
	for _, chunk := range diff {
		txt := html.EscapeString(chunk.Text)
		txt = strings.Replace(txt, "\n", "↩\n", -1)
		switch chunk.Type {
		case diffmatchpatch.DiffInsert:
			out.WriteString(`<ins style="background:#e6ffe6;">`)
			out.WriteString(txt)
			out.WriteString(`</ins>`)
		case diffmatchpatch.DiffDelete:
			out.WriteString(`<del style="background:#ffe6e6;">`)
			out.WriteString(txt)
			out.WriteString(`</del>`)
		case diffmatchpatch.DiffEqual:
			out.WriteString(`<span>`)
			out.WriteString(txt)
			out.WriteString(`</span>`)
		}
	}
	if out.Len() > MaxDetailsLen {
		out.Truncate(MaxDetailsLen)
		out.WriteString("\n\n[TRUNCATED]")
	}
	out.WriteString("</pre>")
}

func dump(elt interface{}) {
	raw, err := json.MarshalIndent(elt, "", "    ")
	if err != nil {
		panic("JSON encoding error in dump: " + err.Error())
	}
	fmt.Printf("%s\n", raw)
}
