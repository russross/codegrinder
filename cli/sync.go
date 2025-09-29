package main

import (
	"fmt"
	"log"
	"os"
	"time"

	. "github.com/russross/codegrinder/rpc"
	"github.com/spf13/cobra"
)

func CommandSync(cmd *cobra.Command, args []string) {
	client, conn, ctx, err := setup(cmd)
	if err != nil {
		log.Fatalf("failed to connect to gRPC server: %v", err)
	}
	defer conn.Close()

	now := time.Now()

	if len(args) != 0 {
		cmd.Help()
		os.Exit(1)
	}

	// get the user ID
	dumpMessage("GetUserMe", true, &GetUserMeRequest{})
	userResp, err := client.GetUserMe(ctx, &GetUserMeRequest{})
	if err != nil {
		log.Fatalf("failed to get user: %v", err)
	}
	dumpMessage("GetUserMe", false, userResp)
	user := userResp.User

	_, problem, _, _, commit, _, _ := gatherStudent(now, ".", client, ctx)
	commit.Action = ""
	commit.Note = "grind sync"
	unsigned := &CommitBundle{
		UserId: user.Id,
		Commit: commit,
	}

	// send the commit to the server
	dumpMessage("PostCommitBundlesUnsigned", true, &PostCommitBundlesUnsignedRequest{Bundle: unsigned})
	_, err = client.PostCommitBundlesUnsigned(ctx, &PostCommitBundlesUnsignedRequest{Bundle: unsigned})
	if err != nil {
		log.Fatalf("failed to post commit bundle: %v", err)
		dumpMessage("PostCommitBundlesUnsigned", false, nil)
	}
	fmt.Printf("problem %s step %d synced\n", problem.Unique, commit.Step)
}
