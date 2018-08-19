package main

import (
	"bytes"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-martini/martini"
	"github.com/martini-contrib/render"
	. "github.com/russross/codegrinder/common"
	"github.com/russross/meddler"
)

const RecordSeparator = "\036"

// GetAssignmentQuizzes handles requests to /v2/assignments/:assignment_id/quizzes,
// returning a list of quizzes for a given assignment.
func GetAssignmentQuizzes(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	assignmentID, err := parseID(w, "assignment_id", params["assignment_id"])
	if err != nil {
		return
	}

	quizzes := []*Quiz{}
	err = meddler.QueryAll(tx, &quizzes, `SELECT quizzes.* FROM quizzes JOIN assignments ON quizzes.lti_id = assignments.lti_id `+
		`WHERE assignments.id = $1 AND assignments.user_id = $2 `+
		`ORDER BY quizzes.created_at`, assignmentID, currentUser.ID)
	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	render.JSON(http.StatusOK, quizzes)
}

func GetQuiz(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	quizID, err := parseID(w, "quiz_id", params["quiz_id"])
	if err != nil {
		return
	}

	quiz := new(Quiz)
	err = meddler.QueryRow(tx, quiz, `SELECT quizzes.* `+
		`FROM quizzes JOIN assignments ON quizzes.lti_id = assignments.lti_id `+
		`WHERE quizzes.id = $1 AND assignments.user_id = $2`,
		quizID, currentUser.ID)
	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	render.JSON(http.StatusOK, quiz)
}

func PostQuiz(w http.ResponseWriter, tx *sql.Tx, currentUser *User, quiz Quiz, render render.Render) {
	now := time.Now()

	if quiz.AssignmentID < 1 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "assignmentID is required")
		return
	}

	assignment := new(Assignment)
	if err := meddler.QueryRow(tx, assignment, `SELECT * FROM assignments WHERE id = $1 AND user_id = $2`, quiz.AssignmentID, currentUser.ID); err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}
	if !assignment.Instructor {
		loggedHTTPErrorf(w, http.StatusUnauthorized, "only the instructor can create a quiz")
		return
	}

	quiz.ID = 0
	quiz.LtiID = assignment.LtiID
	quiz.Note = strings.TrimSpace(quiz.Note)
	if quiz.Weight < 0.0 {
		quiz.Weight = 1.0
	}
	if quiz.ParticipationThreshold < 0.0 {
		quiz.ParticipationThreshold = 0.0
	}
	if quiz.ParticipationThreshold > 1.0 {
		quiz.ParticipationThreshold = 1.0
	}
	if quiz.ParticipationPercent < 0.0 {
		quiz.ParticipationPercent = 0.0
	}
	if quiz.ParticipationPercent > 1.0 {
		quiz.ParticipationPercent = 1.0
	}
	quiz.IsGraded = false
	quiz.CreatedAt = now
	quiz.UpdatedAt = now

	if err := meddler.Save(tx, "quizzes", &quiz); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	render.JSON(http.StatusOK, &quiz)
}

func PatchQuiz(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, patch QuizPatch, render render.Render) {
	now := time.Now()

	quizID, err := parseID(w, "quiz_id", params["quiz_id"])
	if err != nil {
		return
	}

	quiz := new(Quiz)
	err = meddler.QueryRow(tx, quiz, `SELECT quizzes.* `+
		`FROM quizzes JOIN assignments ON quizzes.lti_id = assignments.lti_id `+
		`WHERE quizzes.id = $1 AND assignments.user_id = $2 AND assignments.instructor`, quizID, currentUser.ID)

	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	if patch.Note != nil {
		quiz.Note = strings.TrimSpace(*patch.Note)
	}
	if patch.Weight != nil {
		quiz.Weight = *patch.Weight
		if quiz.Weight < 0.0 {
			quiz.Weight = 1.0
		}
	}
	if patch.ParticipationThreshold != nil {
		quiz.ParticipationThreshold = *patch.ParticipationThreshold
		if quiz.ParticipationThreshold < 0.0 {
			quiz.ParticipationThreshold = 0.0
		}
		if quiz.ParticipationThreshold > 1.0 {
			quiz.ParticipationThreshold = 1.0
		}
	}
	if patch.ParticipationPercent != nil {
		quiz.ParticipationPercent = *patch.ParticipationPercent
		if quiz.ParticipationPercent < 0.0 {
			quiz.ParticipationPercent = 0.0
		}
		if quiz.ParticipationPercent > 1.0 {
			quiz.ParticipationPercent = 1.0
		}
	}
	if patch.IsGraded != nil {
		quiz.IsGraded = *patch.IsGraded
	}
	quiz.UpdatedAt = now

	if err = meddler.Save(tx, "quizzes", quiz); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	// re-grade after any change if IsGraded is set (including a change that sets IsGraded)
	if quiz.IsGraded {
		if err := gradeQuizClass(now, tx, quiz.ID); err != nil {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "error updating class grades: %v", err)
			return
		}
	}

	render.JSON(http.StatusOK, &quiz)
}

func DeleteQuiz(w http.ResponseWriter, tx *sql.Tx, currentUser *User, params martini.Params) {
	quizID, err := parseID(w, "quiz_id", params["quiz_id"])
	if err != nil {
		return
	}

	assignment := new(Assignment)
	if err = meddler.QueryRow(tx, assignment, `SELECT DISTINCT(assignments.*) `+
		`FROM assignments JOIN quizzes ON assignments.lti_id = quizzes.lti_id `+
		`WHERE quizzes.id = $1 AND assignments.user_id = $2`, quizID, currentUser.ID); err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	if !assignment.Instructor {
		loggedHTTPErrorf(w, http.StatusUnauthorized, "only the instructor can delete a quiz")
		return
	}

	var count int
	err = tx.QueryRow(`SELECT COUNT(1) FROM questions WHERE quiz_id = $1`, quizID).Scan(&count)
	if err == nil && count > 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "cannot delete a quiz with questions: delete all of the questions and try again")
		return
	} else if err == nil {
		_, err = tx.Exec(`DELETE FROM quizzes WHERE id = $1`, quizID)
	}

	// TODO: update grades based on quiz deletion?

	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
}

func GetQuizQuestions(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	quizID, err := parseID(w, "quiz_id", params["quiz_id"])
	if err != nil {
		return
	}

	assignment := new(Assignment)
	if err = meddler.QueryRow(tx, assignment, `SELECT assignments.* `+
		`FROM assignments JOIN quizzes ON assignments.lti_id = quizzes.lti_id `+
		`WHERE quizzes.id = $1 AND assignments.user_id = $2`,
		quizID, currentUser.ID); err != nil {
		loggedHTTPDBNotFoundError(w, err)
	}

	questions := []*Question{}
	err = meddler.QueryAll(tx, &questions, `SELECT questions.* from questions `+
		`JOIN quizzes ON quizzes.id = questions.quiz_id `+
		`WHERE quizzes.id = $1 AND quizzes.lti_id = $2 `+
		`ORDER BY questions.question_number`, quizID, assignment.LtiID)
	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	// hide answers from student for open questions
	if !assignment.Instructor {
		for _, question := range questions {
			question.HideAnswersUnlessClosed()
		}
	}

	render.JSON(http.StatusOK, questions)
}

func GetAssignmentQuestionsOpen(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	assignmentID, err := parseID(w, "assignment_id", params["assignment_id"])
	if err != nil {
		return
	}

	assignment := new(Assignment)
	if err = meddler.QueryRow(tx, assignment, `SELECT * FROM assignments `+
		`WHERE id = $1 AND user_id = $2`, assignmentID, currentUser.ID); err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	questions := []*Question{}
	err = meddler.QueryAll(tx, &questions, `SELECT questions.* `+
		`FROM questions JOIN quizzes ON questions.quiz_id = quizzes.id `+
		`WHERE quizzes.lti_id = $1 `+
		`AND questions.closed_at > now() `+
		`ORDER BY questions.quiz_id, questions.question_number`, assignment.LtiID)

	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	// hide answers from student for open questions
	if !assignment.Instructor {
		for _, question := range questions {
			question.HideAnswersUnlessClosed()
		}
	}

	render.JSON(http.StatusOK, questions)
}

func GetQuestion(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	questionID, err := parseID(w, "question_id", params["question_id"])
	if err != nil {
		return
	}

	assignment := new(Assignment)
	if err = meddler.QueryRow(tx, assignment, `SELECT assignments.* `+
		`FROM assignments JOIN quizzes ON assignments.lti_id = quizzes.lti_id `+
		`JOIN questions ON questions.quiz_id = quizzes.id `+
		`WHERE questions.id = $1 AND assignments.user_id = $2`, questionID, currentUser.ID); err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	question := new(Question)
	if err = meddler.Load(tx, "questions", question, questionID); err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	if !assignment.Instructor {
		question.HideAnswersUnlessClosed()
	}

	render.JSON(http.StatusOK, question)
}

func PostQuestion(w http.ResponseWriter, tx *sql.Tx, currentUser *User, question Question, render render.Render) {
	now := time.Now()

	if question.QuizID < 1 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "quizID is required")
		return
	}

	// make sure this is the instructor
	assignment := new(Assignment)
	if err := meddler.QueryRow(tx, assignment, `SELECT assignments.* `+
		`FROM assignments JOIN quizzes ON assignments.id = quizzes.assignment_id `+
		`WHERE quizzes.id = $1 AND assignments.user_id = $2`, question.QuizID, currentUser.ID); err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}
	if !assignment.Instructor {
		loggedHTTPErrorf(w, http.StatusUnauthorized, "only the instructor can create a quiz question")
		return
	}

	// figure out the question sequence number
	var count int64
	if err := tx.QueryRow(`SELECT COUNT(1) FROM questions WHERE quiz_id = $1`, question.QuizID).Scan(&count); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	question.ID = 0
	question.Number = count + 1
	question.Note = strings.TrimSpace(question.Note)
	if question.Weight < 0.0 {
		question.Weight = 1.0
	}
	if question.PointsForAttempt < 0.0 {
		question.PointsForAttempt = 0.0
	}
	if question.IsMultipleChoice && len(question.Answers) < 2 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "multiple-choice question must have at least two choices")
		return
	}
	question.CreatedAt = now
	question.UpdatedAt = now
	if question.ClosedAt != nil && question.ClosedAt.Before(now) {
		loggedHTTPErrorf(w, http.StatusBadRequest, "cannot create a question that is already closed")
	}

	if err := meddler.Save(tx, "questions", &question); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
	if _, err := tx.Exec(`UPDATE quizzes SET is_graded = $1 WHERE id = $2 AND is_graded`, false, question.QuizID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	render.JSON(http.StatusOK, &question)
}

func PatchQuestion(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, patch QuestionPatch, render render.Render) {
	now := time.Now()

	questionID, err := parseID(w, "question_id", params["question_id"])
	if err != nil {
		return
	}

	question := new(Question)
	err = meddler.QueryRow(tx, question, `SELECT questions.* `+
		`FROM questions JOIN quizzes ON questions.quiz_id = quizzes.id `+
		`JOIN assignments ON assignments.lti_id = quizzes.lti_id `+
		`WHERE questions.id = $1 AND assignments.user_id = $2`, questionID, currentUser.ID)
	if err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	if patch.Note != nil {
		question.Note = strings.TrimSpace(*patch.Note)
	}
	if patch.Weight != nil {
		question.Weight = *patch.Weight
		if question.Weight < 0.0 {
			question.Weight = 1.0
		}
	}
	if patch.PointsForAttempt != nil {
		question.PointsForAttempt = *patch.PointsForAttempt
		if question.PointsForAttempt < 0.0 {
			question.PointsForAttempt = 0.0
		}
	}
	if patch.IsMultipleChoice != nil {
		question.IsMultipleChoice = *patch.IsMultipleChoice
	}
	if patch.Answers != nil {
		question.Answers = *patch.Answers
	}
	if question.IsMultipleChoice && len(question.Answers) < 2 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "multiple-choice question must have at least two choices")
		return
	}
	if patch.ClosedAt != nil {
		question.ClosedAt = patch.ClosedAt

		// it is okay to patch a question to being closed now
		if question.ClosedAt.Before(now) {
			question.ClosedAt = &now
		}
	}
	question.UpdatedAt = now

	if err = meddler.Save(tx, "questions", question); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
	if _, err := tx.Exec(`UPDATE quizzes SET is_graded = $1 WHERE id = $2 AND is_graded`, false, question.QuizID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	render.JSON(http.StatusOK, question)
}

func PostResponse(w http.ResponseWriter, tx *sql.Tx, currentUser *User, response Response, render render.Render) {
	now := time.Now()

	response.ID = 0
	if response.AssignmentID < 1 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "assignmentID is required")
		return
	}
	if response.QuestionID < 1 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "questionID is required")
		return
	}
	response.Response = strings.TrimSpace(response.Response)
	response.CreatedAt = now
	response.UpdatedAt = now

	// get the assignment and the question
	assignment := new(Assignment)
	if err := meddler.QueryRow(tx, assignment, `SELECT * FROM assignments `+
		`WHERE id = $1 AND user_id = $2`, response.AssignmentID, currentUser.ID); err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}
	question := new(Question)
	if err := meddler.QueryRow(tx, question, `SELECT questions.* `+
		`FROM questions JOIN quizzes ON questions.quiz_id = quizzes.id `+
		`WHERE questions.id = $1 AND quizzes.lti_id = $2`, response.QuestionID, assignment.LtiID); err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	// responses cannot be submitted after the response window
	// or if the question has not been opened
	if question.ClosedAt == nil || question.IsClosed() {
		loggedHTTPErrorf(w, http.StatusBadRequest, "the question is not open for responses")
		return
	}

	// merge with previous response if it exists
	old := new(Response)
	if err := meddler.QueryRow(tx, old, `SELECT * FROM responses `+
		`WHERE assignment_id = $1 AND question_id = $2`, response.AssignmentID, response.QuestionID); err != nil {
		if err != sql.ErrNoRows {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
			return
		}
	} else {
		// updated response
		response.ID = old.ID
		response.CreatedAt = old.CreatedAt
	}

	if err := meddler.Save(tx, "responses", &response); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	render.JSON(http.StatusOK, &response)
}

type ResponseWithName struct {
	ID           int64     `json:"id" meddler:"id"`
	AssignmentID int64     `json:"assignmentID" meddler:"assignment_id"`
	QuestionID   int64     `json:"questionID" meddler:"question_id"`
	Response     string    `json:"response" meddler:"response"`
	Name         string    `json:"name" meddler:"name"`
	CreatedAt    time.Time `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt    time.Time `json:"updatedAt" meddler:"updated_at,localtime"`
}

func GetQuestionResponses(w http.ResponseWriter, tx *sql.Tx, params martini.Params, currentUser *User, render render.Render) {
	questionID, err := parseID(w, "question_id", params["question_id"])
	if err != nil {
		return
	}

	// make sure this is the instructor
	var junk int
	if err = tx.QueryRow(`SELECT 1 `+
		`FROM questions JOIN quizzes ON questions.quiz_id = quizzes.id `+
		`JOIN assignments ON assignments.lti_id = quizzes.lti_id `+
		`WHERE questions.id = $1 AND assignments.user_id = $2 AND assignments.instructor`, questionID, currentUser.ID).Scan(&junk); err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	responses := []*ResponseWithName{}
	err = meddler.QueryAll(tx, &responses, `SELECT responses.*, users.name `+
		`FROM responses JOIN assignments ON responses.assignment_id = assignments.id `+
		`JOIN users ON users.id = assignments.user_id `+
		`WHERE responses.question_id = $1`, questionID)
	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	render.JSON(http.StatusOK, responses)
}

func DeleteQuestion(w http.ResponseWriter, tx *sql.Tx, currentUser *User, params martini.Params) {
	questionID, err := parseID(w, "question_id", params["question_id"])
	if err != nil {
		return
	}

	quiz := new(Quiz)
	if err = meddler.QueryRow(tx, quiz, `SELECT quizzes.* `+
		`FROM quizzes JOIN questions ON quizzes.id = questions.quiz_id `+
		`WHERE questions.id = $1`, questionID); err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}

	assignment := new(Assignment)
	if err = meddler.QueryRow(tx, assignment, `SELECT * `+
		`FROM assignments `+
		`WHERE lti_id = $1 AND user_id = $2`, quiz.LtiID, currentUser.ID); err != nil {
		loggedHTTPDBNotFoundError(w, err)
		return
	}
	if !assignment.Instructor {
		loggedHTTPErrorf(w, http.StatusUnauthorized, "only the instructor can delete a question")
		return
	}

	_, err = tx.Exec(`DELETE FROM questions WHERE id = $1`, questionID)
	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}

	// re-number the remaining questions
	questions := []*Question{}
	if err = meddler.QueryAll(tx, &questions, `SELECT * FROM questions `+
		`WHERE quiz_id = $1 ORDER BY question_number`, quiz.ID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
	for i, question := range questions {
		n := int64(i + 1)
		if question.Number != n {
			question.Number = n
			if err := meddler.Save(tx, "questions", question); err != nil {
				loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
				return
			}
		}
	}

	if _, err := tx.Exec(`UPDATE quizzes SET is_graded = $1 WHERE id = $2 AND is_graded`, false, quiz.ID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		return
	}
}

func gradeResponse(question *Question, response *Response) float64 {
	// TODO: response needs to be filtered
	// to allow case-insensitive matches, etc.
	actual, possible := 0.0, 0.0
	for _, answer := range question.Answers {
		if answer.Points > possible {
			possible = answer.Points
		}
		if response.Response == answer.Answer {
			actual = answer.Points
		}
	}
	actual += question.PointsForAttempt
	possible += question.PointsForAttempt

	if possible > 0.0 {
		actual = actual / possible
	}

	return actual
}

// GradeQuiz fills in the raw scores for an entire quiz.
// It adjusts scores for participation points, but does not apply weights.
// The scores are recorded in the Assignment RawScores field, suitable for
// final processing by ComputeScore
func gradeQuiz(assignment *Assignment, quiz *Quiz, questions []*Question, responses []*Response) {
	quizKey := strconv.FormatInt(quiz.ID, 10)
	assignment.RawScores[quizKey] = nil

	if len(questions) == 0 {
		return
	}

	responsePercent := float64(len(responses)) / float64(len(questions))
	participationPoints := 0.0
	if responsePercent >= quiz.ParticipationThreshold {
		participationPoints = quiz.ParticipationPercent
	}

	questionToResponse := make(map[int64]*Response)
	for _, response := range responses {
		questionToResponse[response.QuestionID] = response
	}

	for _, question := range questions {
		points := participationPoints
		if response, exists := questionToResponse[question.ID]; exists {
			earned := gradeResponse(question, response)
			points += earned * (1.0 - quiz.ParticipationPercent)
		}
		assignment.SetMinorScore(quizKey, int(question.Number)-1, points)
	}
}

func gradeQuizClass(now time.Time, tx *sql.Tx, quizID int64) error {
	// get the quiz
	quiz := new(Quiz)
	if err := meddler.Load(tx, "quizzes", quiz, quizID); err != nil {
		return err
	}

	// get the questions
	questions := []*Question{}
	if err := meddler.QueryAll(tx, &questions, `SELECT * FROM questions `+
		`WHERE quiz_id = $1 `+
		`ORDER BY question_number`, quizID); err != nil {
		return err
	}

	// get the assignments
	assignments := []*Assignment{}
	if err := meddler.QueryAll(tx, &assignments, `SELECT * FROM assignments `+
		`WHERE lti_id = $1 `+
		`ORDER BY id`, quiz.LtiID); err != nil {
		return err
	}

	// get the responses
	responses := []*Response{}
	if err := meddler.QueryAll(tx, &responses, `SELECT responses.* `+
		`FROM responses JOIN questions ON responses.question_id = questions.id `+
		`WHERE questions.quiz_id = $1 `+
		`ORDER BY responses.assignment_id`, quizID); err != nil {
		return err
	}

	// get the grading weights
	majorWeights, minorWeights, err := GetQuizWeights(tx, quiz.LtiID)
	if err != nil {
		return err
	}

	// grade by assignment
	messages := make(map[*Assignment]string)

	index := 0
	for _, assignment := range assignments {
		// find the first response for this assignment
		for index < len(responses) && responses[index].AssignmentID < assignment.ID {
			index++
		}

		end := index
		for end < len(responses) && responses[end].AssignmentID == assignment.ID {
			end++
		}

		// grade this quiz
		gradeQuiz(assignment, quiz, questions, responses[index:end])

		// compute the overall assignment grade
		score, err := assignment.ComputeScore(majorWeights, minorWeights)
		if err != nil {
			return err
		}
		assignment.Score = score
		assignment.UpdatedAt = now

		// save the assignment
		if err = meddler.Save(tx, "assignments", assignment); err != nil {
			return err
		}

		// post grade to LMS using LTI
		var report bytes.Buffer

		// TODO: write out a quiz grade report to post to the LMS
		messages[assignment] = report.String()

		index = end
	}

	// send grade to the LMS in a goroutine
	// so we can wrap up the transaction and return to the user
	go func() {
		start := time.Now()
	OUTER:
		for _, asst := range assignments {
			msg := messages[asst]

			// try up to 10 times before giving up
			tries := 10
			minSleepTime := 10 * time.Second
			maxSleepTime := 5 * time.Minute
			sleepTime := minSleepTime
			for i := 0; i < tries; i++ {
				err := saveGrade(asst, msg)
				if err == nil {
					continue OUTER
				}
				log.Printf("error posting grade back to LMS (attempt %d/%d): %v", i+1, tries, err)
				if i+1 < 10 {
					log.Printf("  will try again in %v", sleepTime)
					time.Sleep(sleepTime)
					sleepTime *= 2
					if sleepTime > maxSleepTime {
						sleepTime = maxSleepTime
					}
				} else {
					log.Printf("  giving up")
				}
			}
		}
		log.Printf("posted %d grades to the LMS in %v", len(assignments), time.Since(start))
	}()

	return nil
}

func GetQuizWeights(tx *sql.Tx, ltiID string) (majorWeights map[string]float64, minorWeights map[string][]float64, err error) {
	weights := []*StepWeight{}
	if err := meddler.QueryAll(tx, &weights, `SELECT quizzes.id::text AS major_key, quizzes.weight AS major_weight, questions.question_number AS minor_key, questions.weight AS minor_weight `+
		`FROM quizzes JOIN questions ON quizzes.id = questions.quiz_id `+
		`WHERE quizzes.lti_id = $1 `+
		`ORDER BY quizzes.id, questions.question_number`, ltiID); err != nil {
		return nil, nil, fmt.Errorf("db error: %v", err)
	}
	if len(weights) == 0 {
		return nil, nil, fmt.Errorf("no quiz question weights found, unable to compute score")
	}
	majorWeights = make(map[string]float64)
	minorWeights = make(map[string][]float64)
	for _, elt := range weights {
		majorWeights[elt.MajorKey] = elt.MajorWeight
		minorWeights[elt.MajorKey] = append(minorWeights[elt.MajorKey], elt.MinorWeight)
		if len(minorWeights[elt.MajorKey]) != int(elt.MinorKey) {
			return nil, nil, fmt.Errorf("question weights do not line up when computing score")
		}
	}
	return majorWeights, minorWeights, nil
}
