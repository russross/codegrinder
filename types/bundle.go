package types

type ProblemSetBundle struct {
	ProblemSet *ProblemSet `json:"problemSets"`
	ProblemIDs []int64     `json:"problemIDs"`
	Weights    []float64   `json:"weights"`
}

type ProblemBundle struct {
	Problem      *Problem       `json:"problem"`
	ProblemSteps []*ProblemStep `json:"problemSteps"`
	Commits      []*Commit      `json:"commits"`
	Signatures   []string       `json:"signatures,omitempty"`
}

type CommitBundle struct {
	Problem     *Problem     `json:"problem"`
	ProblemStep *ProblemStep `json:"problemStep"`
	Commit      *Commit      `json:"commit"`
	Signature   string       `json:"signature,omitempty"`
}
