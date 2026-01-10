package main

import (
	"context"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	. "github.com/russross/codegrinder/rpc"
	"github.com/spf13/cobra"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gopkg.in/gcfg.v1"
)

func parseGitignore(content string) []string {
	lines := strings.Split(content, "\n")
	var patterns []string
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		patterns = append(patterns, line)
	}
	return patterns
}

func isIgnored(path string, patterns []string) bool {
	for _, pattern := range patterns {
		if matchPattern(pattern, path) {
			return true
		}
	}
	return false
}

func matchPattern(pattern, path string) bool {
	if strings.HasSuffix(pattern, "/") {
		// directory pattern
		dirPattern := strings.TrimSuffix(pattern, "/")
		return strings.HasPrefix(path, dirPattern+"/") || path == dirPattern
	} else if strings.HasPrefix(pattern, "*") {
		// suffix match
		suffix := strings.TrimPrefix(pattern, "*")
		return strings.HasSuffix(path, suffix)
	} else {
		// exact match
		return path == pattern
	}
}

const ProblemConfigName string = "problem.cfg"

type ConfigFile struct {
	Problem struct {
		Unique string
		Note   string
		Type   string
		Tag    []string
		Option []string
	}
	Step map[string]*struct {
		Note   string
		Type   string
		Weight float64
	}
}

func CommandCreate(cmd *cobra.Command, args []string) {
	client, conn, ctx, user, err := setup(cmd)
	if err != nil {
		log.Fatalf("failed to connect to gRPC server: %s", cleanError(err))
	}
	defer conn.Close()

	pset := ""

	if len(args) == 1 {
		// create problem set
		pset = args[0]
	} else if len(args) != 0 {
		cmd.Help()
		os.Exit(1)
	}

	action := cmd.Flag("action").Value.String()
	isUpdate := cmd.Flag("update").Value.String() == "true"

	// branch off for problem set creation
	// the rest of this function is for problems
	if pset != "" {
		if action != "" {
			log.Fatalf("you cannot specify an action when creating a problem set")
		}
		createProblemSet(pset, isUpdate, client, ctx)
		return
	}

	now := time.Now()
	if isUpdate && action != "" {
		log.Fatalf("you specified --update, which is not valid when running an action")
	}

	unsigned, stepDir, step := gatherAuthor(now, isUpdate, action, ".", client, ctx)

	unsigned.UserId = user.Id

	// get the request validated and signed
	dumpMessage("PostProblemBundleUnconfirmed", true, &PostProblemBundleUnconfirmedRequest{Bundle: unsigned})
	signedResp, err := client.PostProblemBundleUnconfirmed(ctx, &PostProblemBundleUnconfirmedRequest{Bundle: unsigned})
	if err != nil {
		log.Fatalf("failed to post problem bundle unconfirmed: %s", cleanError(err))
	}
	dumpMessage("PostProblemBundleUnconfirmed", false, signedResp)
	signed := signedResp.Bundle

	if signed.Hostname == "" {
		log.Fatalf("server was unable to find a suitable daycare, unable to validate")
	}

	// run an interactive action for a single step?
	if action != "" {
		if step < 1 {
			log.Fatalf("to use --action, you must run from within a step directory")
		}
		fmt.Printf("running interactive session for action %q on step %d\n", action, step)

		// run the interactive action for a single step instead
		// of validating all steps
		unvalidated := &CommitBundle{
			ProblemType:          signed.ProblemTypes[signed.ProblemSteps[step-1].ProblemType],
			ProblemTypeSignature: signed.ProblemTypeSignatures[signed.ProblemSteps[step-1].ProblemType],
			Problem:              signed.Problem,
			ProblemSteps:         signed.ProblemSteps,
			ProblemSignature:     signed.ProblemSignature,
			Hostname:             signed.Hostname,
			UserId:               signed.UserId,
			Commit:               signed.Commits[step-1],
			CommitSignature:      signed.CommitSignatures[step-1],
		}

		// call handleDaycareStream in interactive mode
		if _, err := handleDaycareStream(client, conn, unvalidated, nil, stepDir, true); err != nil {
			log.Fatalf("interactive session failed: %s", cleanError(err))
		}
		return
	}

	// validate the commits one at a time
	for n := 0; n < len(signed.ProblemSteps); n++ {
		fmt.Printf("validating solution for step %d\n", n+1)
		unvalidated := &CommitBundle{
			ProblemType:          signed.ProblemTypes[signed.ProblemSteps[n].ProblemType],
			ProblemTypeSignature: signed.ProblemTypeSignatures[signed.ProblemSteps[n].ProblemType],
			Problem:              signed.Problem,
			ProblemSteps:         signed.ProblemSteps,
			ProblemSignature:     signed.ProblemSignature,
			Hostname:             signed.Hostname,
			UserId:               signed.UserId,
			Commit:               signed.Commits[n],
			CommitSignature:      signed.CommitSignatures[n],
		}
		// call handleDaycareStream in non-interactive mode
		validated, err := handleDaycareStream(client, conn, unvalidated, nil, "", false)
		if err != nil {
			log.Fatalf("failed to validate the step: %s", cleanError(err))
		}
		if validated == nil {
			log.Fatalf("the server ended the connection without sending a report card")
		}
		fmt.Println("  finished validating solution")
		if validated.Commit.ReportCard == nil || validated.Commit.Score != 1.0 || !validated.Commit.ReportCard.Passed {
			fmt.Printf("  solution for step %d failed: %s\n", n+1, validated.Commit.ReportCard.Note)

			// play the transcript
			if err := validated.Commit.DumpTranscript(os.Stdout); err != nil {
				log.Fatalf("failed to dump transcript: %s", cleanError(err))
			}
			log.Fatalf("please fix solution and try again")
		}
		signed.ProblemTypes[validated.ProblemType.Name] = validated.ProblemType
		signed.ProblemTypeSignatures[validated.ProblemType.Name] = validated.ProblemTypeSignature
		signed.Problem = validated.Problem
		signed.ProblemSteps = validated.ProblemSteps
		signed.ProblemSignature = validated.ProblemSignature
		signed.Commits[n] = validated.Commit
		signed.CommitSignatures[n] = validated.CommitSignature
	}

	fmt.Println("problem and solution confirmed successfully")

	// save the problem
	final := new(ProblemBundle)
	if signed.Problem.Id == 0 {
		dumpMessage("PostProblemBundleConfirmed", true, &PostProblemBundleConfirmedRequest{Bundle: signed})
		finalResp, err := client.PostProblemBundleConfirmed(ctx, &PostProblemBundleConfirmedRequest{Bundle: signed})
		if err != nil {
			log.Fatalf("failed to post problem bundle confirmed: %s", cleanError(err))
		}
		dumpMessage("PostProblemBundleConfirmed", false, finalResp)
		final = finalResp.Bundle
		fmt.Printf("problem %q created and ready to use\n", final.Problem.Unique)
	} else {
		dumpMessage("PutProblemBundle", true, &PutProblemBundleRequest{ProblemId: signed.Problem.Id, Bundle: signed})
		finalResp, err := client.PutProblemBundle(ctx, &PutProblemBundleRequest{ProblemId: signed.Problem.Id, Bundle: signed})
		if err != nil {
			log.Fatalf("failed to put problem bundle: %s", cleanError(err))
		}
		dumpMessage("PutProblemBundle", false, finalResp)
		final = finalResp.Bundle
		fmt.Printf("problem %q saved and ready to use\n", final.Problem.Unique)
	}

	if signed.Problem.Id == 0 {
		// create a matching problem set
		// pause for a bit since the database seems to need to catch up
		time.Sleep(time.Second)

		// create a problem set with just this problem and the same unique name
		psBundle := &ProblemSetBundle{
			ProblemSet: &ProblemSet{
				Unique:    final.Problem.Unique,
				Note:      "Problem set for: " + final.Problem.Note,
				Tags:      final.Problem.Tags,
				CreatedAt: timestamppb.New(now),
				UpdatedAt: timestamppb.New(now),
			},
			ProblemSetProblems: []*ProblemSetProblem{
				{
					ProblemId: final.Problem.Id,
					Weight:    1.0,
				},
			},
		}
		dumpMessage("PostProblemSetBundle", true, &PostProblemSetBundleRequest{Bundle: psBundle})
		finalPSBundleResp, err := client.PostProblemSetBundle(ctx, &PostProblemSetBundleRequest{Bundle: psBundle})
		if err != nil {
			log.Fatalf("failed to post problem set bundle: %s", cleanError(err))
		}
		dumpMessage("PostProblemSetBundle", false, finalPSBundleResp)
		finalPSBundle := finalPSBundleResp.Bundle
		fmt.Printf("problem set %q created and ready to use\n", finalPSBundle.ProblemSet.Unique)
	}
}

func findProblemCfg(now time.Time, startDir string) (string, string, int, *Problem, []*ProblemStep, bool) {
	// find the absolute directory so we can walk up the tree if needed
	directory, err := filepath.Abs(startDir)
	if err != nil {
		log.Fatalf("error finding directory: %s", cleanError(err))
	}

	// find the problem.cfg file
	stepDir, stepN := directory, 0
	for {
		path := filepath.Join(directory, ProblemConfigName)
		_, err := os.Stat(path)
		if err == nil {
			break
		}
		if !os.IsNotExist(err) {
			log.Fatalf("error searching for %s in %s: %v", ProblemConfigName, directory, err)
		}

		// try moving up a directory
		stepDir = directory
		directory = filepath.Dir(directory)
		if directory == stepDir {
			return "", "", 0, nil, nil, false
		}
	}

	// parse problem.cfg to create the problem object
	var cfg ConfigFile
	configPath := filepath.Join(directory, ProblemConfigName)
	fmt.Printf("reading %s\n", configPath)
	if err = gcfg.ReadFileInto(&cfg, configPath); err != nil {
		log.Fatalf("failed to parse %s: %v", configPath, err)
	}
	problem := &Problem{
		Unique:    cfg.Problem.Unique,
		Note:      cfg.Problem.Note,
		Tags:      cfg.Problem.Tag,
		Options:   cfg.Problem.Option,
		CreatedAt: timestamppb.New(now),
		UpdatedAt: timestamppb.New(now),
	}

	// create skeleton steps
	var steps []*ProblemStep
	single := cfg.Step == nil || len(cfg.Step) == 0
	if single {
		steps = append(steps, &ProblemStep{
			Step:        1,
			Note:        problem.Note,
			ProblemType: cfg.Problem.Type,
			Weight:      1.0,
			Files:       make(map[string][]byte),
		})
		stepN = 1
	} else {
		for i := int64(1); cfg.Step[strconv.FormatInt(i, 10)] != nil; i++ {
			elt := cfg.Step[strconv.FormatInt(i, 10)]
			problemType := ""
			switch {
			case elt.Type == "" && cfg.Problem.Type != "":
				problemType = cfg.Problem.Type
			case elt.Type != "" && cfg.Problem.Type == "":
				problemType = elt.Type
			default:
				log.Fatalf("problem type must be specified for the problem as a whole or for each step, but not both")
			}
			step := &ProblemStep{
				Step:        i,
				Note:        elt.Note,
				ProblemType: problemType,
				Weight:      elt.Weight,
				Files:       make(map[string][]byte),
			}
			steps = append(steps, step)
		}
		if len(steps) != len(cfg.Step) {
			log.Fatalf("expected to find %d step%s, but only found %d", len(cfg.Step), plural(len(cfg.Step)), len(steps))
		}
		if stepDir != directory {
			stepName := filepath.Base(stepDir)
			n, err := strconv.Atoi(stepName)
			if err == nil && n > 0 && n <= len(steps) {
				stepN = n
			}
		}
	}

	return directory, stepDir, stepN, problem, steps, single
}

func gatherAuthor(now time.Time, isUpdate bool, action string, startDir string, client CodeGrinderServiceClient, ctx context.Context) (*ProblemBundle, string, int) {

	directory, stepDir, stepN, problem, steps, single := findProblemCfg(now, startDir)
	if problem == nil {
		log.Printf("unable to find %s in current directory or one of its ancestors", ProblemConfigName)
		log.Fatalf("   you must run this in a problem directory")
	}

	// for single-step problems, the step can be in the main directory with problem.cfg
	if single {
		info, err := os.Stat(filepath.Join(directory, "1"))
		if err == nil && info.IsDir() {
			log.Printf("%s is set up for a single-step problem with the step files in", ProblemConfigName)
			log.Printf("  the same directory as %s, but there is also a directory named '1'", ProblemConfigName)
			log.Printf("  Please add a [step \"1\"] entry to %s or move the step files", ProblemConfigName)
			log.Fatalf("  into the main directory and delete the '1' directory")
		}
	}

	// require the directory name to match the unique ID
	if filepath.Base(directory) != problem.Unique {
		log.Fatalf("the problem directory name must match the problem unique ID")
	}

	// get the problem types
	problemTypes := make(map[string]*ProblemType)
	for _, step := range steps {
		if _, exists := problemTypes[step.ProblemType]; !exists {
			dumpMessage("GetProblemType", true, &GetProblemTypeRequest{Name: step.ProblemType})
			problemTypeResp, err := client.GetProblemType(ctx, &GetProblemTypeRequest{Name: step.ProblemType})
			if err != nil {
				log.Fatalf("failed to get problem type: %s", cleanError(err))
			}
			dumpMessage("GetProblemType", false, problemTypeResp)
			problemTypes[step.ProblemType] = problemTypeResp.ProblemType
		}
	}

	// start forming the problem bundle
	unsigned := &ProblemBundle{
		Problem: problem,
	}

	// check if this is an existing problem
	dumpMessage("GetProblems", true, &GetProblemsRequest{Unique: problem.Unique})
	existingResp, err := client.GetProblems(ctx, &GetProblemsRequest{Unique: problem.Unique})
	if err != nil {
		log.Fatalf("failed to get problems: %s", cleanError(err))
	}
	dumpMessage("GetProblems", false, existingResp)
	existing := existingResp.Problems
	switch len(existing) {
	case 0:
		// new problem
		if isUpdate {
			log.Fatalf("you specified --update, but no existing problem with unique ID %q was found", problem.Unique)
		}

		// make sure the problem set with this unique name is free as well
		dumpMessage("GetProblemSets", true, &GetProblemSetsRequest{Unique: problem.Unique})
		existingSetsResp, err := client.GetProblemSets(ctx, &GetProblemSetsRequest{Unique: problem.Unique})
		if err != nil {
			log.Fatalf("failed to get problem sets: %s", cleanError(err))
		}
		dumpMessage("GetProblemSets", false, existingSetsResp)
		existingSets := existingSetsResp.ProblemSets
		if len(existingSets) > 1 {
			log.Fatalf("error: server found multiple problem sets with matching unique ID %q", problem.Unique)
		}
		if len(existingSets) != 0 {
			log.Printf("problem set %d already exists with unique ID %q", existingSets[0].Id, existingSets[0].Unique)
			log.Fatalf("  this would prevent creating a problem set containing just this problem with matching id")
		}

		fmt.Printf("unique ID is %q\n", problem.Unique)
		fmt.Println("  this problem is new--no existing problem has the same unique ID")
	case 1:
		// update to existing problem
		if action == "" && !isUpdate {
			log.Fatalf("you did not specify --update, but a problem already exists with unique ID %q", problem.Unique)
		}
		fmt.Printf("unique ID is %q\n", problem.Unique)
		fmt.Printf("  this is an update of problem %d\n", existing[0].Id)
		fmt.Printf("  (%q)\n", existing[0].Note)
		problem.Id = existing[0].Id
		problem.CreatedAt = existing[0].CreatedAt
	default:
		// server does not know what "unique" means
		log.Fatalf("error: server found multiple problems with matching unique ID %q", problem.Unique)
	}

	// generate steps
	whitelist := make(map[string]bool)
	for index, step := range steps {
		i := int64(index + 1)
		fmt.Printf("gathering step %d\n", i)
		commit := &Commit{
			Step:      i,
			Action:    "grade",
			Note:      "author solution submitted via grind",
			Files:     make(map[string][]byte),
			CreatedAt: timestamppb.New(now),
			UpdatedAt: timestamppb.New(now),
		}
		if action != "" {
			commit.Action = action
			commit.Note = fmt.Sprintf("author solution tested with action %s via grind", action)
		}

		// read files
		starter, solution, root := make(map[string][]byte), make(map[string][]byte), make(map[string][]byte)
		stepdir := directory
		if !single {
			stepdir = filepath.Join(directory, strconv.FormatInt(i, 10))
		}
		patterns := parseGitignore(string(problemTypes[step.ProblemType].Files[".gitignore"]))
		err := filepath.Walk(stepdir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				log.Fatalf("walk error for %s: %v", path, err)
			}
			relpath, err := filepath.Rel(stepdir, path)
			if err != nil {
				log.Fatalf("error finding relative path of %s: %v", path, err)
			}
			relpath = filepath.ToSlash(relpath)
			if info.IsDir() {
				if isIgnored(relpath, patterns) {
					fmt.Printf("  skipping directory %s\n", relpath)
					return filepath.SkipDir
				}
				return nil
			}
			if single && relpath == ProblemConfigName {
				// skip problem.cfg silently
				return nil
			}
			if _, exists := problemTypes[step.ProblemType].Files[relpath]; exists {
				fmt.Printf("  skipping file %s\n", relpath)
				fmt.Printf("    because it is provided by the problem type\n")
				return nil
			}
			if isIgnored(relpath, patterns) {
				fmt.Printf("  skipping file %s\n", relpath)
				fmt.Printf("    because it matches .gitignore pattern\n")
				return nil
			}

			// load the file and add it to the appropriate place
			contents, err := ioutil.ReadFile(path)
			if err != nil {
				log.Fatalf("error reading %s: %v", relpath, err)
			}

			// pick out solution/starter files
			if parts := strings.SplitN(relpath, "/", 2); len(parts) == 0 {
				// do nothing
			} else if len(parts) == 2 && parts[0] == "_solution" {
				solution[parts[1]] = contents
			} else if len(parts) == 2 && parts[0] == "_starter" {
				starter[parts[1]] = contents
			} else {
				root[relpath] = contents
			}

			return nil
		})
		if err != nil {
			log.Fatalf("walk error for %s: %v", stepdir, err)
		}

		// find starter files and solution files, and update whitelist
		if len(solution) > 0 && len(starter) == 0 {
			// explicit solution, need to find the starter files
			for name := range solution {
				// anything with a name that matches the solution must be part
				// of the starter set for this step
				if contents, exists := root[name]; exists {
					starter[name] = contents
					delete(root, name)

					whitelist[name] = true
				} else if !whitelist[name] {
					// we found a new file in the solution set but no matching starter file
					log.Fatalf("found %s in the solution, but no matching starter file", name)
				}
			}
			for name := range whitelist {
				if _, exists := root[name]; exists {
					log.Fatalf("found %s outside the _solution directory", name)
				}
			}
		} else if len(solution) == 0 && len(starter) > 0 {
			// explicit starter set, need to find the solution set
			// add all files from the starter to the whitelist
			for name := range starter {
				whitelist[name] = true
			}

			// find solution files, we search the whitelist because
			// the file may have been started in an earlier step
			for name := range whitelist {
				if contents, exists := root[name]; exists {
					solution[name] = contents
					delete(root, name)
				}
			}
		} else if len(solution) > 0 && len(starter) > 0 {
			// both are explicit
			for name := range starter {
				whitelist[name] = true
			}
			for name := range whitelist {
				if _, exists := root[name]; exists {
					log.Fatalf("found %s outside the _solution and _starter directories", name)
				}
			}
		} else if i > 1 {
			// for step > 1 with no explicit starter or solution,
			// we assume no new starter files and search the
			// whitelist for files starter in earlier steps
			for name := range whitelist {
				if contents, exists := root[name]; exists {
					solution[name] = contents
					delete(root, name)
				}
			}
		} else {
			log.Fatalf("must have solution files and starter files")
		}

		// copy support files into the step
		for name, contents := range root {
			step.Files[name] = contents
		}

		// copy the starter files into the step
		for name, contents := range starter {
			step.Files[name] = contents
		}

		// copy the whitelist for the step
		step.Whitelist = make(map[string]bool)
		for name := range whitelist {
			step.Whitelist[name] = true
		}

		// copy the solution files into the commit
		unused := make(map[string]bool)
		for name := range whitelist {
			unused[name] = true
		}
		for name, contents := range solution {
			if whitelist[name] {
				commit.Files[name] = contents
				delete(unused, name)
			} else {
				fmt.Printf("  warning: skipping solution file %q\n", name)
				fmt.Println("    because it is not in the starter file set of this or any previous step")
			}
		}
		if len(unused) > 0 {
			log.Printf("  example solution must include all files in the starter set")
			if i > 1 {
				log.Printf("  from this and previous steps")
			}
			for name := range unused {
				log.Printf("    solution is missing file %s", name)
			}
			log.Fatalf("solution rejected, please update and try again")
		}

		unsigned.ProblemSteps = append(unsigned.ProblemSteps, step)
		unsigned.Commits = append(unsigned.Commits, commit)
		fmt.Printf("  found %d problem definition file%s and %d solution file%s\n",
			len(step.Files), plural(len(step.Files)), len(commit.Files), plural(len(commit.Files)))
	}

	if action != "" {
		// must be in a valid step directory
		if !single && (stepDir == directory || stepN < 1) {
			log.Fatalf("to run an action, you must be in a step directory")
		}

		// if the user requested an interactive action, it must be valid for the problem type
		var problemType *ProblemType
		if single {
			problemType = problemTypes[steps[0].ProblemType]
		} else {
			problemType = problemTypes[steps[stepN-1].ProblemType]
		}
		if _, exists := problemType.Actions[action]; !exists {
			log.Fatalf("action %q does not exist for problem type %s", action, problemType.Name)
		}
	}

	return unsigned, stepDir, stepN
}

func createProblemSet(path string, isUpdate bool, client CodeGrinderServiceClient, ctx context.Context) {

	now := time.Now()

	// parse the cfg file to create the problem set object
	cfg := struct {
		ProblemSet struct {
			Unique string
			Note   string
			Tag    []string
		}
		Problem map[string]*struct {
			Weight float64
		}
	}{}
	fmt.Printf("creating problem set using %s\n", path)
	if err := gcfg.ReadFileInto(&cfg, path); err != nil {
		log.Fatalf("failed to parse %s: %v", path, err)
	}

	problemSet := &ProblemSet{
		Unique:    cfg.ProblemSet.Unique,
		Note:      cfg.ProblemSet.Note,
		Tags:      cfg.ProblemSet.Tag,
		CreatedAt: timestamppb.New(now),
		UpdatedAt: timestamppb.New(now),
	}

	// require the file name to match the unique ID
	if filepath.Base(path) != problemSet.Unique+".cfg" {
		log.Fatalf("the problem set file name must match the problem set unique ID")
	}

	// start forming the problem set bundle
	bundle := &ProblemSetBundle{
		ProblemSet: problemSet,
	}

	// check if this is an existing problem set
	dumpMessage("GetProblemSets", true, &GetProblemSetsRequest{Unique: problemSet.Unique})
	existingResp, err := client.GetProblemSets(ctx, &GetProblemSetsRequest{Unique: problemSet.Unique})
	if err != nil {
		log.Fatalf("failed to get problem sets: %s", cleanError(err))
	}
	dumpMessage("GetProblemSets", false, existingResp)
	existing := existingResp.ProblemSets
	switch len(existing) {
	case 0:
		// new problem
		if isUpdate {
			log.Fatalf("you specified --update, but no existing problem set with unique ID %q was found", problemSet.Unique)
		}

		fmt.Printf("unique ID is %q\n", problemSet.Unique)
		fmt.Println("  this problem set is new--no existing problem set has the same unique ID")
	case 1:
		// update to existing problem set
		if !isUpdate {
			log.Fatalf("you did not specify --update, but a problem set already exists with unique ID %q", problemSet.Unique)
		}

		fmt.Printf("unique ID is %q\n", problemSet.Unique)
		fmt.Printf("  this is an update of problem set %d\n", existing[0].Id)
		fmt.Printf("  (%q)\n", existing[0].Note)
		problemSet.Id = existing[0].Id
		problemSet.CreatedAt = existing[0].CreatedAt
	default:
		// server does not know what "unique" means
		log.Fatalf("error: server found multiple problems with matching unique ID %q", problemSet.Unique)
	}

	// generate the individual problems
	if len(cfg.Problem) == 0 {
		log.Fatalf("a problem set must contain at least one problem")
	}
	for unique, elt := range cfg.Problem {
		dumpMessage("GetProblems", true, &GetProblemsRequest{Unique: unique})
		problemsResp, err := client.GetProblems(ctx, &GetProblemsRequest{Unique: unique})
		if err != nil {
			log.Fatalf("failed to get problems: %s", cleanError(err))
		}
		dumpMessage("GetProblems", false, problemsResp)
		problems := problemsResp.Problems
		if len(problems) == 0 {
			log.Fatalf("problem with unique ID %q not found", unique)
		}
		if len(problems) != 1 {
			// server does not know what "unique" means
			log.Fatalf("error: server found multiple problems with matching unique ID %q", unique)
		}
		psp := &ProblemSetProblem{
			ProblemId: problems[0].Id,
			Weight:    elt.Weight,
		}
		if psp.Weight <= 0.0 {
			psp.Weight = 1.0
		}
		bundle.ProblemSetProblems = append(bundle.ProblemSetProblems, psp)
	}

	// save the problem set
	final := new(ProblemSetBundle)
	if bundle.ProblemSet.Id == 0 {
		dumpMessage("PostProblemSetBundle", true, &PostProblemSetBundleRequest{Bundle: bundle})
		finalResp, err := client.PostProblemSetBundle(ctx, &PostProblemSetBundleRequest{Bundle: bundle})
		if err != nil {
			log.Fatalf("failed to post problem set bundle: %s", cleanError(err))
		}
		dumpMessage("PostProblemSetBundle", false, finalResp)
		final = finalResp.Bundle
		fmt.Printf("problem set %q created and ready to use\n", final.ProblemSet.Unique)
	} else {
		dumpMessage("PutProblemSetBundle", true, &PutProblemSetBundleRequest{Bundle: bundle})
		finalResp, err := client.PutProblemSetBundle(ctx, &PutProblemSetBundleRequest{Bundle: bundle})
		if err != nil {
			log.Fatalf("failed to put problem set bundle: %s", cleanError(err))
		}
		dumpMessage("PutProblemSetBundle", false, finalResp)
		final = finalResp.Bundle
		fmt.Printf("problem set %q saved and ready to use\n", final.ProblemSet.Unique)
	}
}
