package main

import (
	"fmt"
	"os"
	"time"

	. "github.com/russross/codegrinder/types"
	"github.com/spf13/cobra"
)

func CommandSync(cmd *cobra.Command, args []string) {
	mustLoadConfig(cmd)
	now := time.Now()

	if len(args) != 0 {
		cmd.Help()
		os.Exit(1)
	}

	// get the user ID
	user := new(User)
	mustGetObject("/users/me", nil, user)

	_, problem, _, commit, _, _ := gatherStudent(now, ".")
	commit.Action = ""
	commit.Note = "grind sync"
	unsigned := &CommitBundle{
		UserID: user.ID,
		Commit: commit,
	}

	// send the commit to the server
	signed := new(CommitBundle)
	mustPostObject("/commit_bundles/unsigned", nil, unsigned, signed)
	fmt.Printf("problem %s step %d synced\n", problem.Unique, commit.Step)
}
