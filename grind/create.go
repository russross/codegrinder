package main

import (
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	. "github.com/russross/codegrinder/common"
	"github.com/russross/gcfg"
	"github.com/spf13/cobra"
)

const ProblemConfigName string = "problem.cfg"

func CommandCreate(cmd *cobra.Command, args []string) {
	mustLoadConfig(cmd)
	now := time.Now()

	if len(args) != 0 {
		cmd.Help()
		os.Exit(1)
	}

	action := cmd.Flag("action").Value.String()

	// find the absolute directory so we can walk up the tree if needed
	dir, err := filepath.Abs(".")
	if err != nil {
		log.Fatalf("error finding directory: %v", err)
	}

	// find the problem.cfg file
	actionDir := dir
	actionStep := 0
	for {
		path := filepath.Join(dir, ProblemConfigName)
		if _, err := os.Stat(path); err != nil {
			if os.IsNotExist(err) {
				// try moving up a directory
				actionDir = dir
				dir = filepath.Dir(dir)
				if dir == actionDir {
					log.Printf("unable to find %s in current directory or one of its ancestors", ProblemConfigName)
					log.Fatalf("   you must run this in a problem directory")
				}
				// log.Printf("could not find %s in %s, trying %s", ProblemConfigName, old, dir)
				continue
			}

			log.Fatalf("error searching for %s in %s: %v", ProblemConfigName, dir, err)
		}
		break
	}
	if action != "" {
		if actionDir == dir {
			log.Fatalf("to run an action, you must be in the step directory")
		}
		stepName := filepath.Base(actionDir)
		stepN, err := strconv.Atoi(stepName)
		if err != nil {
			log.Fatalf("to run an action, you must be in the step directory, not %s", stepName)
		}
		actionStep = stepN
		if actionStep < 1 {
			log.Fatalf("step directory must be > 0, not %d", actionStep)
		}
	}

	// parse problem.cfg
	cfg := struct {
		Problem struct {
			Unique string
			Note   string
			Type   string
			Tag    []string
			Option []string
		}
		Step map[string]*struct {
			Note   string
			Weight float64
		}
	}{}

	configPath := filepath.Join(dir, ProblemConfigName)
	fmt.Printf("reading %s\n", configPath)
	err = gcfg.ReadFileInto(&cfg, configPath)
	if err != nil {
		log.Fatalf("failed to parse %s: %v", configPath, err)
	}

	// create problem object
	problem := &Problem{
		Unique:      cfg.Problem.Unique,
		Note:        cfg.Problem.Note,
		ProblemType: cfg.Problem.Type,
		Tags:        cfg.Problem.Tag,
		Options:     cfg.Problem.Option,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	// get the problem type
	problemType := new(ProblemType)
	mustGetObject(fmt.Sprintf("/problem_types/%s", problem.ProblemType), nil, problemType)

	// if the user requested an interactive action, it must be valid
	if action != "" {
		if _, exists := problemType.Actions[action]; !exists {
			log.Fatalf("action %q does not exist for problem type %s", action, problemType.Name)
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
		if cmd.Flag("update").Value.String() == "true" {
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

		log.Printf("this problem is new--no existing problem has the same unique ID")
	case 1:
		// update to existing problem
		if cmd.Flag("update").Value.String() == "false" {
			log.Fatalf("you did not specify --update, but a problem already exists with unique ID %q", problem.Unique)
		}
		log.Printf("unique ID is %s", problem.Unique)
		log.Printf("  this is an update of problem %d", existing[0].ID)
		log.Printf("  (%q)", existing[0].Note)
		problem.ID = existing[0].ID
		problem.CreatedAt = existing[0].CreatedAt
	default:
		// server does not know what "unique" means
		log.Fatalf("error: server found multiple problems with matching unique ID %q", problem.Unique)
	}

	// generate steps
	whitelist := make(map[string]bool)
	for i := int64(1); cfg.Step[strconv.FormatInt(i, 10)] != nil; i++ {
		log.Printf("gathering step %d", i)
		s := cfg.Step[strconv.FormatInt(i, 10)]
		step := &ProblemStep{
			Step:   i,
			Note:   s.Note,
			Weight: s.Weight,
			Files:  make(map[string]string),
		}
		commit := &Commit{
			Step:      i,
			Action:    "grade",
			Note:      "author solution submitted via grind",
			Files:     make(map[string]string),
			CreatedAt: now,
			UpdatedAt: now,
		}
		if action != "" {
			commit.Action = action
			commit.Note = fmt.Sprintf("author solution tested with action %s via grind", action)
		}

		// read files
		blacklist := []string{"~", ".swp", ".o", ".pyc", ".out"}
		starter, solution, root := make(map[string]string), make(map[string]string), make(map[string]string)
		stepdir := filepath.Join(dir, strconv.FormatInt(i, 10))
		err := filepath.Walk(stepdir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				log.Fatalf("walk error for %s: %v", path, err)
			}
			if info.IsDir() {
				return nil
			}
			relpath, err := filepath.Rel(stepdir, path)
			if err != nil {
				log.Fatalf("error finding relative path of %s: %v", path, err)
			}
			if _, exists := problemType.Files[filepath.ToSlash(relpath)]; exists {
				log.Printf("skipping file %s", relpath)
				log.Printf("  because it is provided by the problem type")
				return nil
			}
			for _, suffix := range blacklist {
				if strings.HasSuffix(relpath, suffix) {
					log.Printf("skipping file %s", relpath)
					log.Printf("  because it has the following suffix: %s", suffix)
					return nil
				}
			}

			// load the file and add it to the appropriate place
			contents, err := ioutil.ReadFile(path)
			if err != nil {
				log.Fatalf("error reading %s: %v", relpath, err)
			}

			// pick out solution/starter files
			reldir, relfile := filepath.Split(relpath)
			if filepath.ToSlash(reldir) == "_solution/" && relfile != "" {
				solution[filepath.ToSlash(relfile)] = string(contents)
			} else if filepath.ToSlash(reldir) == "_starter/" && relfile != "" {
				starter[filepath.ToSlash(relfile)] = string(contents)
			} else if reldir == "" && relfile != "" {
				root[relfile] = string(contents)
			} else {
				step.Files[filepath.ToSlash(relpath)] = string(contents)
			}

			return nil
		})
		if err != nil {
			log.Fatalf("walk error for %s: %v", stepdir, err)
		}

		// find starter files and solution files
		if len(solution) > 0 && len(starter) > 0 && len(root) > 0 {
			log.Fatalf("found files in _starter, _solution, and root directory; unsure how to proceed")
		}
		if len(solution) > 0 {
			// explicit solution
		} else if len(root) > 0 {
			// files in root directory must be the solution
			solution = root
			root = nil
		} else {
			log.Fatalf("no solution files found in _solution or root directory; problem must have a solution")
		}
		if len(starter) == 0 && root != nil {
			starter = root
		}

		// copy the starter files into the step
		for name, contents := range starter {
			step.Files[name] = contents

			// if the file exists as a starter in this or earlier steps, it can be part of the solution
			whitelist[name] = true
		}

		// copy the solution files into the commit
		for name, contents := range solution {
			if whitelist[name] {
				commit.Files[name] = contents
			} else {
				log.Printf("warning: skipping solution file %q", name)
				log.Printf("  because it is not in the starter file set of this or any previous step")
			}
		}

		unsigned.ProblemSteps = append(unsigned.ProblemSteps, step)
		unsigned.Commits = append(unsigned.Commits, commit)
		log.Printf("  found %d problem definition file%s and %d solution file%s", len(step.Files), plural(len(step.Files)), len(commit.Files), plural(len(commit.Files)))
	}

	if len(unsigned.ProblemSteps) != len(cfg.Step) {
		log.Fatalf("expected to find %d step%s, but only found %d", len(cfg.Step), plural(len(cfg.Step)), len(unsigned.ProblemSteps))
	}

	if action != "" && actionStep > len(unsigned.ProblemSteps) {
		log.Fatalf("must run action from within a valid step directory, not %d", actionStep)
	}

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

	if action != "" {
		log.Printf("running interactive session for action %q on step %d", action, actionStep)

		// run the interactive action for a single step instead
		// of validating all steps
		unvalidated := &CommitBundle{
			ProblemType:          signed.ProblemType,
			ProblemTypeSignature: signed.ProblemTypeSignature,
			Problem:              signed.Problem,
			ProblemSteps:         signed.ProblemSteps,
			ProblemSignature:     signed.ProblemSignature,
			Hostname:             signed.Hostname,
			UserID:               signed.UserID,
			Commit:               signed.Commits[actionStep-1],
			CommitSignature:      signed.CommitSignatures[actionStep-1],
		}

		runInteractiveSession(unvalidated, nil, actionDir)
		return
	}

	// validate the commits one at a time
	for n := 0; n < len(signed.ProblemSteps); n++ {
		log.Printf("validating solution for step %d", n+1)
		unvalidated := &CommitBundle{
			ProblemType:          signed.ProblemType,
			ProblemTypeSignature: signed.ProblemTypeSignature,
			Problem:              signed.Problem,
			ProblemSteps:         signed.ProblemSteps,
			ProblemSignature:     signed.ProblemSignature,
			Hostname:             signed.Hostname,
			UserID:               signed.UserID,
			Commit:               signed.Commits[n],
			CommitSignature:      signed.CommitSignatures[n],
		}
		validated := mustConfirmCommitBundle(unvalidated, nil)
		log.Printf("  finished validating solution")
		if validated.Commit.ReportCard == nil || validated.Commit.Score != 1.0 || !validated.Commit.ReportCard.Passed {
			log.Printf("  solution for step %d failed: %s", n+1, validated.Commit.ReportCard.Note)

			// play the transcript
			if err := validated.Commit.DumpTranscript(os.Stdout); err != nil {
				log.Fatalf("failed to dump transcript: %v", err)
			}
			log.Fatalf("please fix solution and try again")
		}
		signed.ProblemType = validated.ProblemType
		signed.ProblemTypeSignature = validated.ProblemTypeSignature
		signed.Problem = validated.Problem
		signed.ProblemSteps = validated.ProblemSteps
		signed.ProblemSignature = validated.ProblemSignature
		signed.Commits[n] = validated.Commit
		signed.CommitSignatures[n] = validated.CommitSignature
	}

	log.Printf("problem and solution confirmed successfully")

	// save the problem
	final := new(ProblemBundle)
	if signed.Problem.ID == 0 {
		mustPostObject("/problem_bundles/confirmed", nil, signed, final)
	} else {
		mustPutObject(fmt.Sprintf("/problem_bundles/%d", signed.Problem.ID), nil, signed, final)
	}
	log.Printf("problem %q saved and ready to use", final.Problem.Unique)

	if signed.Problem.ID == 0 {
		// create a matching problem set
		// pause for a bit since the database seems to need to catch up
		time.Sleep(time.Second)

		// create a problem set with just this problem and the same unique name
		psBundle := &ProblemSetBundle{
			ProblemSet: &ProblemSet{
				Unique:    final.Problem.Unique,
				Note:      "set for single problem " + final.Problem.Unique + "\n" + final.Problem.Note,
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
		log.Printf("problem set %q created and ready to use", finalPSBundle.ProblemSet.Unique)
	}
}

func mustConfirmCommitBundle(bundle *CommitBundle, args []string) *CommitBundle {
	// create a websocket connection to the server
	headers := make(http.Header)
	url := "wss://" + bundle.Hostname + "/v2/sockets/" + bundle.Problem.ProblemType + "/" + bundle.Commit.Action
	socket, resp, err := websocket.DefaultDialer.Dial(url, headers)
	if err != nil {
		log.Printf("error dialing %s: %v", url, err)
		if resp != nil && resp.Body != nil {
			io.Copy(os.Stderr, resp.Body)
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
