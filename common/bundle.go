package common

import "time"

type ProblemSetBundle struct {
	ProblemSet         *ProblemSet          `json:"problemSets"`
	ProblemSetProblems []*ProblemSetProblem `json:"problemSetProblems"`
}

type ProblemBundle struct {
	ProblemType          *ProblemType   `json:"problemType"`
	ProblemTypeSignature string         `json:"problemTypeSignature,omitempty"`
	Problem              *Problem       `json:"problem"`
	ProblemSteps         []*ProblemStep `json:"problemSteps"`
	ProblemSignature     string         `json:"problemSignature,omitempty"`
	Hostname             string         `json:"hostname"`
	UserID               int64          `json:"userID"`
	Commits              []*Commit      `json:"commits"`
	CommitSignatures     []string       `json:"commitSignatures,omitempty"`
}

type CommitBundle struct {
	ProblemType          *ProblemType   `json:"problemType"`
	ProblemTypeSignature string         `json:"problemTypeSignature,omitempty"`
	Problem              *Problem       `json:"problem"`
	ProblemSteps         []*ProblemStep `json:"problemSteps"`
	ProblemSignature     string         `json:"problemSignature,omitempty"`
	Action               string         `json:"action"`
	Hostname             string         `json:"hostname,omitempty"`
	UserID               int64          `json:"userID"`
	Commit               *Commit        `json:"commit"`
	CommitSignature      string         `json:"commitSignature,omitempty"`
}

// MaxDaycareRequestAge is the maximum age of a daycare-signed commit to be saved.
// Any commit older than this will be rejected.
const MaxDaycareRequestAge = 15 * time.Minute

// DaycareRequest represents a single request from a client to the daycare.
// These objects are streamed across a websockets connection.
type DaycareRequest struct {
	CommitBundle *CommitBundle `json:"commitBundle,omitempty"`
	Stdin        string        `json:"stdin,omitempty"`
	CloseStdin   bool          `json:"closeStdin,omitempty"`
}

// DaycareResponse represents a single response from the daycare back to a client.
// These objects are streamed across a websockets connection.
type DaycareResponse struct {
	CommitBundle *CommitBundle `json:"commitBundle,omitempty"`
	Event        *EventMessage `json:"event,omitempty"`
	Error        string        `json:"error,omitempty"`
}
