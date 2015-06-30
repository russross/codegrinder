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

	"github.com/codegangsta/cli"
	"github.com/fatih/color"
	"github.com/gorilla/websocket"
	"github.com/russross/gcfg"
)

const ProblemConfigName string = "problem.cfg"

func CommandCreate(context *cli.Context) {
	mustLoadConfig()
	now := time.Now()

	// find the directory
	d := ""
	switch len(context.Args()) {
	case 0:
		d = "."
	case 1:
		d = context.Args().First()
	default:
		cli.ShowSubcommandHelp(context)
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
			Type   string
			Name   string
			Unique string
			Desc   string
			Tag    []string
			Option []string
		}
		Step map[string]*struct {
			Name   string
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
		Name:        cfg.Problem.Name,
		Unique:      cfg.Problem.Unique,
		Description: cfg.Problem.Desc,
		ProblemType: cfg.Problem.Type,
		Tags:        cfg.Problem.Tag,
		Options:     cfg.Problem.Option,
		CreatedAt:   now,
		UpdatedAt:   now,
		Timestamp:   &now,
	}

	// check if this is an existing problem
	existing := []*Problem{}
	mustGetObject("/problems", map[string]string{"unique": problem.Unique}, &existing)
	switch len(existing) {
	case 0:
		// new problem
		if context.Bool("update") {
			log.Fatalf("you specified --update, but no problem with unique ID %q was found", problem.Unique)
		}
		log.Printf("this problem is new--no existing problem has the same unique ID")
	case 1:
		// update to existing problem
		if !context.Bool("update") {
			log.Fatalf("you did not specify --update, but a problem already exists with unique ID %q", problem.Unique)
		}
		log.Printf("based on the unique ID %s, this is an update of problem %d (%q)", problem.Unique, existing[0].ID, existing[0].Name)
		problem.ID = existing[0].ID
		problem.CreatedAt = existing[0].CreatedAt
	default:
		// server does not know what "unique" means
		log.Fatalf("error: server found multiple problems with matching unique ID")
	}

	// import steps
	whitelist := make(map[string]bool)
	for i := 1; cfg.Step[strconv.Itoa(i)] != nil; i++ {
		log.Printf("gathering step %d", i)
		s := cfg.Step[strconv.Itoa(i)]
		step := &ProblemStep{
			Name:        s.Name,
			ScoreWeight: s.Weight,
			Files:       make(map[string]string),
		}
		commit := &Commit{
			ProblemStepNumber: i - 1,
			Action:            "confirm",
			Files:             make(map[string]string),
			CreatedAt:         now,
			UpdatedAt:         now,
			Timestamp:         &now,
		}

		// read files
		starter, solution, root := make(map[string]string), make(map[string]string), make(map[string]string)
		stepdir := filepath.Join(dir, strconv.Itoa(i))
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

		problem.Steps = append(problem.Steps, step)
		problem.Commits = append(problem.Commits, commit)
		log.Printf("  found %d problem definition file%s and %d solution file%s", len(step.Files), plural(len(step.Files)), len(commit.Files), plural(len(commit.Files)))
	}

	if len(problem.Steps) != len(cfg.Step) {
		log.Fatalf("expected to find %d step%s, but only found %d", len(cfg.Step), plural(len(cfg.Step)), len(problem.Steps))
	}

	// get the request validated and signed
	signed := new(Problem)
	mustPostObject("/problems/unconfirmed", nil, problem, signed)

	// validate the commits one at a time
	commitList := signed.Commits
	signed.Commits = nil
	var signedCommits []*Commit
	for n, commit := range commitList {
		log.Printf("validating solution for step %d", n+1)
		signedCommit := mustConfirmCommit(signed, commit, nil)
		log.Printf("  finished validating solution")
		if signedCommit.ReportCard == nil || signedCommit.Score != 1.0 || !signedCommit.ReportCard.Passed {
			log.Printf("  solution for step %d failed: %s", n+1, signedCommit.ReportCard.Message)

			// play the transcript
			for _, event := range signedCommit.Transcript {
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
		signedCommits = append(signedCommits, signedCommit)
	}

	signed.Commits = signedCommits

	log.Printf("problem and solution confirmed successfully")
	final := new(Problem)
	if signed.ID == 0 {
		mustPostObject("/problems", nil, signed, final)
	} else {
		mustPutObject(fmt.Sprintf("/problems/%d", signed.ID), nil, signed, final)
	}
	log.Printf("problem %s (%q) saved and ready to use", final.Unique, final.Name)
}

type DaycareRequest struct {
	Problem *Problem `json:"problem,omitempty"`
	Commit  *Commit  `json:"commit,omitempty"`
	Stdin   string   `json:"stdin,omitempty"`
}

type DaycareResponse struct {
	Commit *Commit       `json:"commit,omitempty"`
	Event  *EventMessage `json:"event,omitempty"`
}

func mustConfirmCommit(problem *Problem, commit *Commit, args []string) *Commit {
	verbose := false

	// create a websocket connection to the server
	headers := make(http.Header)
	socket, resp, err := websocket.DefaultDialer.Dial("wss://"+Config.Host+"/api/v2/sockets/"+problem.ProblemType+"/confirm", headers)
	if err != nil {
		log.Printf("websocket dial: %v", err)
		if resp != nil && resp.Body != nil {
			io.Copy(os.Stderr, resp.Body)
			resp.Body.Close()
		}
		log.Fatalf("giving up")
	}
	defer socket.Close()

	// form the initial request
	req := &DaycareRequest{Problem: problem, Commit: commit}
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
		if reply.Commit != nil {
			return reply.Commit
		} else if reply.Event != nil {
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
		} else {
			log.Fatalf("unexpected reply from server")
		}
	}

	log.Fatalf("no commit returned from server")
	return nil
}
