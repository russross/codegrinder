package rpc

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net/url"
	"strconv"
	"strings"
	"time"

	durationpb "google.golang.org/protobuf/types/known/durationpb"
)

// Constants from types/user.go
const (
	TranscriptEventCountLimit = 500
	TranscriptDataLimit       = 1e5
	OpenCommitTimeout         = 6 * time.Hour
	SignedCommitTimeout       = 15 * time.Minute
	CookieName                = "codegrinder"
)

// IsInstructorRole returns true if the given LTI Roles field indicates this
// user is an instructor for a specific course.
func (asst *Assignment) IsInstructorRole() bool {
	for _, role := range strings.Split(asst.Roles, ",") {
		if role == "Instructor" || role == "urn:lti:role:ims/lis/TeachingAssistant" {
			return true
		}
	}
	return false
}

// SetMinorScore sets a score for a specific minor category
func (assignment *Assignment) SetMinorScore(major string, minor int, score float64) {
	// save the raw score
	var foundEntry *ScoreEntry
	for _, entry := range assignment.RawScores {
		if entry.Key == major {
			foundEntry = entry
			break
		}
	}
	if foundEntry == nil {
		foundEntry = &ScoreEntry{Key: major, Scores: nil}
		assignment.RawScores = append(assignment.RawScores, foundEntry)
	}

	for minor >= len(foundEntry.Scores) {
		foundEntry.Scores = append(foundEntry.Scores, strconv.FormatFloat(0.0, 'g', -1, 64))
	}
	foundEntry.Scores[minor] = strconv.FormatFloat(score, 'g', -1, 64)
}

// ComputeScore computes an overall score
func (assignment *Assignment) ComputeScore(majorWeights map[string]float64, minorWeights map[string][]float64) (float64, error) {
	// compute an overall score
	majorWeightSum, majorScoreSum := 0.0, 0.0
	for unique, majorWeight := range majorWeights {
		var stringScores []string
		for _, entry := range assignment.RawScores {
			if entry.Key == unique {
				stringScores = entry.Scores
				break
			}
		}
		if stringScores == nil {
			// No scores for this major, skip
			continue
		}

		var scores []float64
		for _, s := range stringScores {
			f, err := strconv.ParseFloat(s, 64)
			if err != nil {
				return 0.0, fmt.Errorf("failed to parse score %s: %w", s, err)
			}
			scores = append(scores, f)
		}

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

// ComputeSignature computes the signature for a Commit
func (commit *Commit) ComputeSignature(secret, problemTypeSignature, problemSignature, daycareHost string, userID int64) string {
	v := make(url.Values)

	// gather all relevant fields
	v.Add("id", strconv.FormatInt(commit.Id, 10))
	v.Add("assignment_id", strconv.FormatInt(commit.AssignmentId, 10))
	v.Add("problem_id", strconv.FormatInt(commit.ProblemId, 10))
	v.Add("step", strconv.FormatInt(commit.Step, 10))
	v.Add("action", commit.Action)
	v.Add("note", commit.Note)
	for _, file := range commit.Files {
		v.Add(fmt.Sprintf("file-%s", file.Path), string(file.Contents))
	}
	for n, event := range commit.Transcript {
		v.Add(fmt.Sprintf("transcript-%d", n), event.String())
	}
	if commit.ReportCard != nil {
		v.Add("reportcard-passed", strconv.FormatBool(commit.ReportCard.Passed))
		v.Add("reportcard-note", commit.ReportCard.Note)
		v.Add("reportcard-duration", commit.ReportCard.Duration.AsDuration().String())
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
	v.Add("created_at", commit.CreatedAt.AsTime().Round(time.Second).UTC().Format(time.RFC3339))
	v.Add("updated_at", commit.UpdatedAt.AsTime().Round(time.Second).UTC().Format(time.RFC3339))
	v.Add("problem_type_signature", problemTypeSignature)
	v.Add("problem_signature", problemSignature)
	v.Add("daycare_host", daycareHost)
	v.Add("user_id", strconv.FormatInt(userID, 10))

	// compute signature
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(encode(v))
	sum := mac.Sum(nil)
	sig := base64.StdEncoding.EncodeToString(sum)
	return sig
}

// Normalize validates and normalizes a Commit
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
	if commit.CreatedAt.AsTime().Before(BeginningOfTime) || commit.CreatedAt.AsTime().After(now) {
		return fmt.Errorf("commit CreatedAt time of %v is invalid", commit.CreatedAt.AsTime())
	}
	if commit.UpdatedAt.AsTime().Before(BeginningOfTime) || commit.UpdatedAt.AsTime().After(now) {
		return fmt.Errorf("commit UpdatedAt time of %v is invalid", commit.UpdatedAt.AsTime())
	}

	return nil
}

// FilterIncoming filters out files not on whitelist and cleans line endings
func (commit *Commit) FilterIncoming(whitelist map[string]bool) {
	clean := []*File{}
	for _, file := range commit.Files {
		// normalize line endings
		// only keep files on the whitelist
		if whitelist[file.Path] {
			clean = append(clean, &File{Path: file.Path, Contents: fixLineEndings(file.Contents)})
		} else {
			log.Printf("filtered out %s, which is not on the problem step whitelist", file.Path)
		}
	}
	commit.Files = clean
}

// DumpTranscript writes the transcript to a writer
func (commit *Commit) DumpTranscript(w io.Writer) error {
	for _, elt := range commit.Transcript {
		if _, err := fmt.Fprintf(w, "%s", elt.Dump()); err != nil {
			return err
		}
	}
	return nil
}

// Dump returns a string representation for dumping
func (e *EventMessage) Dump() string {
	switch e.Event {
	case "exec":
		return fmt.Sprintf("$ %s\r\n", strings.Join(e.ExecCommand, " "))
	case "exit":
		if e.ExitStatus == 0 {
			return ""
		}
		if sig := signals[int(e.ExitStatus)-128]; sig != "" {
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

// NewReportCard creates a new ReportCard
func NewReportCard() *ReportCard {
	return &ReportCard{
		Passed:  true,
		Results: []*ReportCardResult{},
	}
}

// AddTime adds duration to the ReportCard
func (elt *ReportCard) AddTime(duration time.Duration) {
	newDuration := elt.Duration.AsDuration() + duration
	elt.Duration = durationpb.New(newDuration)
}

// Failf marks the ReportCard as failed
func (elt *ReportCard) Failf(note string, params ...interface{}) {
	elt.Passed = false
	if elt.Note != "" {
		elt.Note += ", "
	}
	elt.Note += fmt.Sprintf(note, params...)
}

// LogAndFailf logs and marks as failed
func (elt *ReportCard) LogAndFailf(note string, params ...interface{}) {
	msg := fmt.Sprintf(note, params...)
	log.Print(msg)

	elt.Passed = false
	if elt.Note != "" {
		elt.Note += ", "
	}
	elt.Note += msg
}

// AddFailedResult adds a failed result
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

// AddPassedResult adds a passed result
func (elt *ReportCard) AddPassedResult(name, details string) *ReportCardResult {
	r := &ReportCardResult{
		Name:    name,
		Outcome: "passed",
		Details: details,
	}
	elt.Results = append(elt.Results, r)
	return r
}

// ComputeScore computes the score from results
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

// Signals map for exit status interpretation
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
