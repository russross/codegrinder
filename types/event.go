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
type EventMessage struct {
	Time        time.Time         `json:"time"`
	Event       string            `json:"event"`
	ExecCommand []string          `json:"execcommand,omitempty"`
	ExitStatus  int               `json:"exitstatus,omitempty"`
	StreamData  []byte            `json:"streamdata,omitempty"`
	Error       string            `json:"error,omitempty"`
	ReportCard  *ReportCard       `json:"reportcard,omitempty"`
	Files       map[string][]byte `json:"files,omitempty"`
}

func (e *EventMessage) String() string {
	switch e.Event {
	case "exec":
		return fmt.Sprintf("event: exec %s", strings.Join(e.ExecCommand, " "))
	case "exit":
		return fmt.Sprintf("event: exit %d", e.ExitStatus)
	case "stdin", "stdout", "stderr":
		return fmt.Sprintf("event: %s %q", e.Event, string(e.StreamData))
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
	default:
		return fmt.Sprintf("unknown event: %s", e.Event)
	}
}

func (e *EventMessage) Dump() string {
	switch e.Event {
	case "exec":
		return fmt.Sprintf("$ %s\r\n", strings.Join(e.ExecCommand, " "))
	case "exit":
		if e.ExitStatus == 0 {
			return ""
		}
		if sig := signals[e.ExitStatus-128]; sig != "" {
			return fmt.Sprintf("exit status %d (killed by %s)\r\n", e.ExitStatus, sig)
		}
		return fmt.Sprintf("exit status %d\r\n", e.ExitStatus)
	case "stdin", "stdout", "stderr":
		return string(e.StreamData)
	case "error":
		return fmt.Sprintf("Error: %s\r\n", e.Error)
	default:
		return ""
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

func (elt *ReportCard) ComputeScore() float64 {
	if len(elt.Results) == 0 {
		return 0.0
	}
	passed := 0
	for _, result := range elt.Results {
		if result.Outcome == "passed" {
			passed++
		}
	}
	score := float64(passed) / float64(len(elt.Results))
	if !elt.Passed && score >= 1.0 {
		score = float64(passed) / float64(len(elt.Results)+1)
	}
	return score
}

var signals = map[int]string{
	1:  "SIGHUP",
	2:  "SIGINT",
	3:  "SIGQUIT",
	4:  "SIGILL",
	5:  "SIGTRAP",
	6:  "SIGABRT",
	7:  "SIGBUS",
	8:  "SIGFPE",
	9:  "SIGKILL",
	10: "SIGUSR1",
	11: "SIGSEGV",
	12: "SIGUSR2",
	13: "SIGPIPE",
	14: "SIGALRM",
	15: "SIGTERM",
	16: "SIGSTKFLT",
	17: "SIGCHLD",
	18: "SIGCONT",
	19: "SIGSTOP",
	20: "SIGTSTP",
	21: "SIGTTIN",
	22: "SIGTTOU",
	23: "SIGURG",
	24: "SIGXCPU",
	25: "SIGXFSZ",
	26: "SIGVTALRM",
	27: "SIGPROF",
	28: "SIGWINCH",
	29: "SIGIO",
	30: "SIGPWR",
	31: "SIGSYS",
	34: "SIGRTMIN",
	35: "SIGRTMIN+1",
	36: "SIGRTMIN+2",
	37: "SIGRTMIN+3",
	38: "SIGRTMIN+4",
	39: "SIGRTMIN+5",
	40: "SIGRTMIN+6",
	41: "SIGRTMIN+7",
	42: "SIGRTMIN+8",
	43: "SIGRTMIN+9",
	44: "SIGRTMIN+10",
	45: "SIGRTMIN+11",
	46: "SIGRTMIN+12",
	47: "SIGRTMIN+13",
	48: "SIGRTMIN+14",
	49: "SIGRTMIN+15",
	50: "SIGRTMAX-14",
	51: "SIGRTMAX-13",
	52: "SIGRTMAX-12",
	53: "SIGRTMAX-11",
	54: "SIGRTMAX-10",
	55: "SIGRTMAX-9",
	56: "SIGRTMAX-8",
	57: "SIGRTMAX-7",
	58: "SIGRTMAX-6",
	59: "SIGRTMAX-5",
	60: "SIGRTMAX-4",
	61: "SIGRTMAX-3",
	62: "SIGRTMAX-2",
	63: "SIGRTMAX-1",
	64: "SIGRTMAX",
}
