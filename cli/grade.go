package main

import (
	"fmt"
	"log"
	"os"
	"time"

	. "github.com/russross/codegrinder/rpc"
	"github.com/spf13/cobra"
)

func CommandGrade(cmd *cobra.Command, args []string) {
	client, conn, ctx, user, err := setup(cmd)
	if err != nil {
		log.Fatalf("failed to connect to gRPC server: %s", cleanError(err))
	}
	defer conn.Close()

	now := time.Now()

	if len(args) != 0 {
		cmd.Help()
		os.Exit(1)
	}

	_, problem, _, _, commit, dotfile, _ := gatherStudent(now, ".", client, ctx)
	commit.Action = "grade"
	commit.Note = "grind grade"
	unsigned := &CommitBundle{
		UserId: user.Id,
		Commit: commit,
	}

	// send the commit bundle to the server
	dumpMessage("PostCommitBundlesUnsigned", true, &PostCommitBundlesUnsignedRequest{Bundle: unsigned})
	signedResp, err := client.PostCommitBundlesUnsigned(ctx, &PostCommitBundlesUnsignedRequest{Bundle: unsigned})
	if err != nil {
		log.Fatalf("failed to post commit bundle: %s", cleanError(err))
	}
	dumpMessage("PostCommitBundlesUnsigned", false, signedResp)
	signed := signedResp.Bundle

	// send it to the daycare for grading
	if signed.Hostname == "" {
		log.Fatalf("server was unable to find a suitable daycare, unable to grade")
	}
	fmt.Printf("submitting %s step %d for grading\n", problem.Unique, commit.Step)

	// call handleDaycareStream in non-interactive mode
	graded, err := handleDaycareStream(client, conn, signed, nil, "", false)
	if err != nil {
		log.Fatalf("failed to confirm commit bundle: %s", cleanError(err))
	}
	if graded == nil {
		log.Fatalf("the server ended the connection without sending a report card")
	}

	// save the commit with report card
	toSave := &CommitBundle{
		Hostname:        graded.Hostname,
		UserId:          graded.UserId,
		Commit:          graded.Commit,
		CommitSignature: graded.CommitSignature,
	}
	dumpMessage("PostCommitBundlesSigned", true, &PostCommitBundlesSignedRequest{Bundle: toSave})
	savedResp, err := client.PostCommitBundlesSigned(ctx, &PostCommitBundlesSignedRequest{Bundle: toSave})
	if err != nil {
		log.Fatalf("failed to post signed commit bundle: %s", cleanError(err))
	}
	dumpMessage("PostCommitBundlesSigned", false, savedResp)
	saved := savedResp.Bundle
	commit = saved.Commit

	if commit.ReportCard != nil && commit.ReportCard.Passed && commit.Score == 1.0 {
		if nextStep(".", dotfile.Problems[problem.Unique], problem, commit, make(map[string]*ProblemType), client, ctx) {
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
			log.Fatalf("failed to dump transcript: %s", cleanError(err))
		}
	}
}
