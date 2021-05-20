package main

import (
	"fmt"
	"io/ioutil"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	. "github.com/russross/codegrinder/types"
	"github.com/spf13/cobra"
)

func CommandGet(cmd *cobra.Command, args []string) {
	mustLoadConfig(cmd)

	rootDir, err := os.UserHomeDir()
	if err != nil {
		log.Fatalf("unable to find home directory: %v", err)
	}

	if len(args) == 0 {
		cmd.Help()
		os.Exit(1)
	} else if len(args) > 2 {
		log.Printf("you must specify the assignment to download")
		log.Printf("   run '%s list' to see your assignments", os.Args[0])
		log.Printf("   you must give the assignment number (displayed on the left of the list)")
		log.Fatalf("   or a name in the form COURSE/problem-set-id (displayed in parentheses)")
	}
	name := args[0]
	if len(args) == 2 {
		rootDir = args[1]
	}

	user := new(User)
	mustGetObject("/users/me", nil, user)

	var assignment *Assignment
	if id, err := strconv.Atoi(name); err == nil && id > 0 {
		// look it up by ID
		assignment = new(Assignment)
		mustGetObject(fmt.Sprintf("/assignments/%d", id), nil, assignment)
		if assignment.ProblemSetID < 1 {
			log.Fatalf("cannot download quiz assignments")
		}
	} else {
		// parse the course label and the problem unique id
		parts := strings.Split(name, "/")
		if len(parts) != 2 {
			log.Printf("unknown assignment identifier")
			log.Printf("   run '%s get [id]'", os.Args[0])
			log.Printf("   or  '%s get [course/problem-id]'", os.Args[0])
			log.Fatalf("   [id] and [course/problem-id] can be found using '%s list'", os.Args[0])
		}
		label, unique := parts[0], parts[1]

		// find the assignment
		assignmentList := []*Assignment{}
		params := make(url.Values)
		params.Add("course_lti_label", label)
		params.Add("problem_unique", unique)
		mustGetObject(fmt.Sprintf("/users/%d/assignments", user.ID), params, &assignmentList)
		assignmentList = filterOutQuizzes(assignmentList)
		if len(assignmentList) == 0 {
			log.Printf("no matching assignment found")
			log.Printf("   run '%s get [id]'", os.Args[0])
			log.Printf("   or  '%s get [course/problem-id]'", os.Args[0])
			log.Fatalf("   [id] and [course/problem-id] can be found using '%s list'", os.Args[0])
		} else if len(assignmentList) != 1 {
			log.Printf("found more than one matching assignment")
			log.Printf("   run '%s get [id]' instead", os.Args[0])
			log.Fatalf("   [id] can be found using '%s list'", os.Args[0])
		}
		assignment = assignmentList[0]
	}
	if assignment.UserID != user.ID {
		log.Fatalf("you do not have an assignment with number %d", assignment.ID)
	}
	getAssignment(assignment, rootDir)
}

func getAssignment(assignment *Assignment, rootDir string) string {
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

		if getObject(fmt.Sprintf("/assignments/%d/problems/%d/commits/last", assignment.ID, problem.ID), nil, commit) {
			info.ID = problem.ID
			info.Step = commit.Step
		} else {
			// if there is no commit for this problem, we're starting from step one
			commit = nil
			info.ID = problem.ID
			info.Step = 1
		}

		mustGetObject(fmt.Sprintf("/problems/%d/steps/%d", problem.ID, info.Step), nil, step)
		infos[problem.Unique] = info
		commits[problem.Unique] = commit
		steps[problem.Unique] = step

		// get the problem type if we do not already have it
		if _, exists := types[step.ProblemType]; !exists {
			problemType := new(ProblemType)
			mustGetObject(fmt.Sprintf("/problem_types/%s", step.ProblemType), nil, problemType)
			types[step.ProblemType] = problemType
		}

	}

	// check if the target directory exists
	rootDir = filepath.Join(rootDir, courseDirectory(course.Label), problemSet.Unique)
	if _, err := os.Stat(rootDir); err == nil {
		log.Printf("directory %s already exists", rootDir)
		log.Fatalf("delete it first if you want to re-download the assignment")
	} else if !os.IsNotExist(err) {
		log.Fatalf("error checking if directory %s exists: %v", rootDir, err)
	}

	// create the target directory
	fmt.Printf("unpacking problem set in %s\n", rootDir)
	if err := os.MkdirAll(rootDir, 0755); err != nil {
		log.Fatalf("error creating directory %s: %v", rootDir, err)
	}

	mostRecentTime := time.Time{}
	changeTo := rootDir
	for unique := range steps {
		commit, problem, step := commits[unique], problems[unique], steps[unique]

		// create a directory for this problem
		// exception: if there is only one problem in the set, use the main directory
		target := rootDir
		if len(steps) > 1 {
			target = filepath.Join(rootDir, unique)

			if step.Step > 1 {
				fmt.Printf("unpacking problem %s step %d\n", unique, step.Step)
			} else {
				fmt.Printf("unpacking problem %s\n", unique)
			}
			if err := os.MkdirAll(target, 0755); err != nil {
				log.Fatalf("error creating directory %s: %v", target, err)
			}
		} else if step.Step > 1 {
			fmt.Printf("unpacking step %d\n", step.Step)
		}

		// save the step files
		for name, contents := range step.Files {
			path := filepath.Join(target, filepath.FromSlash(name))
			//fmt.Printf("writing step %d file %s\n", step.Step, name)
			if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
				log.Fatalf("error create directory %s: %v", filepath.Dir(path), err)
			}
			if err := ioutil.WriteFile(path, contents, 0644); err != nil {
				log.Fatalf("error saving file %s: %v", path, err)
			}
		}

		// save the doc file
		if len(step.Instructions) > 0 {
			name := filepath.Join("doc", "index.html")
			path := filepath.Join(target, name)
			//fmt.Printf("writing instruction file %s\n", name)
			if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
				log.Fatalf("error create directory %s: %v", filepath.Dir(path), err)
			}
			if err := ioutil.WriteFile(path, []byte(step.Instructions), 0644); err != nil {
				log.Fatalf("error saving file %s: %v", name, err)
			}
		}

		// commit files overwrite step files
		if commit != nil {
			if commit.UpdatedAt.After(mostRecentTime) {
				// when an instructor is downloading a student assignment,
				// change to the directory for the problem with the most recent commit
				mostRecentTime = commit.UpdatedAt
				changeTo = target
			}
			for name, contents := range commit.Files {
				path := filepath.Join(target, filepath.FromSlash(name))
				//fmt.Printf("writing commit file %s\n", name)
				if err := ioutil.WriteFile(path, contents, 0644); err != nil {
					log.Fatalf("error saving file %s: %v", path, err)
				}
			}

			// does this commit indicate the step was finished and needs to advance?
			if commit.ReportCard != nil && commit.ReportCard.Passed && commit.Score == 1.0 {
				nextStep(target, infos[unique], problem, commit, types)
			}
		}

		// save any problem type files
		problemType := types[step.ProblemType]
		for name, contents := range problemType.Files {
			path := filepath.Join(target, filepath.FromSlash(name))
			//fmt.Printf("writing problem type file %s\n", name)
			if directory := filepath.Dir(path); directory != "." {
				if err := os.MkdirAll(directory, 0755); err != nil {
					log.Fatalf("error create directory %s: %v", directory, err)
				}
			}
			if _, err := os.Lstat(path); err == nil {
				fmt.Printf("warning: problem type file is overwriting problem file: %s\n", path)
			}
			if err := ioutil.WriteFile(path, contents, 0644); err != nil {
				log.Fatalf("error saving file %s: %v", path, err)
			}
		}
	}
	dotfile := &DotFileInfo{
		AssignmentID: assignment.ID,
		Problems:     infos,
		Path:         filepath.Join(rootDir, perProblemSetDotFile),
	}
	saveDotFile(dotfile)
	return changeTo
}

func nextStep(directory string, info *ProblemInfo, problem *Problem, commit *Commit, types map[string]*ProblemType) bool {
	fmt.Printf("step %d passed\n", commit.Step)

	// advance to the next step
	oldStep, newStep := new(ProblemStep), new(ProblemStep)
	if !getObject(fmt.Sprintf("/problems/%d/steps/%d", problem.ID, commit.Step+1), nil, newStep) {
		fmt.Println("you have completed all steps for this problem")
		return false
	}
	mustGetObject(fmt.Sprintf("/problems/%d/steps/%d", problem.ID, commit.Step), nil, oldStep)
	fmt.Printf("moving to step %d\n", newStep.Step)

	if _, exists := types[oldStep.ProblemType]; !exists {
		problemType := new(ProblemType)
		mustGetObject(fmt.Sprintf("/problem_types/%s", oldStep.ProblemType), nil, problemType)
		types[oldStep.ProblemType] = problemType
	}
	if _, exists := types[newStep.ProblemType]; !exists {
		problemType := new(ProblemType)
		mustGetObject(fmt.Sprintf("/problem_types/%s", newStep.ProblemType), nil, problemType)
		types[newStep.ProblemType] = problemType
	}

	remove := func(name string) {
		path := filepath.Join(directory, name)
		if err := os.Remove(path); err != nil {
			log.Fatalf("error deleting %s: %v", name, err)
		}
		dirpath := filepath.Dir(name)
		if dirpath != "." {
			if err := os.Remove(filepath.Join(directory, dirpath)); err != nil {
				// do nothing: the directory probably has other files left
			}
		}
	}

	// delete all the files from the old step
	if oldStep.ProblemType != newStep.ProblemType {
		for name := range types[oldStep.ProblemType].Files {
			remove(filepath.FromSlash(name))
		}
	}
	if len(oldStep.Instructions) > 0 {
		remove(filepath.Join("doc", "index.html"))
	}
	for name := range oldStep.Files {
		remove(filepath.FromSlash(name))
	}

	create := func(name string, contents []byte) {
		path := filepath.Join(directory, name)
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			log.Fatalf("error creating directory %s: %v", filepath.Dir(path), err)
		}
		if _, err := os.Lstat(path); err == nil {
			fmt.Printf("warning: overwriting file: %s\n", path)
		}
		if err := ioutil.WriteFile(path, contents, 0644); err != nil {
			log.Fatalf("error saving file %s: %v", path, err)
		}
	}

	// write files from new step
	if oldStep.ProblemType != newStep.ProblemType {
		// add the files provided by the new problem type
		for name, contents := range types[oldStep.ProblemType].Files {
			create(filepath.FromSlash(name), contents)
		}
	}
	if len(newStep.Instructions) > 0 {
		create(filepath.Join("doc", "index.html"), []byte(newStep.Instructions))
	}
	for name, contents := range newStep.Files {
		create(filepath.FromSlash(name), contents)
	}
	for name, contents := range commit.Files {
		create(filepath.FromSlash(name), contents)
	}

	info.Step++
	return true
}
