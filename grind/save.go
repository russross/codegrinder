package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	. "github.com/russross/codegrinder/common"
	"github.com/spf13/cobra"
)

func CommandSave(cmd *cobra.Command, args []string) {
	mustLoadConfig(cmd)
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

	// get the user ID
	user := new(User)
	mustGetObject("/users/me", nil, user)

	_, problem, _, commit, _ := gather(now, dir)
	commit.Action = ""
	commit.Note = "saving from grind tool"
	unsigned := &CommitBundle{
		UserID: user.ID,
		Commit: commit,
	}

	// send the commit to the server
	signed := new(CommitBundle)
	mustPostObject("/commit_bundles/unsigned", nil, unsigned, signed)
	log.Printf("problem %s step %d saved", problem.Unique, commit.Step)
}

func gather(now time.Time, startDir string) (*ProblemType, *Problem, *Assignment, *Commit, *DotFileInfo) {
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
		if problemDir == "" {
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

	// check that the on-disk file matches the expected contents
	// and update as needed
	checkAndUpdate := func(name, contents string) {
		path := filepath.Join(problemDir, name)
		ondisk, err := ioutil.ReadFile(path)
		if err != nil && os.IsNotExist(err) {
			log.Printf("warning: file %s was not found", name)
			log.Printf("   saving the current version")
			if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
				log.Fatalf("error creating directory %s: %v", filepath.Dir(path), err)
			}
			if err := ioutil.WriteFile(path, []byte(contents), 0644); err != nil {
				log.Fatalf("error saving %s: %v", name, err)
			}
		} else if err != nil {
			log.Fatalf("error reading %s: %v", name, err)
		} else if string(ondisk) != contents {
			log.Printf("warning: file %s", name)
			log.Printf("   does not match the latest version")
			log.Printf("   replacing your file with the current version")
			if err := ioutil.WriteFile(path, []byte(contents), 0644); err != nil {
				log.Fatalf("error saving %s: %v", name, err)
			}
		}
	}

	// get the problem type and verify local files match
	problemType := new(ProblemType)
	mustGetObject(fmt.Sprintf("/problem_types/%s", problem.ProblemType), nil, problemType)
	for name, contents := range problemType.Files {
		checkAndUpdate(name, contents)
	}

	// get the problem step and verify local files match
	step := new(ProblemStep)
	mustGetObject(fmt.Sprintf("/problems/%d/steps/%d", problem.ID, info.Step), nil, step)
	for name, contents := range step.Files {
		dir, _ := filepath.Split(name)
		if dir == "" {
			// in main directory, skip files that exist (but write files that are missing)
			path := filepath.Join(problemDir, name)
			if _, err := os.Stat(path); err == nil {
				continue
			}
		}
		checkAndUpdate(name, contents)
	}
	checkAndUpdate(filepath.Join("doc", "index.html"), step.Instructions)

	// gather the commit files from the file system
	files := make(map[string]string)
	err := filepath.Walk(problemDir, func(path string, stat os.FileInfo, err error) error {
		// skip errors, directories, non-regular files
		if err != nil {
			return err
		}
		if path == problemDir {
			// descend into the main directory
			return nil
		}
		if stat.IsDir() {
			return filepath.SkipDir
		}
		if !stat.Mode().IsRegular() {
			return nil
		}
		_, name := filepath.Split(path)

		// skip our config file
		if name == perProblemSetDotFile {
			return nil
		}

		// skip files from the problem type
		if _, exists := problemType.Files[name]; exists {
			return nil
		}

		// silently skip some blacklisted file suffixes
		blacklist := []string{"~", ".swp", ".o", ".pyc", ".out"}
		for _, suffix := range blacklist {
			if strings.HasSuffix(name, suffix) {
				return nil
			}
		}

		if info.Whitelist[name] {
			contents, err := ioutil.ReadFile(path)
			if err != nil {
				return err
			}
			files[name] = string(contents)
		} else {
			//log.Printf("skipping %q which is not distributed with the problem", name)
		}
		return nil
	})
	if err != nil {
		log.Fatalf("walk error: %v", err)
	}
	if len(files) != len(info.Whitelist) {
		log.Printf("did not find all the expected files")
		for name := range info.Whitelist {
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

	return problemType, problem, assignment, commit, dotfile
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
					log.Printf("unable to find %s in %s or an ancestor directory", perProblemSetDotFile, startDir)
					log.Printf("   you must run this in a problem directory")
					log.Fatalf("   or supply the directory name as an argument")
				}
				// log.Printf("could not find %s in %s, trying %s", perProblemSetDotFile, problemDir, problemSetDir)
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
	dotfile.Path = path

	return dotfile, problemSetDir, problemDir
}
