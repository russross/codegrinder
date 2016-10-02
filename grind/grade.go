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

func CommandGrade(cmd *cobra.Command, args []string) {
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

	_, problem, _, commit, dotfile := gather(now, dir)
	commit.Action = "grade"
	commit.Note = "grading from grind tool"
	unsigned := &CommitBundle{
		UserID: user.ID,
		Commit: commit,
	}

	// send the commit bundle to the server
	signed := new(CommitBundle)
	mustPostObject("/commit_bundles/unsigned", nil, unsigned, signed)

	// send it to the daycare for grading
	if signed.Hostname == "" {
		log.Fatalf("server was unable to find a suitable daycare, unable to grade")
	}
	log.Printf("submitting %s step %d for grading", problem.Unique, commit.Step)
	graded := mustConfirmCommitBundle(signed, nil)

	// save the commit with report card
	toSave := &CommitBundle{
		Hostname:        graded.Hostname,
		UserID:          graded.UserID,
		Commit:          graded.Commit,
		CommitSignature: graded.CommitSignature,
	}
	saved := new(CommitBundle)
	mustPostObject("/commit_bundles/signed", nil, toSave, saved)
	commit = saved.Commit

	if commit.ReportCard != nil && commit.ReportCard.Passed && commit.Score == 1.0 {
		if nextStep(dir, dotfile.Problems[problem.Unique], problem, commit) {
			// save the updated dotfile with whitelist updates and new step number
			contents, err := json.MarshalIndent(dotfile, "", "    ")
			if err != nil {
				log.Fatalf("JSON error encoding %s: %v", dotfile.Path, err)
			}
			contents = append(contents, '\n')
			if err := ioutil.WriteFile(dotfile.Path, contents, 0644); err != nil {
				log.Fatalf("error saving file %s: %v", dotfile.Path, err)
			}
		}
	} else {
		// solution failed
		log.Printf("  solution for step %d failed", commit.Step)
		if commit.ReportCard != nil {
			log.Printf("  ReportCard: %s", commit.ReportCard.Note)
		}

		// play the transcript
		if err := commit.DumpTranscript(os.Stdout); err != nil {
			log.Fatalf("failed to dump transcript: %v", err)
		}
	}
}

func nextStep(dir string, info *ProblemInfo, problem *Problem, commit *Commit) bool {
	log.Printf("step %d passed", commit.Step)

	// advance to the next step
	oldStep, newStep := new(ProblemStep), new(ProblemStep)
	if !getObject(fmt.Sprintf("/problems/%d/steps/%d", problem.ID, commit.Step+1), nil, newStep) {
		log.Printf("you have completed all steps for this problem")
		return false
	}
	mustGetObject(fmt.Sprintf("/problems/%d/steps/%d", problem.ID, commit.Step), nil, oldStep)
	log.Printf("moving to step %d", newStep.Step)

	// delete all the files from the old step
	if len(oldStep.Instructions) > 0 {
		// TODO: temporary while index.html moves to doc dir
		name := "index.html"
		path := filepath.Join(dir, name)
		if _, err := os.Stat(path); err == nil {
			//log.Printf("deleting %s from old step", name)
			if err := os.Remove(path); err != nil {
				log.Fatalf("error deleting %s: %v", name, err)
			}
		}
		name = filepath.Join("doc", "index.html")
		path = filepath.Join(dir, name)
		if _, err := os.Stat(path); err == nil {
			//log.Printf("deleting %s from old step", name)
			if err := os.Remove(path); err != nil {
				log.Fatalf("error deleting %s: %v", name, err)
			}
		}
	}
	for name := range oldStep.Files {
		if len(strings.Split(name, "/")) == 1 {
			continue
		}
		path := filepath.Join(dir, name)
		//log.Printf("deleting %s from old step", path)
		if err := os.Remove(path); err != nil {
			log.Fatalf("error deleting %s: %v", path, err)
		}
		dirpath := filepath.Dir(path)
		if err := os.Remove(dirpath); err != nil {
			// do nothing; the directory probably has other files left
		}
	}

	// write files from new step and update the whitelist
	for name, contents := range newStep.Files {
		path := filepath.Join(dir, name)
		//log.Printf("writing %s from new step", path)
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			log.Fatalf("error creating directory %s: %v", filepath.Dir(path), err)
		}
		if err := ioutil.WriteFile(path, []byte(contents), 0644); err != nil {
			log.Fatalf("error saving file %s: %v", path, err)
		}

		// add the file to the whitelist as well if it is in the root directory
		if len(strings.Split(name, "/")) == 1 {
			info.Whitelist[name] = true
		}
	}
	if len(newStep.Instructions) > 0 {
		name := filepath.Join("doc", "index.html")
		path := filepath.Join(dir, name)
		//log.Printf("writing %s from new step", name)
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			log.Fatalf("error creating directory %s: %v", filepath.Dir(path), err)
		}
		if err := ioutil.WriteFile(path, []byte(newStep.Instructions), 0644); err != nil {
			log.Fatalf("error saving file %s: %v", path, err)
		}
	}

	info.Step++
	return true
}
