package types

import (
	"fmt"
	"log"
	"strings"
	"time"
)

const MaxDetailsLen = 50e3

// ReportCard gives the results of a graded run
type ReportCard struct {
	Passed   bool                `json:"passed"`
	Note     string              `json:"note"`
	Duration time.Duration       `json:"duration"`
	Results  []*ReportCardResult `json:"results"`
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
			e.ReportCard.Note,
			e.ReportCard.Duration)
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
	elt.Duration += duration
}

func (elt *ReportCard) Failf(note string, params ...interface{}) {
	elt.Passed = false
	if elt.Note != "" {
		elt.Note += ", "
	}
	elt.Note += fmt.Sprintf(note, params...)
}

func (elt *ReportCard) LogAndFailf(note string, params ...interface{}) {
	msg := fmt.Sprintf(note, params...)
	log.Print(msg)

	elt.Passed = false
	if elt.Note != "" {
		elt.Note += ", "
	}
	elt.Note += msg
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
