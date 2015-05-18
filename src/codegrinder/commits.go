package main

import "time"

const (
	TranscriptEventCountLimit = 500
	TranscriptDataLimit       = 1e5
)

type Commit struct {
	ID             int         `json:"id" meddler:"id,pk"`
	AssignmentID   int         `json:"assignmentId" meddler:"assignment_id"`
	ProblemStepID  int         `json:"problemStepId" meddler:"problem_step_id"`
	ParentCommitID int         `json:"parentCommitId" meddler:"parent_commit_id,zeroisnull"`
	UserID         int         `json:"userId" meddler:"user_id"`
	Action         string      `json:"action" meddler:"action,zeroisnull"`
	Closed         bool        `json:"closed" meddler:"closed"`
	Comment        string      `json:"comment" meddler:"comment,zeroisnull"`
	Score          float64     `json:"score" meddler:"score,zeroisnull"`
	ReportCard     *ReportCard `json:"reportCard" meddler:"report_card,json"`
	Submission     *Submission `json:"submission" meddler:"submission,json"`
	Transcript     *Transcript `json:"transcript" meddler:"transcript,json"`
	CreatedAt      time.Time   `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt      time.Time   `json:"updatedAt" meddler:"updated_at,localtime"`
}

type Submission struct {
	Files map[string]string `json:"files"`
}

type Transcript struct {
	Events []*EventMessage `json:"events"`
}
