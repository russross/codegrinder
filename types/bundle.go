package types

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
