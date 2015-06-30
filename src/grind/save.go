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

	"github.com/codegangsta/cli"
)

const GrindAssignmentIDName = ".grind"

func CommandSave(context *cli.Context) {
	mustLoadConfig()
	now := time.Now()

	// find the directory
	d := ""
	switch len(context.Args()) {
	case 0:
		d = "."
	case 1:
		d = context.Args().First()
	default:
		cli.ShowSubcommandHelp(context)
		return
	}
	dir, err := filepath.Abs(d)
	if err != nil {
		log.Fatalf("error finding directory %q: %v", d, err)
	}

	// find the .grind file
	for {
		path := filepath.Join(dir, GrindAssignmentIDName)
		if _, err := os.Stat(path); err != nil {
			if os.IsNotExist(err) {
				// try moving up a directory
				old := dir
				dir = filepath.Dir(dir)
				if dir == old {
					log.Fatalf("unable to find %s in %s or an ancestor directory", GrindAssignmentIDName, d)
				}
				log.Printf("could not find %s in %s, trying %s", GrindAssignmentIDName, old, dir)
				continue
			}

			log.Fatalf("error searching for %s in %s: %v", GrindAssignmentIDName, dir, err)
		}
		break
	}

	// read the .grind file
	path := filepath.Join(dir, GrindAssignmentIDName)
	contents, err := ioutil.ReadFile(path)
	if err != nil {
		log.Fatalf("error reading %s: %v", path, err)
	}
	commit := new(Commit)
	if err := json.Unmarshal(contents, commit); err != nil {
		log.Fatalf("error parsing commit from %s: %v", path, err)
	}

	// get the assignment
	assignment := new(Assignment)
	mustGetObject(fmt.Sprintf("/users/me/assignments/%d", commit.AssignmentID), nil, assignment)

	// get the problem
	problem := new(Problem)
	mustGetObject(fmt.Sprintf("/problems/%d", assignment.ProblemID), nil, problem)

	// get the whitelist of files that can go in the commit
	whitelist := map[string]bool{}
	for n, step := range problem.Steps {
		if n > commit.ProblemStepNumber {
			break
		}
		for name := range step.Files {
			if len(strings.Split(name, "/")) == 1 {
				whitelist[name] = true
			}
		}
	}

	// gather the commit files from the file system
	files := make(map[string]string)
	err = filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		// skip errors, directories, non-regular files
		if err != nil {
			return err
		}
		if path == dir {
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
		if name == GrindAssignmentIDName {
			return nil
		}

		if whitelist[name] {
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
	commit.ID = 0
	commit.Action = ""
	commit.Comment = "saving from grind tool"
	commit.Files = files
	commit.Transcript = nil
	commit.ReportCard = nil
	commit.Score = 0
	commit.CreatedAt = now
	commit.UpdatedAt = now
	commit.ProblemSignature = problem.Signature
	commit.Timestamp = nil
	commit.Signature = ""

	// send the commit to the server
	signed := new(Commit)
	mustPostObject(fmt.Sprintf("/users/me/assignments/%d/commits", commit.AssignmentID), nil, commit, signed)

	// save the commit locally
	path = filepath.Join(dir, GrindAssignmentIDName)
	contents, err = json.MarshalIndent(signed, "", "    ")
	if err != nil {
		log.Fatalf("JSON error marshalling commit: %v", err)
	}
	contents = append(contents, '\n')
	if err := ioutil.WriteFile(path, contents, 0644); err != nil {
		log.Fatalf("error saving file %q: %v", path, err)
	}
}
