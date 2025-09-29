package main

import (
	"log"
	"os"
	"path/filepath"
	"time"

	. "github.com/russross/codegrinder/rpc"
	"github.com/spf13/cobra"
)

func CommandSolve(cmd *cobra.Command, args []string) {
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
	if !user.Author {
		log.Fatalf("you must be an author to use this command")
	}

	_, _, step, _, _, _, problemDir := gatherStudent(now, ".", client, ctx)

	if step.Solution == nil || len(step.Solution) == 0 {
		log.Fatalf("no solution files found")
	}
	files := make(map[string][]byte)
	for name, contents := range step.Solution {
		files[filepath.FromSlash(name)] = contents
	}
	updateFiles(problemDir, files, nil, true)
}
