package main

import (
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/fatih/color"
	"github.com/gorilla/websocket"
	. "github.com/russross/codegrinder/types"
	"github.com/russross/gcfg"
	"github.com/spf13/cobra"
)

const ProblemConfigName string = "problem.cfg"

func CommandCreate(cmd *cobra.Command, args []string) {
	mustLoadConfig(cmd)
	now := time.Now()

	// find the directory
	d := ""
	switch len(args) {
	case 0:
		d = "."
	case 1:
		d = args[0]
	default:
		cmd.Help()
		return
	}
	dir, err := filepath.Abs(d)
	if err != nil {
		log.Fatalf("error finding directory %q: %v", d, err)
	}

	// find the problem.cfg file
	for {
		path := filepath.Join(dir, ProblemConfigName)
		if _, err := os.Stat(path); err != nil {
			if os.IsNotExist(err) {
				// try moving up a directory
				old := dir
				dir = filepath.Dir(dir)
				if dir == old {
					log.Fatalf("unable to find %s in %s or an ancestor directory", ProblemConfigName, d)
				}
				log.Printf("could not find %s in %s, trying %s", ProblemConfigName, old, dir)
				continue
			}

			log.Fatalf("error searching for %s in %s: %v", ProblemConfigName, dir, err)
		}
		break
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

	// start forming the problem bundle
	unsigned := &ProblemBundle{
		Problem: problem,
	}

	// check if this is an existing problem
	existing := []*Problem{}
	mustGetObject("/problems", map[string]string{"unique": problem.Unique}, &existing)
	switch len(existing) {
	case 0:
		// new problem
		if cmd.Flag("update").Value.String() == "true" {
			log.Fatalf("you specified --update, but no existing problem with unique ID %q was found", problem.Unique)
		}

		// make sure the problem set with this unique name is free as well
		existingSets := []*ProblemSet{}
		mustGetObject("/problem_sets", map[string]string{"unique": problem.Unique}, &existingSets)
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
		log.Printf("  this is an update of problem %d (%q)", existing[0].ID, existing[0].Note)
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
			Action:    "confirm",
			Note:      "author solution submitted via grind",
			Files:     make(map[string]string),
			CreatedAt: now,
			UpdatedAt: now,
		}

		// read files
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

			// load the file and add it to the appropriate place
			contents, err := ioutil.ReadFile(path)
			if err != nil {
				log.Fatalf("error reading %s: %v", relpath, err)
			}

			// pick out solution/starter files
			reldir, relfile := filepath.Split(relpath)
			if reldir == "_solution/" && relfile != "" {
				solution[relfile] = string(contents)
			} else if reldir == "_starter/" && relfile != "" {
				starter[relfile] = string(contents)
			} else if reldir == "" && relfile != "" {
				root[relfile] = string(contents)
			} else {
				step.Files[relpath] = string(contents)
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
				log.Printf("Warning: skipping solution file %q", name)
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

	// get user ID
	user := new(User)
	mustGetObject("/users/me", nil, user)
	unsigned.UserID = user.ID

	// get the request validated and signed
	signed := new(ProblemBundle)
	mustPostObject("/problem_bundles/unconfirmed", nil, unsigned, signed)

	// validate the commits one at a time
	for n := 0; n < len(signed.ProblemSteps); n++ {
		log.Printf("validating solution for step %d", n+1)
		unvalidated := &CommitBundle{
			Problem:          signed.Problem,
			ProblemSteps:     signed.ProblemSteps,
			ProblemSignature: signed.ProblemSignature,
			Hostname:         signed.Hostname,
			UserID:           signed.UserID,
			Commit:           signed.Commits[n],
			CommitSignature:  signed.CommitSignatures[n],
		}
		validated := mustConfirmCommitBundle(user.ID, unvalidated, nil)
		log.Printf("  finished validating solution")
		if validated.Commit.ReportCard == nil || validated.Commit.Score != 1.0 || !validated.Commit.ReportCard.Passed {
			log.Printf("  solution for step %d failed: %s", n+1, validated.Commit.ReportCard.Note)

			// play the transcript
			for _, event := range validated.Commit.Transcript {
				switch event.Event {
				case "exec":
					color.Cyan("$ %s\n", strings.Join(event.ExecCommand, " "))
				case "stdin":
					color.Yellow("%s", event.StreamData)
				case "stdout":
					color.White("%s", event.StreamData)
				case "stderr":
					color.Red("%s", event.StreamData)
				case "exit":
					color.Cyan("%s\n", event.ExitStatus)
				case "error":
					color.Red("Error: %s\n", event.Error)
				}
			}
			log.Fatalf("please fix solution and try again")
		}
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
			ProblemIDs: []int64{final.Problem.ID},
			Weights:    []float64{1.0},
		}
		finalPSBundle := new(ProblemSetBundle)
		mustPostObject("/problem_set_bundles", nil, psBundle, finalPSBundle)
		log.Printf("problem set %q created and ready to use for this problem", finalPSBundle.ProblemSet.Unique)
	}
}

func mustConfirmCommitBundle(userID int64, bundle *CommitBundle, args []string) *CommitBundle {
	verbose := false

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
			log.Fatalf("  %s", reply.Error)

		case reply.CommitBundle != nil:
			return reply.CommitBundle

		case reply.Event != nil:
			if verbose {
				switch reply.Event.Event {
				case "exec":
					color.Cyan("$ %s\n", strings.Join(reply.Event.ExecCommand, " "))
				case "stdin":
					color.Yellow("%s", reply.Event.StreamData)
				case "stdout":
					color.White("%s", reply.Event.StreamData)
				case "stderr":
					color.Red("%s", reply.Event.StreamData)
				case "exit":
					color.Cyan("exit: %s\n", reply.Event.ExitStatus)
				case "error":
					color.Red("Error: %s\n", reply.Event.Error)
				}
			}

		default:
			log.Fatalf("unexpected reply from server")
		}
	}

	log.Fatalf("no commit returned from server")
	return nil
}
