package main

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	. "github.com/russross/codegrinder/types"
	"github.com/spf13/cobra"
)

func CommandReset(cmd *cobra.Command, args []string) {
	mustLoadConfig(cmd)
	now := time.Now()

	if len(args) != 0 {
		cmd.Help()
		os.Exit(1)
	}

	// get the user ID
	user := new(User)
	mustGetObject("/users/me", nil, user)

	problemType, problem, assignment, _, dotfile, problemDir := gatherStudent(now, ".")
	info := dotfile.Problems[problem.Unique]

	// gather the files for the step itself
	files := make(map[string][]byte)

	step := new(ProblemStep)
	mustGetObject(fmt.Sprintf("/problems/%d/steps/%d", problem.ID, info.Step), nil, step)

	// get the commit from the previous step if applicable
	if info.Step > 1 {
		commit := new(Commit)
		mustGetObject(fmt.Sprintf("/assignments/%d/problems/%d/steps/%d/commits/last", assignment.ID, problem.ID, info.Step-1), nil, commit)
		for name, contents := range commit.Files {
			files[filepath.FromSlash(name)] = contents
		}
	}

	// commit files may be overwritten by new step files
	for name, contents := range step.Files {
		files[filepath.FromSlash(name)] = contents
	}
	files[filepath.Join("doc", "index.html")] = []byte(step.Instructions)
	for name, contents := range problemType.Files {
		files[filepath.FromSlash(name)] = contents
	}
	updateFiles(problemDir, files, nil, true)

	fmt.Printf("problem %s step %d reset to beginning of step\n", problem.Unique, info.Step)
}
