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

	. "github.com/russross/codegrinder/common"
	"github.com/spf13/cobra"
)

func CommandGet(cmd *cobra.Command, args []string) {
	mustLoadConfig(cmd)

	if len(args) == 0 {
		cmd.Help()
		os.Exit(1)
	} else if len(args) > 1 {
		log.Printf("you must specify the assignment to download")
		log.Printf("   run '%s list' to see your assignments", os.Args[0])
		log.Printf("   you must give the assignment number (displayed on the left of the list)")
		log.Fatalf("   or a name in the form COURSE/problem-set-id (displayed in parentheses)")
	}
	name := args[0]

	user := new(User)
	mustGetObject("/users/me", nil, user)

	var assignment *Assignment
	if id, err := strconv.Atoi(name); err == nil && id > 0 {
		// look it up by ID
		assignment = new(Assignment)
		mustGetObject(fmt.Sprintf("/assignments/%d", id), nil, assignment)
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
	getAssignment(assignment, ".")
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
			if filepath.Dir(filepath.FromSlash(name)) == "." {
				info.Whitelist[name] = true
			}
		}
		infos[problem.Unique] = info
		commits[problem.Unique] = commit
		steps[problem.Unique] = step
	}

	// check if the target directory exists
	rootDir = filepath.Join(rootDir, course.Label, problemSet.Unique)
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
				log.Printf("unpacking problem %s step %d", unique, step.Step)
			} else {
				log.Printf("unpacking problem %s", unique)
			}
			if err := os.MkdirAll(target, 0755); err != nil {
				log.Fatalf("error creating directory %s: %v", target, err)
			}
		} else if step.Step > 1 {
			log.Printf("unpacking step %d", step.Step)
		}

		// save the step files
		for name, contents := range step.Files {
			path := filepath.Join(target, filepath.FromSlash(name))
			//log.Printf("writing step %d file %s", step.Step, name)
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
			//log.Printf("writing instruction file %s", name)
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
				// change to the dir for the problem with the most recent commit
				mostRecentTime = commit.UpdatedAt
				changeTo = target
			}
			for name, contents := range commit.Files {
				path := filepath.Join(target, filepath.FromSlash(name))
				//log.Printf("writing commit file %s", name)
				if err := ioutil.WriteFile(path, contents, 0644); err != nil {
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
			path := filepath.Join(target, filepath.FromSlash(name))
			//log.Printf("writing problem type file %s", name)
			if dir := filepath.Dir(path); dir != "" {
				if err := os.MkdirAll(dir, 0755); err != nil {
					log.Fatalf("error create directory %s: %v", dir, err)
				}
			}
			if _, err := os.Lstat(path); err == nil {
				log.Printf("warning: problem type file is overwriting problem file: %s", path)
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
		if filepath.Dir(filepath.FromSlash(name)) == "." {
			continue
		}
		path := filepath.Join(dir, filepath.FromSlash(name))
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
		path := filepath.Join(dir, filepath.FromSlash(name))
		//log.Printf("writing %s from new step", path)
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			log.Fatalf("error creating directory %s: %v", filepath.Dir(path), err)
		}
		if err := ioutil.WriteFile(path, contents, 0644); err != nil {
			log.Fatalf("error saving file %s: %v", path, err)
		}

		// add the file to the whitelist as well if it is in the root directory
		if filepath.Dir(filepath.FromSlash(name)) == "." {
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
