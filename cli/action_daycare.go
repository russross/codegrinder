package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"strings"
	"time"

	. "github.com/russross/codegrinder/types"
)

// prepareSignedBundle gathers and signs a commit bundle for direct submission to a daycare server
func prepareSignedBundle(now time.Time, action string, daycareHost string) (*CommitBundle, error) {
	// Get the user ID
	user := new(User)
	mustGetObject("/users/me", nil, user)

	// Gather student data
	problemType, problem, step, _, commit, _, _ := gatherStudent(now, ".")
	commit.Action = action
	commit.Note = "grind action " + action

	// Check if the requested action exists
	if _, exists := problemType.Actions[action]; !exists {
		fmt.Printf("available actions for problem type %s:\n", problemType.Name)
		for elt := range problemType.Actions {
			if elt == "grade" {
				continue
			}
			fmt.Printf("   %s\n", elt)
		}
		return nil, fmt.Errorf("action %s does not exist for problem type %s", action, problemType.Name)
	}

	// get the DAYCARESECRET environment variable
	secret := os.Getenv("DAYCARESECRET")
	if secret == "" {
		return nil, fmt.Errorf("DAYCARESECRET environment variable must be set")
	}
	if raw, err := base64.StdEncoding.DecodeString(secret); err == nil {
		secret = string(raw)
	}

	// prepare a full problem steps array with the current step in the right place
	steps := make([]*ProblemStep, commit.Step)
	steps[commit.Step-1] = step

	// calculate the problem type signature
	typeSig := problemType.ComputeSignature(secret)

	// calculate the problem signature
	problemSig := problem.ComputeSignature(secret, steps)

	// calculate the commit signature
	commitSig := commit.ComputeSignature(secret, typeSig, problemSig, daycareHost, user.ID)

	// assemble the final commit bundle
	signed := &CommitBundle{
		ProblemType:          problemType,
		ProblemTypeSignature: typeSig,
		Problem:              problem,
		ProblemSteps:         steps,
		ProblemSignature:     problemSig,
		Hostname:             daycareHost,
		UserID:               user.ID,
		Commit:               commit,
		CommitSignature:      commitSig,
	}

	return signed, nil
}

// formatDaycareURL ensures the daycare URL has the correct protocol
func formatDaycareURL(daycareFlag string) string {
	// If no protocol is specified, default to wss://
	if !strings.HasPrefix(daycareFlag, "ws://") && !strings.HasPrefix(daycareFlag, "wss://") {
		return "wss://" + daycareFlag
	}
	return daycareFlag
}
