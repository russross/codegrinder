package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"

	. "github.com/russross/codegrinder/common"
	"github.com/spf13/cobra"
)

func CommandStudent(cmd *cobra.Command, args []string) {
	mustLoadConfig(cmd)

	// parse parameters
	name := ""
	switch len(args) {
	case 0:
		log.Printf("you must specify the assignment to download")
		log.Printf("   run \"grind list\" to see your assignments")
		log.Printf("   you must give the assignment number (displayed on the left)")
		log.Fatalf("   or a name in the form COURSE/problem-set-id (displayed in parentheses)")
	case 1:
		name = args[0]
	default:
		cmd.Help()
		return
	}

	var assignment *Assignment

	if id, err := strconv.Atoi(name); err == nil && id > 0 {
		// look it up by ID
		assignment = new(Assignment)
		mustGetObject(fmt.Sprintf("/assignments/%d", id), nil, assignment)
	} else {
		log.Fatalf("unimplemented")
	}

	rootDir := filepath.Join(os.TempDir(), fmt.Sprintf("grind-tmp.%d", os.Getpid()))
	if err := os.Mkdir(rootDir, 0700); err != nil {
		log.Fatalf("error creating temp directory %s: %v", rootDir, err)
	}
	defer func() {
		log.Printf("deleting %s", rootDir)
		os.RemoveAll(rootDir)
	}()
	changeTo := getAssignment(assignment, rootDir)
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}
	log.Printf("exit shell when finished")
	attr := &os.ProcAttr{
		Dir:   changeTo,
		Files: []*os.File{os.Stdin, os.Stdout, os.Stderr},
	}
	proc, err := os.StartProcess(shell, nil, attr)
	if err != nil {
		log.Fatalf("error launching shell: %v", err)
	}
	if _, err := proc.Wait(); err != nil {
		log.Fatalf("error waiting for shell to terminate: %v", err)
	}
}
