package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
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

	// get the problem type and verify local files matach
	problemType := new(ProblemType)
	mustGetObject(fmt.Sprintf("/problem_types/%s", problem.ProblemType), nil, problemType)
	for name, contents := range problemType.Files {
		ondisk, err := ioutil.ReadFile(filepath.Join(problemDir, name))
		if err != nil && os.IsNotExist(err) {
			log.Printf("expected to find %s, but it is missing", name)
			continue
		} else if err != nil {
			log.Fatalf("error reading %s: %v", name, err)
		}
		if string(ondisk) != contents {
			log.Printf("Warning! file %s", name)
			log.Printf("   does not match the latest version from the problem type")
			log.Printf("   consider re-downloading to get the current version")
		}
	}

	// get the problem step and verify local files match
	step := new(ProblemStep)
	mustGetObject(fmt.Sprintf("/problems/%d/steps/%d", problem.ID, info.Step), nil, step)
	for name, contents := range step.Files {
		dir, _ := filepath.Split(name)
		if dir == "" {
			// skip files in the main directory
			continue
		}
		ondisk, err := ioutil.ReadFile(filepath.Join(problemDir, name))
		if err != nil && os.IsNotExist(err) {
			log.Printf("expected to find %s, but it is missing", name)
			continue
		} else if err != nil {
			log.Fatalf("error reading %s: %v", name, err)
		}
		if string(ondisk) != contents {
			log.Printf("Warning! file %s", name)
			log.Printf("   does not match the latest version from the problem")
			log.Printf("   consider re-downloading to get the current version")
		}
	}

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
			//log.Printf("skipping %s because it came from the problem type", name)
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
