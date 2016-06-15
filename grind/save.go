package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"time"

	. "github.com/russross/codegrinder/types"
	"github.com/spf13/cobra"
)

func CommandSave(cmd *cobra.Command, args []string) {
	mustLoadConfig()
	now := time.Now()

	// find the directory
	dir := ""
	switch len(args) {
	case 0:
		dir = "."
	case 1:
		dir = args[0]
	default:
		cmd.Help()
		return
	}

	problem, _, commit := gather(now, dir)
	commit.Action = ""
	commit.Comment = "saving from grind tool"

	// send the commit to the server
	signed := new(Commit)
	mustPostObject(fmt.Sprintf("/assignments/%d/commits", commit.AssignmentID), nil, commit, signed)
	log.Printf("problem %s step %d saved", problem.Unique, commit.Step)
}

func gather(now time.Time, startDir string) (*Problem, *Assignment, *Commit) {
	// find the .grind file containing the problem set info
	dotfile, problemSetDir, problemDir := findDotFile(startDir)

	// get the assignment
	assignment := new(Assignment)
	mustGetObject(fmt.Sprintf("/assignments/%d", dotfile.AssignmentID), nil, assignment)

	// get the problem
	unique := ""
	if len(dotfile.Problems) == 1 {
		// only one problem? files should be in dotfile directory
		for u := range dotfile.Problems {
			unique = u
		}
		problemDir = problemSetDir
	} else {
		// use the subdirectory name to identify the problem
		if child == "" {
			log.Printf("you must identify the problem within this problem set")
			log.Printf("  either run this from with the problem directory, or")
			log.Fatalf("  identify it as a parameter in the command")
		}
		_, unique = filepath.Split(problemDir)
	}
	info := dotfile.Problems[unique]
	if info == nil {
		log.Fatalf("unable to recognize the problem based on the directory name of %q", unique)
	}
	problem := new(Problem)
	mustGetObject(fmt.Sprintf("/problems/%d", info.ID), nil, problem)

	// gather the commit files from the file system
	files := make(map[string]string)
	err = filepath.Walk(problemDir, func(path string, info os.FileInfo, err error) error {
		// skip errors, directories, non-regular files
		if err != nil {
			return err
		}
		if path == problemDir {
			// descent into the main directory
			return nil
		}
		if info.IsDir() {
			return filepath.SkipDir
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		_, name := filepath.Split(path)

		// skip our config file
		if name == perProblemSetDotFile {
			return nil
		}

		if info.Whitelist[name] {
			contents, err := ioutil.ReadFile(path)
			if err != nil {
				return err
			}
			files[name] = string(contents)
		} else {
			log.Printf("skipping %q which is not a file introduced by the problem", name)
		}
		return nil
	})
	if err != nil {
		log.Fatalf("walk error: %v", err)
	}
	if len(files) != len(whitelist) {
		log.Printf("did not find all the expected files")
		for name := range whitelist {
			if _, ok := files[name]; !ok {
				log.Printf("  %s not found", name)
			}
		}
		log.Fatalf("all expected files must be present")
	}

	// form a commit object
	commit := &Commit{
		ID:           0,
		AssignmentID: dotfile.AssignmentID,
		ProblemID:    info.ID,
		Step:         info.Step,
		Files:        files,
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	return problem, assignment, commit
}

func findDotFile(startDir string) (dotfile *DotFileInfo, problemSetDir, problemDir string) {
	abs := false
	problemSetDir, problemDir = startDir, ""
	for {
		path := filepath.Join(problemSetDir, perProblemSetDotFile)
		if _, err := os.Stat(path); err != nil {
			if os.IsNotExist(err) {
				if !abs {
					abs = true
					path, err := filepath.Abs(problemSetDir)
					if err != nil {
						log.Fatalf("error finding absolute path of %s: %v", problemSetDir, err)
					}
					problemSetDir = path
				}

				// try moving up a directory
				problemDir = problemSetDir
				problemSetDir = filepath.Dir(problemSetDir)
				if problemSetDir == problemDir {
					log.Fatalf("unable to find %s in %s or an ancestor directory", perProblemSetDotFile, startDir)
				}
				log.Printf("could not find %s in %s, trying %s", perProblemSetDotFile, problemDir, problemSetDir)
				continue
			}

			log.Fatalf("error searching for %s in %s: %v", perProblemSetDotFile, problemSetDir, err)
		}
		break
	}

	// read the .grind file
	path := filepath.Join(problemSetDir, perProblemSetDotFile)
	contents, err := ioutil.ReadFile(path)
	if err != nil {
		log.Fatalf("error reading %s: %v", path, err)
	}
	dotfile = new(DotFileInfo)
	if err := json.Unmarshal(contents, dotfile); err != nil {
		log.Fatalf("error parsing %s: %v", path, err)
	}

	return dotfile, problemSetDir, problemDir
}
