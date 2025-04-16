package main

import (
	"fmt"
	"log"
	"os"
	"time"

	. "github.com/russross/codegrinder/types"
	"github.com/spf13/cobra"
)

func CommandGrade(cmd *cobra.Command, args []string) {
	mustLoadConfig(cmd)
	now := time.Now()

	if len(args) != 0 {
		cmd.Help()
		os.Exit(1)
	}

	// get the user ID
	user := new(User)
	mustGetObject("/users/me", nil, user)

	_, problem, _, _, commit, dotfile, _ := gatherStudent(now, ".")
	commit.Action = "grade"
	commit.Note = "grind grade"
	unsigned := &CommitBundle{
		UserID: user.ID,
		Commit: commit,
	}

	// send the commit bundle to the server
	signed := new(CommitBundle)
	mustPostObject("/commit_bundles/unsigned", nil, unsigned, signed)

	// send it to the daycare for grading
	if signed.Hostname == "" {
		log.Fatalf("server was unable to find a suitable daycare, unable to grade")
	}
	fmt.Printf("submitting %s step %d for grading\n", problem.Unique, commit.Step)
	graded := mustConfirmCommitBundle(signed, nil)

	// save the commit with report card
	toSave := &CommitBundle{
		Hostname:        graded.Hostname,
		UserID:          graded.UserID,
		Commit:          graded.Commit,
		CommitSignature: graded.CommitSignature,
	}
	saved := new(CommitBundle)
	mustPostObject("/commit_bundles/signed", nil, toSave, saved)
	commit = saved.Commit

	if commit.ReportCard != nil && commit.ReportCard.Passed && commit.Score == 1.0 {
		if nextStep(".", dotfile.Problems[problem.Unique], problem, commit, make(map[string]*ProblemType)) {
			// save the updated dotfile with new step number
			saveDotFile(dotfile)
		}
	} else {
		// solution failed
		fmt.Printf("  solution for step %d failed\n", commit.Step)
		if commit.ReportCard != nil {
			fmt.Printf("  ReportCard: %s\n", commit.ReportCard.Note)
		}

		// play the transcript
		if err := commit.DumpTranscript(os.Stdout); err != nil {
			log.Fatalf("failed to dump transcript: %v", err)
		}
	}
}
