package main

import (
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/codegangsta/cli"
	"github.com/fatih/color"
)

func CommandGrade(context *cli.Context) {
	mustLoadConfig()
	now := time.Now()

	// find the directory
	dir := ""
	switch len(context.Args()) {
	case 0:
		dir = "."
	case 1:
		dir = context.Args().First()
	default:
		cli.ShowSubcommandHelp(context)
		return
	}

	problem, _, commit := gather(now, dir)
	commit.Action = "grade"
	commit.Comment = "grading from grind tool"

	// send the commit to the server
	signed := new(Commit)
	mustPostObject(fmt.Sprintf("/users/me/assignments/%d/commits", commit.AssignmentID), nil, commit, signed)
	commit = signed

	// TODO: get a daycare referral

	// send it to the daycare for grading
	log.Printf("submitting your work for grading")
	commit = mustConfirmCommit(problem, commit, nil)
	log.Printf("  finished grading")
	if commit.ReportCard == nil || commit.Score != 1.0 || !commit.ReportCard.Passed {
		log.Printf("  solution for step %d failed", commit.ProblemStepNumber+1)
		if commit.ReportCard != nil {
			log.Printf("  ReportCard: %s", commit.ReportCard.Message)
		}

		// play the transcript
		for _, event := range commit.Transcript {
			switch event.Event {
			case "exec":
				color.Cyan("$ %s\n", strings.Join(event.ExecCommand, " "))
			case "stdin":
				color.Yellow("%s", event.StreamData)
			case "stdout":
				color.White("%s", event.StreamData)
			case "stderr":
				color.Red("%s", event.StreamData)
			case "exit":
				color.Cyan("%s\n", event.ExitStatus)
			case "error":
				color.Red("Error: %s\n", event.Error)
			}
		}
	}

	// submit the commit with report card
	saved := new(Commit)
	mustPostObject(fmt.Sprintf("/users/me/assignments/%d/commits", commit.AssignmentID), nil, commit, saved)
	commit = saved

	if commit.ReportCard != nil && commit.ReportCard.Passed && commit.Score == 1.0 {
		log.Printf("step %d passed", commit.ProblemStepNumber+1)

		// advance to next step
		if commit.ProblemStepNumber+1 < len(problem.Steps) {
			log.Printf("moving to step %d", commit.ProblemStepNumber+2)
			oldstep := problem.Steps[commit.ProblemStepNumber]
			newstep := problem.Steps[commit.ProblemStepNumber+1]

			// delete all the files from the old step
			for name := range oldstep.Files {
				if len(strings.Split(name, "/")) == 1 {
					continue
				}
				path := filepath.Join(dir, name)
				log.Printf("deleting %s from old step", path)
				if err := os.Remove(path); err != nil {
					log.Fatalf("error deleting %s: %v", path, err)
				}
				dirpath := filepath.Dir(path)
				if err := os.Remove(dirpath); err != nil {
					// do nothing; the directory probably has other files left
				}
			}

			// write files from new step
			for name, contents := range newstep.Files {
				path := filepath.Join(dir, name)
				log.Printf("writing %s from new step", path)
				if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
					log.Fatalf("error creating directory %s: %v", filepath.Dir(path), err)
				}
				if err := ioutil.WriteFile(path, []byte(contents), 0644); err != nil {
					log.Fatalf("error saving file %s: %v", path, err)
				}

				// add the file to the commit as well if it is in the root directory
				if len(strings.Split(name, "/")) == 1 {
					commit.Files[name] = contents
				}
			}

			// update the commit object
			commit.ProblemStepNumber++
			commit.Action = ""
			commit.Comment = "advanced to next step by grind tool"
			commit.Transcript = nil
			commit.ReportCard = nil
			commit.Score = 0.0
			now := time.Now()
			commit.CreatedAt = now
			commit.UpdatedAt = now
			commit.Timestamp = nil
			commit.Signature = ""

			// save this initial commit of the next step
			mustPostObject(fmt.Sprintf("/users/me/assignments/%d/commits", commit.AssignmentID), nil, commit, saved)
			commit = saved
		} else {
			log.Printf("you have completed all steps for this problem")
		}
	}

	saveCommit(dir, commit)
}
