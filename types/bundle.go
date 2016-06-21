package types

import "time"

type ProblemSetBundle struct {
	ProblemSet *ProblemSet `json:"problemSets"`
	ProblemIDs []int64     `json:"problemIDs"`
	Weights    []float64   `json:"weights"`
}

type ProblemBundle struct {
	Problem          *Problem       `json:"problem"`
	ProblemSteps     []*ProblemStep `json:"problemSteps"`
	ProblemSignature string         `json:"problemSignature,omitempty"`
	Commits          []*Commit      `json:"commits"`
	CommitSignatures []string       `json:"commitSignatures,omitempty"`
}

type CommitBundle struct {
	Problem          *Problem       `json:"problem"`
	ProblemSteps     []*ProblemStep `json:"problemSteps"`
	ProblemSignature string         `json:"problemSignature,omitempty"`
	Commit           *Commit        `json:"commit"`
	CommitSignature  string         `json:"commitSignature,omitempty"`
}

// MaxDaycareRequestAge is the maximum age of a daycare-signed commit to be saved.
// Any commit older than this will be rejected.
const MaxDaycareRequestAge = 15 * time.Minute

// DaycareRequest represents a single request from a client to the daycare.
// These objects are streamed across a websockets connection.
type DaycareRequest struct {
	UserID       int64         `json:"userID,omitempty"`
	CommitBundle *CommitBundle `json:"commitBundle,omitempty"`
	Stdin        string        `json:"stdin,omitempty"`
}

// DaycareResponse represents a single response from the daycare back to a client.
// These objects are streamed across a websockets connection.
type DaycareResponse struct {
	CommitBundle *CommitBundle `json:"commitBundle,omitempty"`
	Event        *EventMessage `json:"event,omitempty"`
	Error        string        `json:"error,omitempty"`
}
