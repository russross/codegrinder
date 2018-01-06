package common

import "time"

// Quiz represents a single session of interactive student quizzes, usually
// from a single class period.
type Quiz struct {
	ID                     int64     `json:"id" meddler:"id,pk"`
	AssignmentID           int64     `json:"assignmentID" meddler:"assignment_id"` // creator
	LtiID                  string    `json:"-" meddler:"lti_id"`
	Note                   string    `json:"note" meddler:"note"`
	Weight                 float64   `json:"weight" meddler:"weight"`
	ParticipationThreshold float64   `json:"participationThreshold" meddler:"participation_threshold"`
	ParticipationPercent   float64   `json:"participationPercent" meddler:"participation_percent"`
	IsGraded               bool      `json:"isGraded" meddler:"is_graded"`
	CreatedAt              time.Time `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt              time.Time `json:"updatedAt" meddler:"updated_at,localtime"`
}

type QuizPatch struct {
	Note                   *string  `json:"note"`
	Weight                 *float64 `json:"weight"`
	ParticipationThreshold *float64 `json:"participationThreshold"`
	ParticipationPercent   *float64 `json:"participationPercent"`
	IsGraded               *bool    `json:"isGraded"`
}

// Question represents a single interactive quiz question.
type Question struct {
	ID                 int64              `json:"id" meddler:"id,pk"`
	QuizID             int64              `json:"quizID" meddler:"quiz_id"`
	Number             int64              `json:"number" meddler:"question_number"` // note: 1-based
	Note               string             `json:"note" meddler:"note"`
	Weight             float64            `json:"weight" meddler:"weight"`
	PointsForAttempt   float64            `json:"pointsForAttempt" meddler:"points_for_attempt"`
	IsMultipleChoice   bool               `json:"isMultipleChoice" meddler:"is_multiple_choice"`
	Answers            map[string]float64 `json:"answers" meddler:"answers,json"`
	AnswerFilterRegexp string             `json:"answerFilterRegexp" meddler:"answer_filter_regexp,zeroisnull"`
	OpenedAt           time.Time          `json:"openedAt" meddler:"opened_at,localtime"`
	OpenSeconds        int64              `json:"openSeconds" meddler:"open_seconds"`
	CreatedAt          time.Time          `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt          time.Time          `json:"updatedAt" meddler:"updated_at,localtime"`
}

func (question *Question) ClosedAt() time.Time {
	return question.OpenedAt.Add(time.Duration(question.OpenSeconds) * time.Second)
}

func (question *Question) HideAnswersUnlessClosed() {
	if question.ClosedAt().After(time.Now()) {
		clean := make(map[string]float64)
		if question.IsMultipleChoice {
			for choice := range question.Answers {
				clean[choice] = 0.0
			}
		}
		question.Answers = clean
	}
}

type QuestionPatch struct {
	Note               *string             `json:"note"`
	Weight             *float64            `json:"weight"`
	PointsForAttempt   *float64            `json:"pointsForAttempt"`
	IsMultipleChoice   *bool               `json:"isMultipleChoice"`
	Answers            *map[string]float64 `json:"answers"`
	AnswerFilterRegexp *string             `json:"answerFilterRegexp"`
	OpenedAt           *time.Time          `json:"openedAt"`
	OpenSeconds        *int64              `json:"openSeconds"`
}

// Response represents a student response to a single question.
type Response struct {
	ID           int64     `json:"id" meddler:"id,pk"`
	AssignmentID int64     `json:"assignmentID" meddler:"assignment_id"`
	QuestionID   int64     `json:"questionID" meddler:"question_id"`
	Response     string    `json:"response" meddler:"response"`
	CreatedAt    time.Time `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt    time.Time `json:"updatedAt" meddler:"updated_at,localtime"`
}
