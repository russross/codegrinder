package main

import (
	"log"
	"os"
	"path/filepath"
	"time"

	. "github.com/greganderson/codegrinder/types"
	"github.com/spf13/cobra"
)

func CommandSolve(cmd *cobra.Command, args []string) {
	mustLoadConfig(cmd)
	now := time.Now()

	if len(args) != 0 {
		cmd.Help()
		os.Exit(1)
	}

	// get the user ID
	user := new(User)
	mustGetObject("/users/me", nil, user)
	if !user.Author && !user.Admin {
		log.Fatalf("you must be an author or admin to use this command")
	}

	_, _, step, _, _, _, problemDir := gatherStudent(now, ".")

	if step.Solution == nil || len(step.Solution) == 0 {
		log.Fatalf("no solution files found")
	}
	files := make(map[string][]byte)
	for name, contents := range step.Solution {
		files[filepath.FromSlash(name)] = contents
	}
	updateFiles(problemDir, files, nil, true)
}
