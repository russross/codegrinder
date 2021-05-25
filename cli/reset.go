package main

import (
	"bytes"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"time"

	. "github.com/russross/codegrinder/types"
	"github.com/spf13/cobra"
)

func CommandReset(cmd *cobra.Command, args []string) {
	mustLoadConfig(cmd)
	now := time.Now()

	// get the user ID
	user := new(User)
	mustGetObject("/users/me", nil, user)

	problemType, problem, assignment, _, dotfile, problemDir := gatherStudent(now, ".")
	info := dotfile.Problems[problem.Unique]

	step := new(ProblemStep)
	mustGetObject(fmt.Sprintf("/problems/%d/steps/%d", problem.ID, info.Step), nil, step)

	listed := make(map[string]struct{})
	for _, requested := range args {
		// find this file in the whitelist
		found := false
		clean := filepath.Clean(requested)
		for elt := range step.Whitelist {
			if clean == filepath.FromSlash(elt) {
				// we count an exact match ...
				listed[elt] = struct{}{}
				found = true
			} else if clean == filepath.Base(clean) && clean == filepath.Base(filepath.FromSlash(elt)) {
				// ... or an exact match of a filename in a subdirectory
				listed[elt] = struct{}{}
				found = true
			}
		}
		if !found {
			log.Fatalf("no file matching %q in the list of student files for this step", requested)
		}
	}

	// gather all the files that make up this step
	files := make(map[string][]byte)

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

	// report which files have changed since the step started
	found := false
	for name := range step.Whitelist {
		contents, exists := files[name]
		if !exists {
			log.Fatalf("cannot find file %q in the step but it is on the whitelist", name)
		}
		path := filepath.Join(problemDir, filepath.FromSlash(name))
		ondisk, err := ioutil.ReadFile(path)
		if err != nil && os.IsNotExist(err) {
			// file is missing; leave it on the list and it will be restored
			found = true
		} else if err != nil {
			log.Fatalf("error reading %s: %v", name, err)
		} else if !bytes.Equal(ondisk, contents) {
			found = true
			if _, exists := listed[name]; !exists {
				// do not reset it, but note that it has changed
				fmt.Printf("file %s has been modified\n", name)
				delete(files, name)
			}
		}
	}

	// update non-student files and student files that were selected
	updateFiles(problemDir, files, nil, true)

	if !found {
		fmt.Println("no student files have been modified since the beginning of this step")
	}
}
