package main

import (
	"fmt"
	"log"
	"net/url"
	"os"
	"time"

	. "github.com/russross/codegrinder/rpc"
	"github.com/spf13/cobra"
)

func CommandAction(cmd *cobra.Command, args []string) {
	client, conn, ctx, user, err := setup(cmd)
	if err != nil {
		log.Fatalf("failed to connect to gRPC server: %s", cleanError(err))
	}
	defer conn.Close()

	now := time.Now()

	action := ""
	if len(args) > 1 {
		cmd.Help()
		os.Exit(1)
	} else if len(args) == 1 {
		action = args[0]
	}

	// Check if the --daycare flag is set (instructor only)
	daycareFlag := cmd.Flag("daycare")
	if daycareFlag != nil && daycareFlag.Value.String() != "" {
		// Instructor is using a direct daycare connection
		daycareHost := formatDaycareURL(daycareFlag.Value.String())

		// Extract the hostname part for the signature
		parsedURL, err := url.Parse(daycareHost)
		if err != nil {
			log.Fatalf("invalid daycare URL: %s", cleanError(err))
		}

		// Prepare the signed bundle
		bundle, err := prepareSignedBundle(now, action, parsedURL.Host, client, ctx, user)
		if err != nil {
			log.Fatalf("error preparing signed bundle: %s", cleanError(err))
		}

		fmt.Printf("starting interactive session for %s step %d with daycare server %s\n",
			bundle.Problem.Unique, bundle.Commit.Step, daycareHost)

		// Connect to the specified daycare server directly
		// call handleDaycareStream in interactive mode
		if _, err := handleDaycareStream(nil, nil, bundle, nil, ".", true); err != nil {
			log.Fatalf("interactive session failed: %s", cleanError(err))
		}
		return
	}

	// do not allow grade as an interactive action
	if action == "grade" {
		log.Printf("'%s action' is for testing code, not for grading", os.Args[0])
		log.Fatalf("  to submit your code for grading, use '%s grade'", os.Args[0])
	}

	problemType, problem, _, _, commit, _, _ := gatherStudent(now, ".", client, ctx)
	commit.Action = action
	commit.Note = "grind action " + action
	unsigned := &CommitBundle{
		UserId: user.Id,
		Commit: commit,
	}

	// if the requested action does not exist, report available choices
	if _, exists := problemType.Actions[action]; !exists {
		fmt.Printf("available actions for problem type %s:\n", problemType.Name)
		for elt := range problemType.Actions {
			if elt == "grade" {
				continue
			}
			fmt.Printf("   %s\n", elt)
		}
		log.Fatalf("use '%s action [action]' to initiate an action", os.Args[0])
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
		log.Fatalf("server was unable to find a suitable daycare, unable to run action")
	}
	fmt.Printf("starting interactive session for %s step %d\n", problem.Unique, commit.Step)

	// call handleDaycareStream in interactive mode
	if _, err := handleDaycareStream(client, conn, signed, nil, ".", true); err != nil {
		log.Fatalf("interactive session failed: %s", cleanError(err))
	}
}
