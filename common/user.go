package common

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net/url"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	TranscriptEventCountLimit = 500
	TranscriptDataLimit       = 1e5
	OpenCommitTimeout         = 6 * time.Hour
	SignedCommitTimeout       = 15 * time.Minute
	CookieName                = "codegrinder"
)

// Course represents a single instance of a course as defined by LTI.
type Course struct {
	ID        int64     `json:"id" meddler:"id,pk"`
	Name      string    `json:"name" meddler:"name"`
	Label     string    `json:"label" meddler:"lti_label"`
	LtiID     string    `json:"ltiID" meddler:"lti_id"`
	CanvasID  int64     `json:"canvasID" meddler:"canvas_id"`
	CreatedAt time.Time `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt time.Time `json:"updatedAt" meddler:"updated_at,localtime"`
}

// User represents a single user as defined by LTI.
type User struct {
	ID             int64     `json:"id" meddler:"id,pk"`
	Name           string    `json:"name" meddler:"name"`
	Email          string    `json:"email" meddler:"email"`
	LtiID          string    `json:"ltiID" meddler:"lti_id"`
	ImageURL       string    `json:"imageURL" meddler:"lti_image_url"`
	CanvasLogin    string    `json:"canvasLogin" meddler:"canvas_login"`
	CanvasID       int64     `json:"canvasID" meddler:"canvas_id"`
	Author         bool      `json:"author" meddler:"author"`
	Admin          bool      `json:"admin" meddler:"admin"`
	CreatedAt      time.Time `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt      time.Time `json:"updatedAt" meddler:"updated_at,localtime"`
	LastSignedInAt time.Time `json:"lastSignedInAt" meddler:"last_signed_in_at,localtime"`
}

// Assignment represents a single instance of a problem set for a student in a course.
// Many commits (attempts to solve a step of a problem in the set) are linked to an assignment.
type Assignment struct {
	ID                 int64                `json:"id" meddler:"id,pk"`
	CourseID           int64                `json:"courseID" meddler:"course_id"`
	ProblemSetID       int64                `json:"problemSetID" meddler:"problem_set_id,zeroisnull"`
	UserID             int64                `json:"userID" meddler:"user_id"`
	Roles              string               `json:"roles" meddler:"roles"`
	Instructor         bool                 `json:"instructor" meddler:"instructor"`
	RawScores          map[string][]float64 `json:"raw_scores" meddler:"raw_scores,json"`
	Score              float64              `json:"score" meddler:"score,zeroisnull"`
	GradeID            string               `json:"-" meddler:"grade_id,zeroisnull"`
	LtiID              string               `json:"-" meddler:"lti_id"`
	CanvasTitle        string               `json:"canvasTitle" meddler:"canvas_title"`
	CanvasID           int64                `json:"canvasID" meddler:"canvas_id"`
	CanvasAPIDomain    string               `json:"canvasAPIDomain" meddler:"canvas_api_domain"`
	OutcomeURL         string               `json:"-" meddler:"outcome_url"`
	OutcomeExtURL      string               `json:"-" meddler:"outcome_ext_url"`
	OutcomeExtAccepted string               `json:"-" meddler:"outcome_ext_accepted"`
	FinishedURL        string               `json:"finishedURL" meddler:"finished_url"`
	ConsumerKey        string               `json:"-" meddler:"consumer_key"`
	CreatedAt          time.Time            `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt          time.Time            `json:"updatedAt" meddler:"updated_at,localtime"`
}

// Commit defines an attempt at solving one step of a Problem.
type Commit struct {
	ID           int64             `json:"id" meddler:"id,pk"`
	AssignmentID int64             `json:"assignmentID" meddler:"assignment_id"`
	ProblemID    int64             `json:"problemID" meddler:"problem_id"`
	Step         int64             `json:"step" meddler:"step"` // note: one-based
	Action       string            `json:"action" meddler:"action,zeroisnull"`
	Note         string            `json:"note" meddler:"note,zeroisnull"`
	Files        map[string][]byte `json:"files" meddler:"files,json"`
	Transcript   []*EventMessage   `json:"transcript,omitempty" meddler:"transcript,json"`
	ReportCard   *ReportCard       `json:"reportCard" meddler:"report_card,json"`
	Score        float64           `json:"score" meddler:"score,zeroisnull"`
	CreatedAt    time.Time         `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt    time.Time         `json:"updatedAt" meddler:"updated_at,localtime"`
}

// isInstructorRole returns true if the given LTI Roles field indicates this
// user is an instructor for a specific course.
func (asst *Assignment) IsInstructorRole() bool {
	for _, role := range strings.Split(asst.Roles, ",") {
		if role == "Instructor" {
			return true
		}
	}
	return false
}

func (assignment *Assignment) SetMinorScore(major string, minor int, score float64) {
	// save the raw score
	scores := assignment.RawScores[major]
	for minor >= len(scores) {
		scores = append(scores, 0.0)
	}
	scores[minor] = score
	assignment.RawScores[major] = scores
}

func (assignment *Assignment) ComputeScore(majorWeights map[string]float64, minorWeights map[string][]float64) (float64, error) {
	// compute an overall score
	majorWeightSum, majorScoreSum := 0.0, 0.0
	for unique, majorWeight := range majorWeights {
		scores := assignment.RawScores[unique]
		minorWeightSum, minorScoreSum := 0.0, 0.0
		for i, minorWeight := range minorWeights[unique] {
			minorWeightSum += minorWeight
			if i < len(scores) {
				minorScoreSum += scores[i] * minorWeight
			}
		}
		if minorWeightSum == 0.0 {
			// no questions/steps, so just skip this group
			continue
		}
		majorWeightSum += majorWeight
		minorScoreSum /= minorWeightSum
		majorScoreSum += minorScoreSum * majorWeight
	}
	if majorWeightSum == 0.0 {
		// nothing available to grade, probably empty quizzes
		return 0.0, nil
	}
	return majorScoreSum / majorWeightSum, nil
}

func (commit *Commit) ComputeSignature(secret, problemTypeSignature, problemSignature, daycareHost string, userID int64) string {
	v := make(url.Values)

	// gather all relevant fields
	v.Add("id", strconv.FormatInt(commit.ID, 10))
	v.Add("assignment_id", strconv.FormatInt(commit.AssignmentID, 10))
	v.Add("problem_id", strconv.FormatInt(commit.ProblemID, 10))
	v.Add("step", strconv.FormatInt(commit.Step, 10))
	v.Add("action", commit.Action)
	v.Add("note", commit.Note)
	for name, contents := range commit.Files {
		v.Add(fmt.Sprintf("file-%s", name), string(contents))
	}
	for n, event := range commit.Transcript {
		v.Add(fmt.Sprintf("transcript-%d", n), event.String())
	}
	if commit.ReportCard != nil {
		v.Add("reportcard-passed", strconv.FormatBool(commit.ReportCard.Passed))
		v.Add("reportcard-note", commit.ReportCard.Note)
		v.Add("reportcard-duration", commit.ReportCard.Duration.String())
		for n, result := range commit.ReportCard.Results {
			v.Add(fmt.Sprintf("reportcard-%d-name", n), result.Name)
			v.Add(fmt.Sprintf("reportcard-%d-outcome", n), result.Outcome)
			if result.Details != "" {
				v.Add(fmt.Sprintf("reportcard-%d-details", n), result.Details)
			}
			if result.Context != "" {
				v.Add(fmt.Sprintf("reportcard-%d-context", n), result.Context)
			}
		}
	}
	v.Add("score", strconv.FormatFloat(commit.Score, 'g', -1, 64))
	v.Add("created_at", commit.CreatedAt.Round(time.Second).UTC().Format(time.RFC3339))
	v.Add("updated_at", commit.UpdatedAt.Round(time.Second).UTC().Format(time.RFC3339))
	v.Add("problem_type_signature", problemTypeSignature)
	v.Add("problem_signature", problemSignature)
	v.Add("daycare_host", daycareHost)
	v.Add("user_id", strconv.FormatInt(userID, 10))

	// compute signature
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(encode(v))
	sum := mac.Sum(nil)
	sig := base64.StdEncoding.EncodeToString(sum)
	//log.Printf("commit signature: %s data: %s", sig, encode(v))
	return sig
}

func (commit *Commit) Normalize(now time.Time, whitelist map[string]bool) error {
	// ID, AssignmentID, Step, and UserID are all checked elsewhere
	commit.Action = strings.TrimSpace(commit.Action)
	commit.Note = strings.TrimSpace(commit.Note)
	commit.FilterIncoming(whitelist)
	if len(commit.Files) == 0 {
		return fmt.Errorf("commit must have at least one file")
	}
	if commit.Score < 0.0 || commit.Score > 1.0 {
		return fmt.Errorf("commit score must be between 0 and 1")
	}
	if commit.CreatedAt.Before(BeginningOfTime) || commit.CreatedAt.After(now) {
		return fmt.Errorf("commit CreatedAt time of %v is invalid", commit.CreatedAt)
	}
	if commit.UpdatedAt.Before(BeginningOfTime) || commit.UpdatedAt.After(now) {
		return fmt.Errorf("commit UpdatedAt time of %v is invalid", commit.UpdatedAt)
	}

	return nil
}

// filter out files in subdirectories/not on whitelist, and clean up line endings
func (commit *Commit) FilterIncoming(whitelist map[string]bool) {
	clean := make(map[string][]byte)
	for name, contents := range commit.Files {
		// normalize line endings
		if whitelist == nil {
			// only keep files not in a subdirectory
			if len(filepath.SplitList(name)) == 1 {
				clean[name] = fixLineEndings(contents)
			} else {
				log.Printf("filtered out %s, which is in a subdirectory", name)
			}
		} else {
			// only keep files on the whitelist
			if whitelist[name] {
				clean[name] = fixLineEndings(contents)
			} else {
				log.Printf("filtered out %s, which is not on the problem step whitelist", name)
			}
		}
	}
	commit.Files = clean
}

func (commit *Commit) DumpTranscript(w io.Writer) error {
	for _, elt := range commit.Transcript {
		if _, err := fmt.Fprintf(w, "%s", elt.Dump()); err != nil {
			return err
		}
	}
	return nil
}

// this is url.URL.Encode from the standard library, but using escape instead of url.QueryEscape
func encode(v url.Values) []byte {
	if v == nil {
		return []byte{}
	}
	var buf bytes.Buffer
	keys := make([]string, 0, len(v))
	for k := range v {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		vs := v[k]
		prefix := escape(k) + "="
		for _, v := range vs {
			if buf.Len() > 0 {
				buf.WriteByte('&')
			}
			buf.WriteString(prefix)
			buf.WriteString(escape(v))
		}
	}
	return buf.Bytes()
}

func escape(s string) string {
	var buf bytes.Buffer
	for _, b := range []byte(s) {
		if b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || b == '-' || b == '.' || b == '_' || b == '~' {
			buf.WriteByte(b)
		} else {
			fmt.Fprintf(&buf, "%%%02X", b)
		}
	}
	return buf.String()
}
