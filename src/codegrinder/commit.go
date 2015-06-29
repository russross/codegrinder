package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"path/filepath"
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
	signedCommitTimeout       = 15 * time.Minute
)

// Commit defines an attempt at solving one step of a Problem.
// A few special cases:
//
// * When creating a problem, include a full set of Commit objects, one for
//   each step in the problem, when getting it signed in its unconfirmed state.
//   Set ID=0, AssignmentID=0, Action="confirm".
// * Submit one Commit at a time to the daycare for validation. The daycare
//   will return it signed with a ReportCard and Transcript.
// * Include the full set of successful Commits when submitting the Problem to
//   be saved and made available for use.
//
// * When saving a commit, set Action="", Transcript=nil, ReportCard=nil,
//   Score=0.0 to save only.
// * For all other Actions, submit and save the Commit, and it will be signed
//   with the ProblemSignature of the corresponding problem.
// * Note: check to make sure the problem you are submitting with the commit
//   has a matching signature. If not, go back and fetch the latest version of
//   the problem before submitting to the daycare.
// * Use this signed version of the commit and the problem itself to submit to
//   the daycare for validation.
// * The daycare will be return a new version of the Commit with Transcript,
//   ReportCard, and Score filled in and a fresh signature and timestamp.
// * Submit this signed Commit to save it and record the grade.
//
// Note: ProblemStepNumber is zero based. Always present to user using
// ProblemStepNumber+1
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

func (commit *Commit) normalize(now time.Time, whitelist map[string]bool) error {
	// ID, AssignmentID, ProblemStepNumber, and UserID are all checked elsewhere
	commit.Action = strings.TrimSpace(commit.Action)
	commit.Comment = strings.TrimSpace(commit.Comment)
	commit.filterIncoming(whitelist)
	if len(commit.Files) == 0 {
		return fmt.Errorf("commit must have at least one file")
	}
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

// filter out files in subdirectories/not on whitelist, and clean up line endings
func (commit *Commit) filterIncoming(whitelist map[string]bool) {
	clean := make(map[string]string)
	for name, contents := range commit.Files {
		// normalize line endings
		if whitelist == nil {
			// only keep files not in a subdirectory
			if len(filepath.SplitList(name)) == 1 {
				clean[name] = fixLineEndings(contents)
			} else {
				logi.Printf("filtered out %s, which is in a subdirectory", name)
			}
		} else {
			// only keep files on the whitelist
			if whitelist[name] {
				clean[name] = fixLineEndings(contents)
			} else {
				logi.Printf("filtered out %s, which is not on the problem step whitelist", name)
			}
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
					prev.Time = elt.Time
					continue
				}
			}
		}
		out = append(out, elt)
	}

	if overflow > 0 {
		logi.Printf("transcript compressed from %d to %d events, %d bytes discarded", len(commit.Transcript), len(out), overflow)
	} else if len(commit.Transcript) != len(out) {
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

	// get the assignment and make sure it is for this user
	assignment := new(Assignment)
	if err = meddler.QueryRow(tx, assignment, `SELECT * FROM assignments WHERE id = $1 AND user_id = $2`, assignmentID, currentUser.ID); err != nil {
		if err == sql.ErrNoRows {
			loggedHTTPErrorf(w, http.StatusNotFound, "no assignment %d found for user %d", assignmentID, currentUser.ID)
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error loading assignment %d for user %d: %v", assignmentID, currentUser.ID, err)
		}
		return
	}

	// get the problem
	problem := new(Problem)
	if err = meddler.QueryRow(tx, problem, `SELECT problems.* FROM problems join assignments on problems.ID = assignments.ProblemID WHERE assignments.ID = $1 LIMIT 1`, assignmentID); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error loading problem: %v", err)
		return
	}

	// validate commit
	if commit.ProblemStepNumber >= len(problem.Steps) {
		loggedHTTPErrorf(w, http.StatusBadRequest, "commit has step number %d, but there are only %d steps in the problem", commit.ProblemStepNumber+1, len(problem.Steps))
		return
	}
	whitelists := getStepWhitelists(problem)
	if err = commit.normalize(now, whitelists[commit.ProblemStepNumber]); err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "%v", err)
		return
	}

	// is this a signed commit from the daycare?
	if commit.Action != "" && commit.Signature != "" && commit.Timestamp != nil && commit.ReportCard != nil && len(commit.Transcript) > 0 {
		// validate the signature
		if commit.ProblemSignature != problem.Signature {
			loggedHTTPErrorf(w, http.StatusBadRequest, "problem signature for this commit does not match the current problem signature; please update the problem and re-run the test")
			return
		}
		age := now.Sub(*commit.Timestamp)
		if age < 0 {
			age = -age
		}
		if age > signedCommitTimeout {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit signature has expired")
			return
		}
		if commit.computeSignature(Config.DaycareSecret) != commit.Signature {
			loggedHTTPErrorf(w, http.StatusBadRequest, "commit signature is incorrect")
			return
		}

		// post grade to LMS using LTI
		if err := saveGrade(tx, &commit, assignment, currentUser); err != nil {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "error posting grade back to LMS: %v", err)
			return
		}
	}

	openCommit := new(Commit)
	if err = meddler.QueryRow(tx, openCommit, `SELECT * FROM commits WHERE assignment_id = $1 AND problem_step_number = $2 AND action IS NULL AND updated_at > $3 LIMIT 1`, assignmentID, commit.ProblemStepNumber, now.Add(-openCommitTimeout)); err != nil {
		if err == sql.ErrNoRows {
			openCommit = nil
		} else {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "db error loading open commit for assignment %d for user %d: %v", assignmentID, currentUser.ID, err)
			return
		}
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
	commit.UpdatedAt = now

	// sign the commit for execution
	if commit.Action != "" && commit.Signature == "" && commit.Timestamp == nil && commit.ReportCard == nil && len(commit.Transcript) == 0 {
		commit.ProblemSignature = problem.Signature
		commit.Timestamp = &now
		commit.Signature = commit.computeSignature(Config.DaycareSecret)
	}

	if err := meddler.Save(tx, "commits", &commit); err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "db error saving commit: %v", err)
		return
	}

	render.JSON(http.StatusOK, &commit)
}
