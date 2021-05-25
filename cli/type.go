package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	. "github.com/russross/codegrinder/types"
	"github.com/spf13/cobra"
)

func CommandType(cmd *cobra.Command, args []string) {
	mustLoadConfig(cmd)

	remove := cmd.Flag("remove").Value.String() == "true"
	list := cmd.Flag("list").Value.String() == "true"

	if list {
		if len(args) != 0 || remove {
			fmt.Println("warning: for a list request, other options will be ignored")
		}

		// display a list of problem types
		fmt.Println("Problem types:")
		problemTypes := []*ProblemType{}
		mustGetObject("/problem_types", nil, &problemTypes)
		if len(problemTypes) == 0 {
			log.Fatalf("no problem types found")
		}
		maxLen := 0
		for _, pt := range problemTypes {
			if len(pt.Name) > maxLen {
				maxLen = len(pt.Name)
			}
		}
		for _, pt := range problemTypes {
			var actions []string
			for action := range pt.Actions {
				actions = append(actions, action)
			}
			fmt.Printf("    %-*s  actions: %s\n", maxLen, pt.Name, strings.Join(actions, ", "))
		}
		return
	}

	// figure out the problem type and directory
	directory, problemTypeName := ".", ""
	if len(args) == 0 {
		// look for a problem.cfg file
		_, stepDir, stepDirN, problem, steps, single := findProblemCfg(time.Now(), ".")
		if problem == nil {
			log.Fatalf("you must supply the problem type or have a valid %s file already in place", ProblemConfigName)
		}
		if !single && stepDirN < 1 {
			log.Fatalf("you must run this from within a step directory")
		}
		directory = filepath.Clean(stepDir)
		if single {
			problemTypeName = steps[0].ProblemType
		} else {
			problemTypeName = steps[stepDirN-1].ProblemType
		}
	} else if len(args) == 1 {
		// problem type supplied as an argument
		problemTypeName = args[0]
	} else {
		cmd.Help()
		os.Exit(1)
	}

	// download files for the given problem type
	problemType := new(ProblemType)
	mustGetObject(fmt.Sprintf("/problem_types/%s", problemTypeName), nil, problemType)

	files := make(map[string][]byte)
	if remove {
		oldFiles := make(map[string]struct{})
		for name := range problemType.Files {
			oldFiles[filepath.FromSlash(name)] = struct{}{}
		}
		updateFiles(directory, files, oldFiles, true)
	} else {
		for name, contents := range problemType.Files {
			files[filepath.FromSlash(name)] = contents
		}
		updateFiles(directory, files, nil, true)
	}
}
