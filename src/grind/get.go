package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

func CommandGet(cmd *cobra.Command, args []string) {
	mustLoadConfig()
	now := time.Now()

	// parse parameters
	name, target := "", ""
	switch len(args) {
	case 0:
		log.Printf("you must specify the problem to download")
		log.Fatalf("in the form COURSE/problem-id as displayed by \"grind list\"")
	case 1:
		name = args[0]
	case 2:
		name = args[0]
		target = args[1]
	default:
		cmd.Help()
		return
	}

	var assignment *Assignment

	if id, err := strconv.Atoi(name); err == nil && id > 0 {
		// look it up by ID
		assignment = new(Assignment)
		mustGetObject(fmt.Sprintf("/users/me/assignments/%d", id), nil, assignment)
	} else {
		// parse the course label and the problem unique id
		parts := strings.Split(name, "/")
		if len(parts) != 2 {
			log.Fatalf("problem name %q must be of form course/problem-id as displayed by \"grind list\"", name)
		}
		label, unique := parts[0], parts[1]

		// find the assignment
		assignmentList := []*Assignment{}
		mustGetObject("/users/me/assignments", map[string]string{"course_lti_label": label, "problem_unique": unique}, &assignmentList)
		if len(assignmentList) == 0 {
			log.Printf("no matching assignment found")
			log.Fatalf("use \"grind list\" to see available assignments")
		} else if len(assignmentList) != 1 {
			log.Printf("found more than one matching assignment")
			log.Fatalf("try searching by assignment ID instead")
		}
		assignment = assignmentList[0]
	}

	// get the course
	course := new(Course)
	mustGetObject(fmt.Sprintf("/courses/%d", assignment.CourseID), nil, course)

	// get the problem
	problem := new(Problem)
	mustGetObject(fmt.Sprintf("/problems/%d", assignment.ProblemID), nil, problem)

	// check if the target directory exists
	if target == "" {
		target = filepath.Join(course.Label, problem.Unique)
	}

	if _, err := os.Stat(target); err == nil {
		log.Printf("directory %s already exists", target)
		log.Fatalf("delete it first if you want to re-download the assignment")
	} else if !os.IsNotExist(err) {
		log.Fatalf("error checking if directory %s exists: %v", target, err)
	}

	// get the most recent commit (if one exists)
	commit := new(Commit)
	if !getObject(fmt.Sprintf("/users/me/assignments/%d/commits/last", assignment.ID), nil, commit) {
		commit = nil
	}

	// create the target directory
	log.Printf("creating directory %s", target)
	if err := os.MkdirAll(target, 0755); err != nil {
		log.Fatalf("error creating directory %s: %v", target, err)
	}

	// create the files
	stepNumber := 0
	if commit != nil {
		stepNumber = commit.ProblemStepNumber
	}
	step := problem.Steps[stepNumber]
	for name, contents := range step.Files {
		path := filepath.Join(target, name)
		log.Printf("writing step %d file %s", stepNumber+1, path)
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			log.Fatalf("error create directory %s: %v", filepath.Dir(path), err)
		}
		if err := ioutil.WriteFile(path, []byte(contents), 0644); err != nil {
			log.Fatalf("error saving file %s: %v", path, err)
		}
	}
	if commit != nil {
		for name, contents := range commit.Files {
			path := filepath.Join(target, name)
			log.Printf("writing commit file %s", path)
			if err := ioutil.WriteFile(path, []byte(contents), 0644); err != nil {
				log.Fatalf("error saving file %s: %v", path, err)
			}
		}
	}

	// save the commit
	if commit == nil {
		commit = &Commit{
			AssignmentID:      assignment.ID,
			ProblemStepNumber: 0,
			UserID:            assignment.UserID,
			Comment:           "empty commit for new problem",
			Files:             map[string]string{},
			CreatedAt:         now,
			UpdatedAt:         now,
		}
	}
	path := filepath.Join(target, GrindAssignmentIDName)
	contents, err := json.MarshalIndent(commit, "", "    ")
	if err != nil {
		log.Fatalf("JSON error marshalling commit: %v", err)
	}
	contents = append(contents, '\n')
	if err := ioutil.WriteFile(path, contents, 0644); err != nil {
		log.Fatalf("error saving file %s: %v", path, err)
	}
}
