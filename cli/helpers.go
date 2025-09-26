package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/gorilla/websocket"
	. "github.com/russross/codegrinder/types"
)

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

	// gather all the files for the new step
	files := make(map[string][]byte)
	if commit != nil {
		for name, contents := range commit.Files {
			files[filepath.FromSlash(name)] = contents
		}
	}

	// commit files may be overwritten by new step files
	for name, contents := range newStep.Files {
		files[filepath.FromSlash(name)] = contents
	}
	files[filepath.Join("doc", "index.html")] = []byte(newStep.Instructions)
	for name, contents := range types[newStep.ProblemType].Files {
		if _, exists := files[filepath.FromSlash(name)]; exists {
			fmt.Printf("warning: problem type file is overwriting problem file: %s\n", name)
		}
		files[filepath.FromSlash(name)] = contents
	}

	// files from the old problem type and old step may need to be removed
	oldFiles := make(map[string]struct{})
	for name := range types[oldStep.ProblemType].Files {
		oldFiles[filepath.FromSlash(name)] = struct{}{}
	}
	for name := range oldStep.Files {
		oldFiles[filepath.FromSlash(name)] = struct{}{}
	}

	updateFiles(directory, files, oldFiles, false)

	info.Step++
	return true
}

func updateFiles(directory string, files map[string][]byte, oldFiles map[string]struct{}, chatty bool) {
	for name, contents := range files {
		path := filepath.Join(directory, name)
		ondisk, err := ioutil.ReadFile(path)
		if err != nil && os.IsNotExist(err) {
			if chatty {
				fmt.Printf("saving file:   %s\n", name)
			}
			if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
				log.Fatalf("error creating directory %s: %v", filepath.Dir(path), err)
			}
			if err := ioutil.WriteFile(path, contents, 0644); err != nil {
				log.Fatalf("error saving %s: %v", name, err)
			}
		} else if err != nil {
			log.Fatalf("error reading %s: %v", name, err)
		} else if !bytes.Equal(ondisk, contents) {
			if chatty {
				fmt.Printf("updating file: %s\n", name)
			}
			if err := ioutil.WriteFile(path, contents, 0644); err != nil {
				log.Fatalf("error saving %s: %v", name, err)
			}
		}
	}

	if oldFiles == nil {
		return
	}
	for name := range oldFiles {
		if _, exists := files[name]; exists {
			continue
		}
		path := filepath.Join(directory, name)
		if _, err := os.Stat(path); err == nil {
			if chatty {
				fmt.Printf("removing file: %s\n", name)
			}
			if err := os.Remove(path); err != nil {
				log.Fatalf("error deleting %s: %v", name, err)
			}
		}
		dirpath := filepath.Dir(name)
		if dirpath != "." {
			if err := os.Remove(filepath.Join(directory, dirpath)); err != nil {
				// do nothing: the directory probably has other files left
			}
		}
	}
}

func gatherStudent(now time.Time, startDir string) (*ProblemType, *Problem, *ProblemStep, *Assignment, *Commit, *DotFileInfo, string) {
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

	step := new(ProblemStep)
	mustGetObject(fmt.Sprintf("/problems/%d/steps/%d", problem.ID, info.Step), nil, step)

	problemType := new(ProblemType)
	mustGetObject(fmt.Sprintf("/problem_types/%s", step.ProblemType), nil, problemType)

	// make sure all step and problem type files are up to date
	stepFiles := make(map[string][]byte)
	for name, contents := range step.Files {
		// do not overwrite student files
		if _, exists := step.Whitelist[name]; !exists {
			stepFiles[filepath.FromSlash(name)] = contents
		}
	}
	for name, contents := range problemType.Files {
		stepFiles[filepath.FromSlash(name)] = contents
	}
	stepFiles[filepath.Join("doc", "index.html")] = []byte(step.Instructions)
	updateFiles(problemDir, stepFiles, nil, true)

	// gather the commit files from the file system
	files := make(map[string][]byte)
	var missing []string
	for name := range step.Whitelist {
		path := filepath.Join(problemDir, filepath.FromSlash(name))
		contents, err := ioutil.ReadFile(path)
		if err != nil {
			// the error will be reported below as a missing file
			missing = append(missing, name)
			continue
		}
		files[name] = contents
	}
	if len(missing) > 0 {
		log.Print("did not find all the expected files")
		for _, name := range missing {
			log.Printf("  %s not found", name)
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

	return problemType, problem, step, assignment, commit, dotfile, problemDir
}

func findDotFile(startDir string) (dotfile *DotFileInfo, problemSetDir, problemDir string) {
	abs := false
	problemSetDir, problemDir = startDir, ""
	for {
		path := filepath.Join(problemSetDir, perProblemSetDotFile)
		_, err := os.Stat(path)
		if err == nil {
			break
		}
		if !os.IsNotExist(err) {
			log.Fatalf("error searching for %s in %s: %v", perProblemSetDotFile, problemSetDir, err)
		}
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
		// fmt.Printf("could not find %s in %s, trying %s\n", perProblemSetDotFile, problemDir, problemSetDir)
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

func saveDotFile(dotfile *DotFileInfo) {
	contents, err := json.MarshalIndent(dotfile, "", "    ")
	if err != nil {
		log.Fatalf("JSON error encoding %s: %v", dotfile.Path, err)
	}
	contents = append(contents, '\n')
	if err := ioutil.WriteFile(dotfile.Path, contents, 0644); err != nil {
		log.Fatalf("error saving file %s: %v", dotfile.Path, err)
	}
}

func mustConfirmCommitBundle(bundle *CommitBundle, args []string) *CommitBundle {
	// create a websocket connection to the server
	headers := make(http.Header)
	url := "wss://" + bundle.Hostname + "/sockets/" + bundle.ProblemType.Name + "/" + bundle.Commit.Action
	socket, resp, err := websocket.DefaultDialer.Dial(url, headers)
	if err != nil {
		log.Printf("error dialing %s: %v", url, err)
		if resp != nil && resp.Body != nil {
			dumpBody(resp)
			resp.Body.Close()
		}
		log.Fatalf("giving up")
	}
	defer socket.Close()

	// form the initial request
	req := &DaycareRequest{CommitBundle: bundle}
	if err := socket.WriteJSON(req); err != nil {
		log.Fatalf("error writing request message: %v", err)
	}

	// start listening for events
	for {
		reply := new(DaycareResponse)
		if err := socket.ReadJSON(reply); err != nil {
			log.Fatalf("socket error reading event: %v", err)
			break
		}

		switch {
		case reply.Error != "":
			log.Printf("server returned an error:")
			log.Fatalf("   %s", reply.Error)

		case reply.CommitBundle != nil:
			return reply.CommitBundle

		case reply.Event != nil:
			// ignore the streamed data

		default:
			log.Fatalf("unexpected reply from server")
		}
	}

	log.Fatalf("no commit returned from server")
	return nil
}

func getAssignment(assignment *Assignment, rootDir, prettyRoot string) string {
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
	problems := make(map[string]*Problem)
	steps := make(map[string]*ProblemStep)
	types := make(map[string]*ProblemType)
	problemSteps := make(map[string]int64) // temporary to store step numbers
	for _, elt := range problemSetProblems {
		problem, commit, step := new(Problem), new(Commit), new(ProblemStep)
		mustGetObject(fmt.Sprintf("/problems/%d", elt.ProblemID), nil, problem)
		problems[problem.Unique] = problem

		if getObject(fmt.Sprintf("/assignments/%d/problems/%d/commits/last", assignment.ID, problem.ID), nil, commit) {
			problemSteps[problem.Unique] = commit.Step
		} else {
			// if there is no commit for this problem, we're starting from step one
			commit = nil
			problemSteps[problem.Unique] = 1
		}

		mustGetObject(fmt.Sprintf("/problems/%d/steps/%d", problem.ID, problemSteps[problem.Unique]), nil, step)
		commits[problem.Unique] = commit
		steps[problem.Unique] = step

		// get the problem type if we do not already have it
		if _, exists := types[step.ProblemType]; !exists {
			problemType := new(ProblemType)
			mustGetObject(fmt.Sprintf("/problem_types/%s", step.ProblemType), nil, problemType)
			types[step.ProblemType] = problemType
		}
	}

	// build the infos map after all API calls
	infos := make(map[string]*ProblemInfo)
	for unique, problem := range problems {
		info := &ProblemInfo{
			ID:   problem.ID,
			Step: problemSteps[unique],
		}
		infos[unique] = info
	}

	// check if the target directory exists
	rootDir = filepath.Join(rootDir, courseDirectory(course.Label), problemSet.Unique)
	prettyRoot = filepath.Join(prettyRoot, courseDirectory(course.Label), problemSet.Unique)
	if _, err := os.Stat(rootDir); err == nil {
		log.Printf("directory %s already exists", prettyRoot)
		log.Fatalf("delete it first if you want to re-download the assignment")
	} else if !os.IsNotExist(err) {
		log.Fatalf("error checking if directory %s exists: %v", prettyRoot, err)
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
