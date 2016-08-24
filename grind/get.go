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

	. "github.com/russross/codegrinder/types"
	"github.com/spf13/cobra"
)

func CommandGet(cmd *cobra.Command, args []string) {
	mustLoadConfig(cmd)

	// parse parameters
	name, rootDir := "", ""
	switch len(args) {
	case 0:
		log.Printf("you must specify the problem set to download")
		log.Fatalf("in the form COURSE/problem-set-id as displayed by \"grind list\"")
	case 1:
		name = args[0]
	case 2:
		name = args[0]
		rootDir = args[1]
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
		// parse the course label and the problem unique id
		parts := strings.Split(name, "/")
		if len(parts) != 2 {
			log.Fatalf("problem name %q must be of form course/problem-id as displayed by \"grind list\"", name)
		}
		label, unique := parts[0], parts[1]

		// find the assignment
		assignmentList := []*Assignment{}
		mustGetObject("/users/me/assignments",
			map[string]string{"course_lti_label": label, "problem_unique": unique},
			&assignmentList)
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

	// get the problem set
	problemSet := new(ProblemSet)
	mustGetObject(fmt.Sprintf("/problem_sets/%d", assignment.ProblemSetID), nil, problemSet)

	// get the list of problems in the problem set
	problemSetProblems := []*ProblemSetProblem{}
	mustGetObject(fmt.Sprintf("/problem_sets/%d/problems", assignment.ProblemSetID), nil, &problemSetProblems)

	// for each problem get the problem, the most recent commit (or create one), and the corresponding step
	commits := make(map[string]*Commit)
	infos := make(map[string]*ProblemInfo)
	problems := make(map[string]*Problem)
	steps := make(map[string]*ProblemStep)
	types := make(map[string]*ProblemType)
	for _, elt := range problemSetProblems {
		problem, commit, info, step := new(Problem), new(Commit), new(ProblemInfo), new(ProblemStep)
		mustGetObject(fmt.Sprintf("/problems/%d", elt.ProblemID), nil, problem)
		problems[problem.Unique] = problem

		// get the problem type if we do not already have it
		if _, exists := types[problem.ProblemType]; !exists {
			problemType := new(ProblemType)
			mustGetObject(fmt.Sprintf("/problem_types/%s", problem.ProblemType), nil, problemType)
			types[problem.ProblemType] = problemType
		}

		if getObject(fmt.Sprintf("/assignments/%d/problems/%d/commits/last", assignment.ID, problem.ID), nil, commit) {
			info.ID = problem.ID
			info.Step = commit.Step
			info.Whitelist = make(map[string]bool)

			// assume whatever was saved last time is an accurate whitelist
			for name := range commit.Files {
				info.Whitelist[name] = true
			}
		} else {
			// if there is no commit for this problem, we're starting from step one
			commit = nil
			info.ID = problem.ID
			info.Step = 1
			info.Whitelist = make(map[string]bool)
		}

		mustGetObject(fmt.Sprintf("/problems/%d/steps/%d", problem.ID, info.Step), nil, step)
		for name := range step.Files {
			// starter files are added to the whitelist
			dir, _ := filepath.Split(name)
			if dir == "" {
				info.Whitelist[name] = true
			}
		}
		infos[problem.Unique] = info
		commits[problem.Unique] = commit
		steps[problem.Unique] = step
	}

	// check if the target directory exists
	if rootDir == "" {
		rootDir = filepath.Join(course.Label, problemSet.Unique)
	}

	if _, err := os.Stat(rootDir); err == nil {
		log.Printf("directory %s already exists", rootDir)
		log.Fatalf("delete it first if you want to re-download the assignment")
	} else if !os.IsNotExist(err) {
		log.Fatalf("error checking if directory %s exists: %v", rootDir, err)
	}

	// create the target directory
	log.Printf("unpacking problem set in %s", rootDir)
	if err := os.MkdirAll(rootDir, 0755); err != nil {
		log.Fatalf("error creating directory %s: %v", rootDir, err)
	}

	for unique := range steps {
		commit, problem, step := commits[unique], problems[unique], steps[unique]

		// create a directory for this problem
		// exception: if there is only one problem in the set, use the main directory
		target := rootDir
		if len(steps) > 1 {
			target = filepath.Join(rootDir, unique)
			log.Printf("unpacking problem %s", unique)
			if err := os.MkdirAll(target, 0755); err != nil {
				log.Fatalf("error creating directory %s: %v", target, err)
			}
		}

		// save the step files
		for name, contents := range step.Files {
			path := filepath.Join(target, name)
			log.Printf("writing step %d file %s", step.Step, name)
			if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
				log.Fatalf("error create directory %s: %v", filepath.Dir(path), err)
			}
			if err := ioutil.WriteFile(path, []byte(contents), 0644); err != nil {
				log.Fatalf("error saving file %s: %v", path, err)
			}
		}

		// commit files overwrite step files
		if commit != nil {
			for name, contents := range commit.Files {
				path := filepath.Join(target, name)
				log.Printf("writing commit file %s", name)
				if err := ioutil.WriteFile(path, []byte(contents), 0644); err != nil {
					log.Fatalf("error saving file %s: %v", path, err)
				}
			}

			// does this commit indicate the step was finished and needs to advance?
			if commit.ReportCard != nil && commit.ReportCard.Passed && commit.Score == 1.0 {
				nextStep(target, infos[unique], problem, commit)
			}
		}

		// save any problem type files
		problemType := types[problem.ProblemType]
		for name, contents := range problemType.Files {
			path := filepath.Join(target, name)
			log.Printf("writing problem type file %s", name)
			if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
				log.Fatalf("error create directory %s: %v", filepath.Dir(path), err)
			}
			if _, err := os.Lstat(path); err == nil {
				log.Fatalf("problem type file would overwrite problem file, quitting: %s", path)
			}
			if err := ioutil.WriteFile(path, []byte(contents), 0644); err != nil {
				log.Fatalf("error saving file %s: %v", path, err)
			}
		}
	}
	dotfile := &DotFileInfo{
		AssignmentID: assignment.ID,
		Problems:     infos,
		Path:         filepath.Join(rootDir, perProblemSetDotFile),
	}
	contents, err := json.MarshalIndent(dotfile, "", "    ")
	if err != nil {
		log.Fatalf("JSON error encoding %s: %v", dotfile.Path, err)
	}
	contents = append(contents, '\n')
	if err := ioutil.WriteFile(dotfile.Path, contents, 0644); err != nil {
		log.Fatalf("error saving file %s: %v", dotfile.Path, err)
	}
}
