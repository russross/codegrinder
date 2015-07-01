package main

import (
	"fmt"
	"strings"
	"time"
)

type User struct {
	ID             int       `json:"id" meddler:"id,pk"`
	Name           string    `json:"name" meddler:"name"`
	Email          string    `json:"email" meddler:"email"`
	LtiID          string    `json:"ltiID" meddler:"lti_id"`
	ImageURL       string    `json:"imageURL" meddler:"lti_image_url"`
	CanvasLogin    string    `json:"canvasLogin" meddler:"canvas_login"`
	CanvasID       int       `json:"canvasID" meddler:"canvas_id"`
	CreatedAt      time.Time `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt      time.Time `json:"updatedAt" meddler:"updated_at,localtime"`
	LastSignedInAt time.Time `json:"lastSignedInAt" meddler:"last_signed_in_at,localtime"`
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

	Signature string `json:"signature,omitempty" meddler:"-"`

	// only included when a problem is being created/updated
	Commits []*Commit `json:"commits,omitempty" meddler:"-"`
}

type ProblemStep struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	ScoreWeight float64           `json:"scoreWeight"`
	Files       map[string]string `json:"files"`
}

type Commit struct {
	ID                int               `json:"id" meddler:"id,pk"`
	AssignmentID      int               `json:"assignmentID" meddler:"assignment_id"`
	ProblemStepNumber int               `json:"problemStepNumber" meddler:"problem_step_number"`
	UserID            int               `json:"userID" meddler:"user_id"`
	Action            string            `json:"action" meddler:"action,zeroisnull"`
	Comment           string            `json:"comment" meddler:"comment,zeroisnull"`
	Files             map[string]string `json:"files" meddler:"files,json"`
	Transcript        []*EventMessage   `json:"transcript,omitempty" meddler:"transcript,json"`
	ReportCard        *ReportCard       `json:"reportCard" meddler:"report_card,json"`
	Score             float64           `json:"score" meddler:"score,zeroisnull"`
	CreatedAt         time.Time         `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt         time.Time         `json:"updatedAt" meddler:"updated_at,localtime"`

	ProblemSignature string `json:"problemSignature,omitempty" meddler:"-"`
	Signature        string `json:"signature,omitempty" meddler:"-"`
}

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

type Assignment struct {
	ID                 int            `json:"id" meddler:"id,pk"`
	CourseID           int            `json:"courseID" meddler:"course_id"`
	ProblemID          int            `json:"problemID" meddler:"problem_id"`
	UserID             int            `json:"userID" meddler:"user_id"`
	Roles              string         `json:"roles" meddler:"roles"`
	Points             float64        `json:"points" meddler:"points,zeroisnull"`
	Survey             map[string]int `json:"survey" meddler:"survey,json"`
	GradeID            string         `json:"-" meddler:"grade_id,zeroisnull"`
	LtiID              string         `json:"-" meddler:"lti_id"`
	CanvasTitle        string         `json:"canvasTitle" meddler:"canvas_title"`
	CanvasID           int            `json:"canvasID" meddler:"canvas_id"`
	CanvasAPIDomain    string         `json:"canvasAPIDomain" meddler:"canvas_api_domain"`
	OutcomeURL         string         `json:"-" meddler:"outcome_url"`
	OutcomeExtURL      string         `json:"-" meddler:"outcome_ext_url"`
	OutcomeExtAccepted string         `json:"-" meddler:"outcome_ext_accepted"`
	FinishedURL        string         `json:"finishedURL" meddler:"finished_url"`
	ConsumerKey        string         `json:"-" meddler:"consumer_key"`
	CreatedAt          time.Time      `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt          time.Time      `json:"updatedAt" meddler:"updated_at,localtime"`
}

type Course struct {
	ID        int       `json:"id" meddler:"id,pk"`
	Name      string    `json:"name" meddler:"name"`
	Label     string    `json:"label" meddler:"lti_label"`
	LtiID     string    `json:"ltiID" meddler:"lti_id"`
	CanvasID  int       `json:"canvasID" meddler:"canvas_id"`
	CreatedAt time.Time `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt time.Time `json:"updatedAt" meddler:"updated_at,localtime"`
}
