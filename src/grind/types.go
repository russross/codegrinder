package main

import "time"

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

	Signature string     `json:"signature,omitempty" meddler:"-"`
	Timestamp *time.Time `json:"timestamp,omitempty" meddler:"-"`

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
	Closed            bool              `json:"closed" meddler:"closed"`
	Action            string            `json:"action" meddler:"action,zeroisnull"`
	Comment           string            `json:"comment" meddler:"comment,zeroisnull"`
	Files             map[string]string `json:"files" meddler:"files,json"`
	Transcript        []*EventMessage   `json:"transcript,omitempty" meddler:"transcript,json"`
	ReportCard        *ReportCard       `json:"reportCard" meddler:"report_card,json"`
	Score             float64           `json:"score" meddler:"score,zeroisnull"`
	CreatedAt         time.Time         `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt         time.Time         `json:"updatedAt" meddler:"updated_at,localtime"`

	ProblemSignature string     `json:"problemSignature,omitempty" meddler:"-"`
	Timestamp        *time.Time `json:"timestamp,omitempty" meddler:"-"`
	Signature        string     `json:"signature,omitempty" meddler:"-"`
}

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

type ReportCard struct {
	Passed  bool                `json:"passed"`
	Message string              `json:"message"`
	Time    time.Duration       `json:"time"`
	Results []*ReportCardResult `json:"results"`
}

type ReportCardResult struct {
	Name    string `json:"name"`
	Outcome string `json:"outcome"`
	Details string `json:"details,omitempty"`
	Context string `json:"context,omitempty"`
}
