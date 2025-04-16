package main

import (
	"fmt"
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
	prettyRoot := "~"

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
		prettyRoot = rootDir
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
	getAssignment(assignment, rootDir, prettyRoot)
}

func getAssignment(assignment *Assignment, rootDir, prettyRoot string) string {
	// get the course
	course := new(Course)
	mustGetObject(fmt.Sprintf("/courses/%d", assignment.CourseID), nil, course)

	// get the problem set
	problemSet := new(ProblemSet)
	mustGetObject(fmt.Sprintf("/problem_sets/%d", assignment.ProblemSetID), nil, problemSet)

	// check if the target directory exists
	rootDir = filepath.Join(rootDir, courseDirectory(course.Label), problemSet.Unique)
	prettyRoot = filepath.Join(prettyRoot, courseDirectory(course.Label), problemSet.Unique)
	if _, err := os.Stat(rootDir); err == nil {
		log.Printf("directory %s already exists", prettyRoot)
		log.Fatalf("delete it first if you want to re-download the assignment")
	} else if !os.IsNotExist(err) {
		log.Fatalf("error checking if directory %s exists: %v", prettyRoot, err)
	}

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

	fmt.Printf("unpacking problem set in %s\n", prettyRoot)

	mostRecentTime := time.Time{}
	changeTo := rootDir
	for unique := range steps {
		commit, problem, step := commits[unique], problems[unique], steps[unique]

		// if there is only one problem in the set, use the main directory
		target := rootDir
		if len(steps) > 1 {
			target = filepath.Join(rootDir, unique)

			if step.Step > 1 {
				fmt.Printf("unpacking problem %s step %d\n", unique, step.Step)
			} else {
				fmt.Printf("unpacking problem %s\n", unique)
			}
		} else if step.Step > 1 {
			fmt.Printf("unpacking step %d\n", step.Step)
		}

		// save the step files
		files := make(map[string][]byte)
		for name, contents := range step.Files {
			files[filepath.FromSlash(name)] = contents
		}
		files[filepath.Join("doc", "index.html")] = []byte(step.Instructions)

		// step files may be overwritten by commit files
		if commit != nil {
			if commit.UpdatedAt.After(mostRecentTime) {
				// when an instructor is downloading a student assignment,
				// change to the directory for the problem with the most recent commit
				mostRecentTime = commit.UpdatedAt
				changeTo = target
			}
			for name, contents := range commit.Files {
				files[filepath.FromSlash(name)] = contents
			}
		}

		// save problem type files
		for name, contents := range types[step.ProblemType].Files {
			if _, exists := files[filepath.FromSlash(name)]; exists {
				fmt.Printf("warning: problem type file is overwriting problem file: %s\n", filepath.Join(target, filepath.FromSlash(name)))
			}
			files[filepath.FromSlash(name)] = contents
		}

		updateFiles(target, files, nil, false)

		// does this commit indicate the step was finished and needs to advance?
		if commit != nil && commit.ReportCard != nil && commit.ReportCard.Passed && commit.Score == 1.0 {
			nextStep(target, infos[unique], problem, commit, types)
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
