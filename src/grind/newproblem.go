package main

import (
	"encoding/json"
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
	d := context.Args().First()
	if d == "" {
		d = "."
	}
	if context.Args().First() != "" {
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
			if err == os.ErrNotExist {
				// try moving up a directory
				old := dir
				dir = filepath.Dir(dir)
				if dir == old {
					log.Fatalf("unable to find %s in %s or an ancestor directory", ProblemConfigName, d)
				}
				fmt.Printf("could not find %s in %s, trying %s", ProblemConfigName, old, dir)
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

	// import steps
	for i := 1; cfg.Step[strconv.Itoa(i)] != nil; i++ {
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
			Closed:            true,
			CreatedAt:         now,
			UpdatedAt:         now,
			Timestamp:         &now,
		}

		// read files
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
			reldir, relfile := filepath.Split(relpath)
			if reldir == "_solution/" && reldir != "" {
				commit.Files[relfile] = string(contents)
			} else {
				step.Files[relpath] = string(contents)
			}
			return nil
		})
		if err != nil {
			log.Fatalf("walk error for %s: %v", stepdir, err)
		}

		problem.Steps = append(problem.Steps, step)
		problem.Commits = append(problem.Commits, commit)
		log.Printf("step %d: found %d problem file%s and %d solution file%s", i, len(step.Files), plural(len(step.Files)), len(commit.Files), plural(len(commit.Files)))
	}

	if len(problem.Steps) != len(cfg.Step) {
		log.Fatalf("expected to find %d steps, but only found %d", len(cfg.Step), len(problem.Steps))
	}

	// get the request validated and signed
	signed := new(Problem)
	mustPostFetchObject("/problems/unconfirmed", nil, Config.Cookie, problem, signed)

	// validate the commits one at a time
	commitList := signed.Commits
	signed.Commits = nil
	var signedCommits []*Commit
	for n, commit := range commitList {
		log.Printf("validating solution for step %d", n+1)
		signedCommit := mustConfirmCommit(signed, commit, nil)
		signedCommits = append(signedCommits, signedCommit)
	}

	signed.Commits = signedCommits

	fmt.Printf("problem so far:\n")
	raw, err := json.MarshalIndent(signed, "", "    ")
	if err != nil {
		log.Fatalf("JSON encoding error: %v", err)
	}
	fmt.Printf("%s\n", raw)
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
			log.Printf("server returned a commit object")
			return reply.Commit
		} else if reply.Event != nil {
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
				color.Cyan("exit status %d\n", reply.Event.ExitStatus)
			case "error":
				color.Red("Error: %s\n", reply.Event.Error)
			}
		} else {
			log.Fatalf("unexpected reply from server")
		}
	}

	log.Fatalf("no commit returned from server")
	return nil
}
