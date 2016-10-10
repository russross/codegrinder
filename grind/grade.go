package main

import (
	"encoding/json"
	"io/ioutil"
	"log"
	"os"
	"time"

	. "github.com/russross/codegrinder/common"
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

	_, problem, _, commit, dotfile := gather(now, ".")
	commit.Action = "grade"
	commit.Note = "grading from grind tool"
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
	log.Printf("submitting %s step %d for grading", problem.Unique, commit.Step)
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
		if nextStep(".", dotfile.Problems[problem.Unique], problem, commit) {
			// save the updated dotfile with whitelist updates and new step number
			contents, err := json.MarshalIndent(dotfile, "", "    ")
			if err != nil {
				log.Fatalf("JSON error encoding %s: %v", dotfile.Path, err)
			}
			contents = append(contents, '\n')
			if err := ioutil.WriteFile(dotfile.Path, contents, 0644); err != nil {
				log.Fatalf("error saving file %s: %v", dotfile.Path, err)
			}
		}
	} else {
		// solution failed
		log.Printf("  solution for step %d failed", commit.Step)
		if commit.ReportCard != nil {
			log.Printf("  ReportCard: %s", commit.ReportCard.Note)
		}

		// play the transcript
		if err := commit.DumpTranscript(os.Stdout); err != nil {
			log.Fatalf("failed to dump transcript: %v", err)
		}
	}
}
