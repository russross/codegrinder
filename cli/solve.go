package main

import (
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/spf13/cobra"
)

func CommandSolve(cmd *cobra.Command, args []string) {
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
