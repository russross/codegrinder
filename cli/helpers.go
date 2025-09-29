package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"time"

	. "github.com/russross/codegrinder/rpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// newGRPCClient creates a gRPC client and context for reuse across commands
func newGRPCClient() (CodeGrinderServiceClient, *grpc.ClientConn, context.Context, error) {
	creds := credentials.NewTLS(&tls.Config{InsecureSkipVerify: true})
	conn, err := grpc.Dial(Config.Host+":443", grpc.WithTransportCredentials(creds),
		grpc.WithCompressor(grpc.NewGZIPCompressor()),
		grpc.WithDecompressor(grpc.NewGZIPDecompressor()))
	if err != nil {
		return nil, nil, nil, err
	}
	client := NewCodeGrinderServiceClient(conn)
	ctx := context.Background()
	ctx = metadata.AppendToOutgoingContext(ctx, "cookie", Config.Cookie)
	return client, conn, ctx, nil
}

func nextStep(directory string, info *ProblemInfo, problem *Problem, commit *Commit, types map[string]*ProblemType, client CodeGrinderServiceClient, ctx context.Context) bool {
	fmt.Printf("step %d passed\n", commit.Step)

	// advance to the next step
	oldStep, newStep := new(ProblemStep), new(ProblemStep)
	dumpMessage("GetProblemStep", true, &GetProblemStepRequest{ProblemId: problem.Id, Step: commit.Step + 1})
	newStepResp, err := client.GetProblemStep(ctx, &GetProblemStepRequest{ProblemId: problem.Id, Step: commit.Step + 1})
	if err != nil {
		fmt.Println("you have completed all steps for this problem")
		return false
	}
	dumpMessage("GetProblemStep", false, newStepResp)
	newStep = newStepResp.ProblemStep
	dumpMessage("GetProblemStep", true, &GetProblemStepRequest{ProblemId: problem.Id, Step: commit.Step})
	oldStepResp, err := client.GetProblemStep(ctx, &GetProblemStepRequest{ProblemId: problem.Id, Step: commit.Step})
	if err != nil {
		log.Fatalf("failed to get old step: %v", err)
	}
	oldStep = oldStepResp.ProblemStep
	fmt.Printf("moving to step %d\n", newStep.Step)

	if _, exists := types[oldStep.ProblemType]; !exists {
		dumpMessage("GetProblemType", true, &GetProblemTypeRequest{Name: oldStep.ProblemType})
		problemTypeResp, err := client.GetProblemType(ctx, &GetProblemTypeRequest{Name: oldStep.ProblemType})
		if err != nil {
			log.Fatalf("failed to get problem type: %v", err)
		}
		dumpMessage("GetProblemType", false, problemTypeResp)
		types[oldStep.ProblemType] = problemTypeResp.ProblemType
	}
	if _, exists := types[newStep.ProblemType]; !exists {
		dumpMessage("GetProblemType", true, &GetProblemTypeRequest{Name: newStep.ProblemType})
		problemTypeResp, err := client.GetProblemType(ctx, &GetProblemTypeRequest{Name: newStep.ProblemType})
		if err != nil {
			log.Fatalf("failed to get problem type: %v", err)
		}
		dumpMessage("GetProblemType", false, problemTypeResp)
		types[newStep.ProblemType] = problemTypeResp.ProblemType
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

func gatherStudent(now time.Time, startDir string, client CodeGrinderServiceClient, ctx context.Context) (*ProblemType, *Problem, *ProblemStep, *Assignment, *Commit, *DotFileInfo, string) {

	// find the .grind file containing the problem set info
	dotfile, problemSetDir, problemDir := findDotFile(startDir)

	// get the assignment
	dumpMessage("GetAssignment", true, &GetAssignmentRequest{AssignmentId: dotfile.AssignmentID})
	assignmentResp, err := client.GetAssignment(ctx, &GetAssignmentRequest{AssignmentId: dotfile.AssignmentID})
	if err != nil {
		log.Fatalf("failed to get assignment: %v", err)
	}
	dumpMessage("GetAssignment", false, assignmentResp)
	assignment := assignmentResp.Assignment

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
			log.Fatalf("you must run this from within a specific problem directory")
		}
		_, unique = filepath.Split(problemDir)
	}
	info := dotfile.Problems[unique]
	if info == nil {
		log.Fatalf("unable to recognize the problem based on the directory name of %q", unique)
	}
	dumpMessage("GetProblem", true, &GetProblemRequest{ProblemId: info.ID})
	problemResp, err := client.GetProblem(ctx, &GetProblemRequest{ProblemId: info.ID})
	if err != nil {
		log.Fatalf("failed to get problem: %v", err)
	}
	dumpMessage("GetProblem", false, problemResp)
	problem := problemResp.Problem

	dumpMessage("GetProblemStep", true, &GetProblemStepRequest{ProblemId: problem.Id, Step: info.Step})
	stepResp, err := client.GetProblemStep(ctx, &GetProblemStepRequest{ProblemId: problem.Id, Step: info.Step})
	if err != nil {
		log.Fatalf("failed to get problem step: %v", err)
	}
	dumpMessage("GetProblemStep", false, stepResp)
	step := stepResp.ProblemStep

	dumpMessage("GetProblemType", true, &GetProblemTypeRequest{Name: step.ProblemType})
	problemTypeResp, err := client.GetProblemType(ctx, &GetProblemTypeRequest{Name: step.ProblemType})
	if err != nil {
		log.Fatalf("failed to get problem type: %v", err)
	}
	dumpMessage("GetProblemType", false, problemTypeResp)
	problemType := problemTypeResp.ProblemType

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
		Id:           0,
		AssignmentId: dotfile.AssignmentID,
		ProblemId:    info.ID,
		Step:         info.Step,
		Files:        files,
		CreatedAt:    timestamppb.New(now),
		UpdatedAt:    timestamppb.New(now),
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

func handleDaycareStream(client CodeGrinderServiceClient, conn *grpc.ClientConn, bundle *CommitBundle, args []string, directory string, processEvents bool) (*CommitBundle, error) {
	// Determine the connection to use
	var useClient CodeGrinderServiceClient
	var useConn *grpc.ClientConn
	var ctx context.Context

	if client != nil && conn != nil && bundle.Hostname == Config.Host {
		// Use the passed-in connection
		useClient = client
		useConn = conn
	} else {
		// Create a new connection to the daycare server
		creds := credentials.NewTLS(&tls.Config{InsecureSkipVerify: true})
		var err error
		useConn, err = grpc.Dial(bundle.Hostname+":443", grpc.WithTransportCredentials(creds),
			grpc.WithCompressor(grpc.NewGZIPCompressor()),
			grpc.WithDecompressor(grpc.NewGZIPDecompressor()))
		if err != nil {
			return nil, fmt.Errorf("error connecting to daycare server: %v", err)
		}
		defer useConn.Close()
		useClient = NewCodeGrinderServiceClient(useConn)
	}

	ctx = context.Background()
	ctx = metadata.AppendToOutgoingContext(ctx, "cookie", Config.Cookie)

	// Form the Daycare request
	req := &DaycareRequest{
		CommitBundle: bundle,
		ProblemType:  bundle.ProblemType.Name,
		Action:       bundle.Commit.Action,
		Args:         []string{},
	}
	dumpMessage("Daycare", true, req)

	// Make the streaming Daycare call
	stream, err := useClient.Daycare(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("error starting Daycare session: %v", err)
	}
	dumpMessage("Daycare", false, nil)

	// Listen for streaming responses
	for {
		reply, err := stream.Recv()
		if err == io.EOF {
			log.Print("session closed by server")
			return nil, nil
		} else if err != nil {
			return nil, fmt.Errorf("socket error reading event: %v", err)
		}

		switch {
		case reply.GetError() != "":
			replyError := reply.GetError()
			dumpMessage("Daycare Error", false, replyError)
			return nil, fmt.Errorf("server returned an error: %s", replyError)

		case reply.GetCommitBundle() != nil:
			replyBundle := reply.GetCommitBundle()
			dumpMessage("Daycare CommitBundle", false, replyBundle)
			return replyBundle, nil

		case reply.GetEvent() != nil:
			replyEvent := reply.GetEvent()
			dumpMessage("Daycare Event", false, replyEvent)
			switch replyEvent.Event {
			case "exec", "stdin", "stdout", "exit", "error":
				if processEvents {
					fmt.Printf("%s", reply.GetEvent().Dump())
				}
			case "stderr":
				if processEvents {
					fmt.Printf("%s", reply.GetEvent().Dump())
				}
			case "files":
				if processEvents && directory != "" && replyEvent.Files != nil {
					for name, contents := range replyEvent.Files {
						log.Printf("downloading file %s\r", name)
						if err := ioutil.WriteFile(filepath.Join(directory, filepath.FromSlash(name)), contents, 0644); err != nil {
							return nil, fmt.Errorf("error saving file: %v", err)
						}
					}
				}
			}

		default:
			return nil, fmt.Errorf("unexpected reply from server")
		}
	}

	return nil, fmt.Errorf("no commit returned from server")
}

func getAssignment(assignment *Assignment, rootDir, prettyRoot string, client CodeGrinderServiceClient, ctx context.Context) string {

	// get the course
	dumpMessage("GetCourse", true, &GetCourseRequest{CourseId: assignment.CourseId})
	courseResp, err := client.GetCourse(ctx, &GetCourseRequest{CourseId: assignment.CourseId})
	if err != nil {
		log.Fatalf("failed to get course: %v", err)
	}
	dumpMessage("GetCourse", false, courseResp)
	course := courseResp.Course

	// get the problem set
	dumpMessage("GetProblemSet", true, &GetProblemSetRequest{ProblemSetId: assignment.ProblemSetId})
	problemSetResp, err := client.GetProblemSet(ctx, &GetProblemSetRequest{ProblemSetId: assignment.ProblemSetId})
	if err != nil {
		log.Fatalf("failed to get problem set: %v", err)
	}
	dumpMessage("GetProblemSet", false, problemSetResp)
	problemSet := problemSetResp.ProblemSet

	// get the list of problems in the problem set
	dumpMessage("GetProblemSetProblems", true, &GetProblemSetProblemsRequest{ProblemSetId: assignment.ProblemSetId})
	problemSetProblemsResp, err := client.GetProblemSetProblems(ctx, &GetProblemSetProblemsRequest{ProblemSetId: assignment.ProblemSetId})
	if err != nil {
		log.Fatalf("failed to get problem set problems: %v", err)
	}
	dumpMessage("GetProblemSetProblems", false, problemSetProblemsResp)
	problemSetProblems := problemSetProblemsResp.ProblemSetProblems

	// for each problem get the problem, the most recent commit (or create one), and the corresponding step
	commits := make(map[string]*Commit)
	problems := make(map[string]*Problem)
	steps := make(map[string]*ProblemStep)
	types := make(map[string]*ProblemType)
	problemSteps := make(map[string]int64) // temporary to store step numbers
	for _, elt := range problemSetProblems {
		problem, commit, step := new(Problem), new(Commit), new(ProblemStep)
		dumpMessage("GetProblem", true, &GetProblemRequest{ProblemId: elt.ProblemId})
		problemResp, err := client.GetProblem(ctx, &GetProblemRequest{ProblemId: elt.ProblemId})
		if err != nil {
			log.Fatalf("failed to get problem: %v", err)
		}
		dumpMessage("GetProblem", false, problemResp)
		problem = problemResp.Problem
		problems[problem.Unique] = problem

		dumpMessage("GetAssignmentProblemCommitLast", true, &GetAssignmentProblemCommitLastRequest{AssignmentId: assignment.Id, ProblemId: problem.Id})
		commitResp, err := client.GetAssignmentProblemCommitLast(ctx, &GetAssignmentProblemCommitLastRequest{AssignmentId: assignment.Id, ProblemId: problem.Id})
		if err == nil {
			dumpMessage("GetAssignmentProblemCommitLast", false, commitResp)
			commit = commitResp.Commit
			problemSteps[problem.Unique] = commit.Step
		} else {
			// if there is no commit for this problem, we're starting from step one
			commit = nil
			problemSteps[problem.Unique] = 1
		}

		dumpMessage("GetProblemStep", true, &GetProblemStepRequest{ProblemId: problem.Id, Step: problemSteps[problem.Unique]})
		stepResp, err := client.GetProblemStep(ctx, &GetProblemStepRequest{ProblemId: problem.Id, Step: problemSteps[problem.Unique]})
		if err != nil {
			log.Fatalf("failed to get problem step: %v", err)
		}
		dumpMessage("GetProblemStep", false, stepResp)
		step = stepResp.ProblemStep
		commits[problem.Unique] = commit
		steps[problem.Unique] = step

		// get the problem type if we do not already have it
		if _, exists := types[step.ProblemType]; !exists {
			dumpMessage("GetProblemType", true, &GetProblemTypeRequest{Name: step.ProblemType})
			problemTypeResp, err := client.GetProblemType(ctx, &GetProblemTypeRequest{Name: step.ProblemType})
			if err != nil {
				log.Fatalf("failed to get problem type: %v", err)
			}
			dumpMessage("GetProblemType", false, problemTypeResp)
			types[step.ProblemType] = problemTypeResp.ProblemType
		}
	}

	// build the infos map after all API calls
	infos := make(map[string]*ProblemInfo)
	for unique, problem := range problems {
		info := &ProblemInfo{
			ID:   problem.Id,
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
			if commit.UpdatedAt.AsTime().After(mostRecentTime) {
				// when an instructor is downloading a student assignment,
				// change to the directory for the problem with the most recent commit
				mostRecentTime = commit.UpdatedAt.AsTime()
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
			nextStep(target, infos[unique], problem, commit, types, client, ctx)
		}

	}
	dotfile := &DotFileInfo{
		AssignmentID: assignment.Id,
		Problems:     infos,
		Path:         filepath.Join(rootDir, perProblemSetDotFile),
	}
	saveDotFile(dotfile)
	return changeTo
}

func filterOutFiles(data interface{}) {
	switch v := data.(type) {
	case map[string]interface{}:
		for key, value := range v {
			if key == "files" || key == "solution" {
				if fileMap, ok := value.(map[string]interface{}); ok {
					for k := range fileMap {
						fileMap[k] = "…"
					}
				}
			} else if key == "instructions" {
				v[key] = "…"
			}
			filterOutFiles(value)
		}
	case []interface{}:
		for _, item := range v {
			filterOutFiles(item)
		}
	}
	// Primitives (string, number, bool, null) are ignored.
}

func dumpMessage(call string, isOutgoing bool, msg interface{}) {
	if Config.apiDump {
		raw, err := json.Marshal(msg)
		if err != nil {
			log.Fatalf("json error encoding for processing: %v", err)
		}

		var data interface{}
		err = json.Unmarshal(raw, &data)
		if err != nil {
			log.Fatalf("json error unmarshaling for processing: %v", err)
		}

		filterOutFiles(data)

		indented, err := json.MarshalIndent(data, "", "    ")
		if err != nil {
			log.Fatalf("json error encoding modified data: %v", err)
		}

		if isOutgoing {
			log.Printf("--> %s %s\n", call, indented)
		} else {
			log.Printf("<-- %s %s\n", call, indented)
		}
	} else if Config.apiReport {
		if isOutgoing {
			log.Printf("--> %s\n", call)
		} else {
			log.Printf("<-- %s\n", call)
		}
	}
}
