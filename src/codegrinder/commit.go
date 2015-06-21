package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-martini/martini"
	"github.com/martini-contrib/render"
	"github.com/russross/meddler"
)

const (
	transcriptEventCountLimit = 500
	transcriptDataLimit       = 1e5
	openCommitTimeout         = 20 * time.Minute
)

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

func (commit *Commit) computeSignature(secret string) string {
	v := make(url.Values)

	// gather all relevant fields
	v.Add("assignmentID", strconv.Itoa(commit.AssignmentID))
	v.Add("problemStepNumber", strconv.Itoa(commit.ProblemStepNumber))
	v.Add("userID", strconv.Itoa(commit.UserID))
	v.Add("closed", strconv.FormatBool(commit.Closed))
	v.Add("action", commit.Action)
	v.Add("comment", commit.Comment)
	for name, contents := range commit.Files {
		v.Add(fmt.Sprintf("file-%s", name), contents)
	}
	// TODO: transcript
	// TODO: reportcard
	v.Add("score", strconv.FormatFloat(commit.Score, 'g', -1, 64))
	v.Add("createdAt", commit.CreatedAt.UTC().Format(time.RFC3339Nano))
	v.Add("updatedAt", commit.UpdatedAt.UTC().Format(time.RFC3339Nano))
	v.Add("problemSignature", commit.ProblemSignature)
	if commit.Timestamp != nil {
		v.Add("timestamp", commit.Timestamp.UTC().Format(time.RFC3339Nano))
	}

	// compute signature
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(encode(v)))
	sum := mac.Sum(nil)
	return base64.StdEncoding.EncodeToString(sum)
}

func (commit *Commit) normalize(now time.Time) error {
	// ID, AssignmentID, ProblemStepNumber, and UserID are all checked elsewhere
	commit.Action = strings.TrimSpace(commit.Action)
	commit.Comment = strings.TrimSpace(commit.Comment)
	commit.filterIncoming()
	commit.compress()
	if commit.Score < 0.0 || commit.Score > 1.0 {
		return fmt.Errorf("commit score must be between 0 and 1")
	}
	if commit.CreatedAt.Before(beginningOfTime) || commit.CreatedAt.After(now) {
		return fmt.Errorf("commit CreatedAt time of %v is invalid", commit.CreatedAt)
	}
	if commit.UpdatedAt.Before(beginningOfTime) || commit.UpdatedAt.After(now) {
		return fmt.Errorf("commit UpdatedAt time of %v is invalid", commit.UpdatedAt)
	}

	return nil
}

// filter out files in subdirectories, and clean up line endings
func (commit *Commit) filterIncoming() {
	clean := make(map[string]string)
	for name, contents := range commit.Files {
		// remove any files in subdirectories
		if len(strings.Split(name, "/")) == 1 {
			// normalize line endings
			clean[name] = fixLineEndings(contents)
		}
	}
	commit.Files = clean
}

// filter out files with underscore prefix
func (commit *Commit) filterOutgoing() {
	clean := make(map[string]string)
	for name, contents := range commit.Files {
		if !strings.HasPrefix(name, "_") {
			clean[name] = contents
		}
	}
	commit.Files = clean
}

// compress merges adjacent Transcript events of the same type.
// it also truncates the total stdin, stdout, stderr data to a fixed limit
// and sets a maximum number of events
func (commit *Commit) compress() {
	count := 0
	overflow := 0
	out := []*EventMessage{}
	for _, elt := range commit.Transcript {
		if len(out) > 0 {
			prev := out[len(out)-1]
			if elt.Event == "stdin" || elt.Event == "stdout" || elt.Event == "stderr" {
				if count >= transcriptDataLimit {
					overflow += len(elt.StreamData)
					continue
				}
				count += len(elt.StreamData)
				if prev.Event == elt.Event {
					prev.StreamData += elt.StreamData
					prev.When = elt.When
					continue
				}
			}
		}
		out = append(out, elt)
	}

	if overflow > 0 {
		logi.Printf("transcript compressed from %d to %d events, %d bytes discarded", len(commit.Transcript), len(out), overflow)
	} else {
		logi.Printf("transcript compressed from %d to %d events", len(commit.Transcript), len(out))
	}
	if len(out) > transcriptEventCountLimit {
		logi.Printf("transcript truncated from %d to %d events", len(out), transcriptEventCountLimit)
		out = out[:transcriptEventCountLimit]
	}

	commit.Transcript = out
}

// GetUserMeAssignmentCommits handles requests to /api/v2/users/me/assignments/:assignment_id/commits,
// returning a list of commits for the given assignment for the current user.
func GetUserMeAssignmentCommits(w http.ResponseWriter, tx *sql.Tx, currentUser *User, params martini.Params, render render.Render) {
	assignmentID, err := strconv.Atoi(params["assignment_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	commits := []*Commit{}
	if err := meddler.QueryAll(tx, &commits, `SELECT * FROM commits WHERE user_id = $1 AND assignment_id = $2 ORDER BY created_at`, currentUser.ID, assignmentID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error getting commits for user %d and assignment %d: %v", currentUser.ID, assignmentID, err)
		return
	}
	render.JSON(http.StatusOK, commits)
}

// GetUserMeAssignmentCommitLast handles requests to /api/v2/users/me/assignments/:assignment_id/commits/last,
// returning the most recent commit for the given assignment for the current user.
func GetUserMeAssignmentCommitLast(w http.ResponseWriter, tx *sql.Tx, currentUser *User, params martini.Params, render render.Render) {
	assignmentID, err := strconv.Atoi(params["assignment_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	commit := new(Commit)
	if err := meddler.QueryRow(tx, commit, `SELECT * FROM commits WHERE user_id = $1 AND assignment_id = $2 ORDER BY created_at DESC LIMIT 1`, currentUser.ID, assignmentID); err != nil {
		if err == sql.ErrNoRows {
			loggedHTTPErrorf(w, http.StatusNotFound, "no commit found for user %d and assignment %d", currentUser.ID, assignmentID)
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error loading most recent commit for user %d and assignment %d: %v", currentUser.ID, assignmentID, err)
		}
		return
	}
	render.JSON(http.StatusOK, commit)
}

// GetUserMeAssignmentCommit handles requests to /api/v2/users/me/assignments/:assignment_id/commits/:commit_id,
// returning the given commit for the given assignment for the current user.
func GetUserMeAssignmentCommit(w http.ResponseWriter, tx *sql.Tx, currentUser *User, params martini.Params, render render.Render) {
	assignmentID, err := strconv.Atoi(params["assignment_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	commitID, err := strconv.Atoi(params["commit_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing commit_id from URL: %v", err)
		return
	}

	commit := new(Commit)
	if err := meddler.QueryRow(tx, commit, `SELECT * FROM commits WHERE id = $1 AND user_id = $2 AND assignment_id = $3`, commitID, currentUser.ID, assignmentID); err != nil {
		if err == sql.ErrNoRows {
			loggedHTTPErrorf(w, http.StatusNotFound, "no commit %d found for user %d and assignment %d", commitID, currentUser.ID, assignmentID)
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error loading commit %d for user %d and assignment %d: %v", commitID, currentUser.ID, assignmentID, err)
		}
		return
	}
	render.JSON(http.StatusOK, commit)
}

// GetUserAssignmentCommits handles requests to /api/v2/users/:user_id/assignments/:assignment_id/commits,
// returning a list of commits for the given assignment for the given user.
func GetUserAssignmentCommits(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	userID, err := strconv.Atoi(params["user_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	assignmentID, err := strconv.Atoi(params["assignment_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	commits := []*Commit{}
	if err := meddler.QueryAll(tx, &commits, `SELECT * FROM commits WHERE user_id = $1 AND assignment_id = $2 ORDER BY created_at`, userID, assignmentID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error getting commits for user %d and assignment %d: %v", userID, assignmentID, err)
		return
	}
	render.JSON(http.StatusOK, commits)
}

// GetUserAssignmentCommitLast handles requests to /api/v2/users/:user_id/assignments/:assignment_id/commits/last,
// returning the most recent commit for the given assignment for the given user.
func GetUserAssignmentCommitLast(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	userID, err := strconv.Atoi(params["user_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	assignmentID, err := strconv.Atoi(params["assignment_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	commit := new(Commit)
	if err := meddler.QueryRow(tx, commit, `SELECT * FROM commits WHERE user_id = $1 AND assignment_id = $2 ORDER BY created_at DESC LIMIT 1`, userID, assignmentID); err != nil {
		if err == sql.ErrNoRows {
			loggedHTTPErrorf(w, http.StatusNotFound, "no commit found for user %d and assignment %d", userID, assignmentID)
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error loading most recent commit for user %d and assignment %d: %v", userID, assignmentID, err)
		}
		return
	}
	render.JSON(http.StatusOK, commit)
}

// GetUserAssignmentCommit handles requests to /api/v2/users/me/assignments/:assignment_id/commits/:commit_id,
// returning the given commit for the given assignment for the given user.
func GetUserAssignmentCommit(w http.ResponseWriter, tx *sql.Tx, params martini.Params, render render.Render) {
	userID, err := strconv.Atoi(params["user_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	assignmentID, err := strconv.Atoi(params["assignment_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	commitID, err := strconv.Atoi(params["commit_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing commit_id from URL: %v", err)
		return
	}

	commit := new(Commit)
	if err := meddler.QueryRow(tx, commit, `SELECT * FROM commits WHERE id = $1 AND user_id = $2 AND assignment_id = $3`, commitID, userID, assignmentID); err != nil {
		if err == sql.ErrNoRows {
			loggedHTTPErrorf(w, http.StatusNotFound, "no commit %d found for user %d and assignment %d", commitID, userID, assignmentID)
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error loading commit %d for user %d and assignment %d: %v", commitID, userID, assignmentID, err)
		}
		return
	}
	render.JSON(http.StatusOK, commit)
}

// DeleteUserAssignmentCommits handles requests to /api/v2/users/:user_id/assignments/:assignment_id/commits,
// deleting all commits for the given assignment for the given user.
func DeleteUserAssignmentCommits(w http.ResponseWriter, tx *sql.Tx, params martini.Params) {
	userID, err := strconv.Atoi(params["user_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	assignmentID, err := strconv.Atoi(params["assignment_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	if _, err := tx.Exec(`DELETE FROM commits WHERE user_id = $1 AND assignment_id = $2`, userID, assignmentID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error deleting commits for assignment %d for user %d: %v", assignmentID, userID, err)
		return
	}
}

// DeleteUserAssignmentCommit handles requests to /api/v2/users/:user_id/assignments/:assignment_id/commits/:commit_id,
// deleting the given commits for the given assignment for the given user.
func DeleteUserAssignmentCommit(w http.ResponseWriter, tx *sql.Tx, params martini.Params) {
	userID, err := strconv.Atoi(params["user_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	assignmentID, err := strconv.Atoi(params["assignment_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	commitID, err := strconv.Atoi(params["commit_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing commit_id from URL: %v", err)
		return
	}

	if _, err = tx.Exec(`DELETE FROM commits WHERE id = $1 AND user_id = $2 AND assignment_id = $3`, commitID, userID, assignmentID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error deleting commit %d for assignment %d for user %d: %v", commitID, assignmentID, userID, err)
		return
	}
}

// PostUserAssignmentCommit handles requests to /api/v2/users/me/assignments/:assignment_id/commits,
// adding a new commit (or updating the most recent one) for the given assignment for the current user.
func PostUserAssignmentCommit(w http.ResponseWriter, tx *sql.Tx, currentUser *User, params martini.Params, commit Commit, render render.Render) {
	now := time.Now()

	assignmentID, err := strconv.Atoi(params["assignment_id"])
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing assignment_id from URL: %v", err)
		return
	}

	assignment := new(Assignment)
	if err = meddler.QueryRow(tx, assignment, `SELECT * FROM assignments WHERE id = $1 AND user_id = $2`, assignmentID, currentUser.ID); err != nil {
		if err == sql.ErrNoRows {
			loggedHTTPErrorf(w, http.StatusNotFound, "no assignment %d found for user %d", assignmentID, currentUser.ID)
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error loading assignment %d for user %d: %v", assignmentID, currentUser.ID, err)
		}
		return
	}

	// TODO: validate commit
	if len(commit.Files) == 0 {
		loggedHTTPErrorf(w, http.StatusBadRequest, "commit does not contain any submission files")
		return
	}

	openCommit := new(Commit)
	if err = meddler.QueryRow(tx, openCommit, `SELECT * FROM commits WHERE NOT closed AND assignment_id = $1 LIMIT 1`, assignmentID); err != nil {
		if err == sql.ErrNoRows {
			openCommit = nil
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error loading open commit for assignment %d for user %d: %v", assignmentID, currentUser.ID, err)
			return
		}
	}

	// close the old commit?
	if openCommit != nil && (now.Sub(openCommit.UpdatedAt) > openCommitTimeout || openCommit.ProblemStepNumber != commit.ProblemStepNumber) {
		openCommit.Closed = true
		openCommit.UpdatedAt = now
		if err := meddler.Update(tx, "commits", openCommit); err != nil {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error closing old commit %d: %v", openCommit.ID, err)
			return
		}
		logi.Printf("closed old commit %d due to timeout/wrong step number", openCommit.ID)
		openCommit = nil
	}

	// update an existing commit?
	if openCommit != nil {
		commit.ID = openCommit.ID
		commit.CreatedAt = openCommit.CreatedAt
	} else {
		commit.ID = 0
		commit.CreatedAt = now
	}
	commit.AssignmentID = assignmentID
	commit.UserID = currentUser.ID
	if commit.ReportCard != nil || len(commit.Transcript) > 0 {
		commit.Closed = true
	}
	commit.UpdatedAt = now

	// TODO: sign the commit for execution

	if err := meddler.Save(tx, "commits", &commit); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error saving commit: %v", err)
		return
	}

	render.JSON(http.StatusOK, &commit)
}
