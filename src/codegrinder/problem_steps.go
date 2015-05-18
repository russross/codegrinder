package main

import (
	"strings"
	"time"
	"unicode/utf8"
)

type ProblemStep struct {
	ID          int               `json:"id" meddler:"id,pk"`
	ProblemID   int               `json:"problemId" meddler:"problem_id"`
	Name        string            `json:"name" meddler:"name"`
	Description string            `json:"description" meddler:"description,zeroisnull"`
	Position    int               `json:"position" meddler:"position"`
	ScoreWeight float64           `json:"scoreWeight" meddler:"score_weight"`
	Definition  map[string]string `json:"definition" meddler:"definition,json"`
	CreatedAt   time.Time         `json:"createdAt" meddler:"created_at,localtime"`
	UpdatedAt   time.Time         `json:"updatedAt" meddler:"updated_at,localtime"`
}

// filter out files with underscore prefix
func (step *ProblemStep) FilterOutgoing() {
	clean := make(map[string]string)
	for name, contents := range step.Definition {
		if !strings.HasPrefix(name, "_") {
			clean[name] = contents
		}
	}
	step.Definition = clean
}

var directoryWhitelist = map[string]bool{
	"in":   true,
	"out":  true,
	"_doc": true,
}

// fix line endings
func (step *ProblemStep) FilterIncoming() {
	clean := make(map[string]string)
	for name, contents := range step.Definition {
		parts := strings.Split(name, "/")
		fixed := contents
		if (len(parts) < 2 || !directoryWhitelist[parts[0]]) && utf8.ValidString(contents) {
			fixed = fixLineEndings(contents)
			if fixed != contents {
				logi.Printf("fixed line endings for %s", name)
			}
		} else if utf8.ValidString(contents) {
			fixed = fixNewLines(contents)
			if fixed != contents {
				logi.Printf("fixed newlines for %s", name)
			}
		}
		clean[name] = fixed
	}
	step.Definition = clean
}
