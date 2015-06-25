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

// ReportCard gives the results of a graded run
type ReportCard struct {
	Passed  bool                `json:"passed"`
	Message string              `json:"message"`
	Time    time.Duration       `json:"time"`
	Results []*ReportCardResult `json:"results"`
}

// ReportCardResult Outcomes:
//   passed
//   failed
//   error
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

// EventMessage follows one of these forms:
//   exec ExecCommand
//   exit ExitStatus
//   stdin StreamData
//   stdout StreamData
//   stderr StreamData
//   stdinclosed
//   error Error
//   reportcard ReportCard
//   files Files
//   shutdown
type EventMessage struct {
	Time        time.Time         `json:"time"`
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
		return fmt.Sprintf("event: exec %s", strings.Join(e.ExecCommand, " "))
	case "exit":
		return fmt.Sprintf("event: exit %s", e.ExitStatus)
	case "stdin", "stdout", "stderr":
		return fmt.Sprintf("event: %s %q", e.Event, e.StreamData)
	case "stdinclosed":
		return fmt.Sprintf("event: %s", e.Event)
	case "error":
		return fmt.Sprintf("event: error %s", e.Error)
	case "reportcard":
		return fmt.Sprintf("event: reportcard passed=%v %s in %v",
			e.ReportCard.Passed,
			e.ReportCard.Message,
			e.ReportCard.Time)
	case "files":
		names := []string{}
		for name := range e.Files {
			names = append(names, name)
		}
		return fmt.Sprintf("event: files %s", strings.Join(names, ", "))
	case "shutdown":
		return fmt.Sprintf("event: shutdown")
	default:
		return fmt.Sprintf("unknown event: %s", e.Event)
	}
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
