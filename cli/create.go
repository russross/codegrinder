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
	"gopkg.in/gcfg.v1"
)

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
	mustLoadConfig(cmd)
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
		createProblemSet(pset, isUpdate)
		return
	}

	now := time.Now()
	if isUpdate && action != "" {
		log.Fatalf("you specified --update, which is not valid when running an action")
	}

	unsigned, stepDir, step := gatherAuthor(now, isUpdate, action, ".")

	// get user ID
	user := new(User)
	mustGetObject("/users/me", nil, user)
	unsigned.UserID = user.ID

	// get the request validated and signed
	signed := new(ProblemBundle)
	mustPostObject("/problem_bundles/unconfirmed", nil, unsigned, signed)

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
			UserID:               signed.UserID,
			Commit:               signed.Commits[step-1],
			CommitSignature:      signed.CommitSignatures[step-1],
		}

		runInteractiveSession(unvalidated, nil, stepDir)
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
			UserID:               signed.UserID,
			Commit:               signed.Commits[n],
			CommitSignature:      signed.CommitSignatures[n],
		}
		validated := mustConfirmCommitBundle(unvalidated, nil)
		fmt.Println("  finished validating solution")
		if validated.Commit.ReportCard == nil || validated.Commit.Score != 1.0 || !validated.Commit.ReportCard.Passed {
			fmt.Printf("  solution for step %d failed: %s\n", n+1, validated.Commit.ReportCard.Note)

			// play the transcript
			if err := validated.Commit.DumpTranscript(os.Stdout); err != nil {
				log.Fatalf("failed to dump transcript: %v", err)
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
	if signed.Problem.ID == 0 {
		mustPostObject("/problem_bundles/confirmed", nil, signed, final)
		fmt.Printf("problem %q created and ready to use\n", final.Problem.Unique)
	} else {
		mustPutObject(fmt.Sprintf("/problem_bundles/%d", signed.Problem.ID), nil, signed, final)
		fmt.Printf("problem %q saved and ready to use\n", final.Problem.Unique)
	}

	if signed.Problem.ID == 0 {
		// create a matching problem set
		// pause for a bit since the database seems to need to catch up
		time.Sleep(time.Second)

		// create a problem set with just this problem and the same unique name
		psBundle := &ProblemSetBundle{
			ProblemSet: &ProblemSet{
				Unique:    final.Problem.Unique,
				Note:      "Problem set for: " + final.Problem.Note,
				Tags:      final.Problem.Tags,
				CreatedAt: now,
				UpdatedAt: now,
			},
			ProblemSetProblems: []*ProblemSetProblem{
				{
					ProblemID: final.Problem.ID,
					Weight:    1.0,
				},
			},
		}
		finalPSBundle := new(ProblemSetBundle)
		mustPostObject("/problem_set_bundles", nil, psBundle, finalPSBundle)
		fmt.Printf("problem set %q created and ready to use\n", finalPSBundle.ProblemSet.Unique)
	}
}

func findProblemCfg(now time.Time, startDir string) (string, string, int, *Problem, []*ProblemStep, bool) {
	// find the absolute directory so we can walk up the tree if needed
	directory, err := filepath.Abs(startDir)
	if err != nil {
		log.Fatalf("error finding directory: %v", err)
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
		CreatedAt: now,
		UpdatedAt: now,
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

func gatherAuthor(now time.Time, isUpdate bool, action string, startDir string) (*ProblemBundle, string, int) {
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
			problemType := new(ProblemType)
			mustGetObject(fmt.Sprintf("/problem_types/%s", step.ProblemType), nil, problemType)
			problemTypes[step.ProblemType] = problemType
		}
	}

	// start forming the problem bundle
	unsigned := &ProblemBundle{
		Problem: problem,
	}

	// check if this is an existing problem
	existing := []*Problem{}
	params := make(url.Values)
	params.Add("unique", problem.Unique)
	mustGetObject("/problems", params, &existing)
	switch len(existing) {
	case 0:
		// new problem
		if isUpdate {
			log.Fatalf("you specified --update, but no existing problem with unique ID %q was found", problem.Unique)
		}

		// make sure the problem set with this unique name is free as well
		existingSets := []*ProblemSet{}
		params = make(url.Values)
		params.Add("unique", problem.Unique)
		mustGetObject("/problem_sets", params, &existingSets)
		if len(existingSets) > 1 {
			log.Fatalf("error: server found multiple problem sets with matching unique ID %q", problem.Unique)
		}
		if len(existingSets) != 0 {
			log.Printf("problem set %d already exists with unique ID %q", existingSets[0].ID, existingSets[0].Unique)
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
		fmt.Printf("  this is an update of problem %d\n", existing[0].ID)
		fmt.Printf("  (%q)\n", existing[0].Note)
		problem.ID = existing[0].ID
		problem.CreatedAt = existing[0].CreatedAt
	default:
		// server does not know what "unique" means
		log.Fatalf("error: server found multiple problems with matching unique ID %q", problem.Unique)
	}

	// generate steps
	whitelist := make(map[string]bool)
	blacklist := []string{"~", ".swp", ".o", ".pyc", ".out", ".DS_Store", ".js", ".js.map", "package-lock.json"}
	blacklistDir := []string{"__pycache__", "node_modules", "dist"}
	for index, step := range steps {
		i := int64(index + 1)
		fmt.Printf("gathering step %d\n", i)
		commit := &Commit{
			Step:      i,
			Action:    "grade",
			Note:      "author solution submitted via grind",
			Files:     make(map[string][]byte),
			CreatedAt: now,
			UpdatedAt: now,
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
				dirname := filepath.Base(path)
				for _, name := range blacklistDir {
					if dirname == name {
						fmt.Printf("  skipping directory %s\n", relpath)
						return filepath.SkipDir
					}
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
			for _, suffix := range blacklist {
				if strings.HasSuffix(relpath, suffix) {
					fmt.Printf("  skipping file %s\n", relpath)
					fmt.Printf("    because it has the following suffix: %s\n", suffix)
					return nil
				}
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

func createProblemSet(path string, isUpdate bool) {
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
		CreatedAt: now,
		UpdatedAt: now,
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
	existing := []*ProblemSet{}
	params := make(url.Values)
	params.Add("unique", problemSet.Unique)
	mustGetObject("/problem_sets", params, &existing)
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
		fmt.Printf("  this is an update of problem set %d\n", existing[0].ID)
		fmt.Printf("  (%q)\n", existing[0].Note)
		problemSet.ID = existing[0].ID
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
		problems := []*Problem{}
		params := make(url.Values)
		params.Add("unique", unique)
		mustGetObject("/problems", params, &problems)
		if len(problems) == 0 {
			log.Fatalf("problem with unique ID %q not found", unique)
		}
		if len(problems) != 1 {
			// server does not know what "unique" means
			log.Fatalf("error: server found multiple problems with matching unique ID %q", unique)
		}
		psp := &ProblemSetProblem{
			ProblemID: problems[0].ID,
			Weight:    elt.Weight,
		}
		if psp.Weight <= 0.0 {
			psp.Weight = 1.0
		}
		bundle.ProblemSetProblems = append(bundle.ProblemSetProblems, psp)
	}

	// save the problem set
	final := new(ProblemSetBundle)
	if bundle.ProblemSet.ID == 0 {
		mustPostObject("/problem_set_bundles", nil, bundle, final)
		fmt.Printf("problem set %q created and ready to use\n", final.ProblemSet.Unique)
	} else {
		mustPutObject(fmt.Sprintf("/problem_set_bundles/%d", bundle.ProblemSet.ID), nil, bundle, final)
		fmt.Printf("problem set %q saved and ready to use\n", final.ProblemSet.Unique)
	}
}
