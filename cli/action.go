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
	client, conn, ctx, err := setup(cmd)
	if err != nil {
		log.Fatalf("failed to connect to gRPC server: %v", err)
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
			log.Fatalf("invalid daycare URL: %v", err)
		}

		// Prepare the signed bundle
		bundle, err := prepareSignedBundle(now, action, parsedURL.Host, client, ctx)
		if err != nil {
			log.Fatalf("error preparing signed bundle: %v", err)
		}

		fmt.Printf("starting interactive session for %s step %d with daycare server %s\n",
			bundle.Problem.Unique, bundle.Commit.Step, daycareHost)

		// Connect to the specified daycare server directly
		// call handleDaycareStream: have it download files and print out events
		if _, err := handleDaycareStream(nil, nil, bundle, nil, ".", true); err != nil {
			log.Fatalf("interactive session failed: %v", err)
		}
		return
	}

	// do not allow grade as an interactive action
	if action == "grade" {
		log.Printf("'%s action' is for testing code, not for grading", os.Args[0])
		log.Fatalf("  to submit your code for grading, use '%s grade'", os.Args[0])
	}

	// get the user ID
	dumpMessage("GetUserMe", true, &GetUserMeRequest{})
	userResp, err := client.GetUserMe(ctx, &GetUserMeRequest{})
	if err != nil {
		log.Fatalf("failed to get user: %v", err)
	}
	dumpMessage("GetUserMe", false, userResp)
	user := userResp.User

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
		log.Fatalf("failed to post commit bundle: %v", err)
	}
	dumpMessage("PostCommitBundlesUnsigned", false, signedResp)
	signed := signedResp.Bundle

	// send it to the daycare for grading
	if signed.Hostname == "" {
		log.Fatalf("server was unable to find a suitable daycare, unable to run action")
	}
	fmt.Printf("starting interactive session for %s step %d\n", problem.Unique, commit.Step)
	// call handleDaycareStream: have it download files and print out events
	if _, err := handleDaycareStream(client, conn, signed, nil, ".", true); err != nil {
		log.Fatalf("interactive session failed: %v", err)
	}
}
