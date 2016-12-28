package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"time"

	"github.com/gorilla/websocket"
	. "github.com/russross/codegrinder/common"
	"github.com/russross/codegrinder/term"
	"github.com/russross/codegrinder/tty"
	"github.com/spf13/cobra"
)

func CommandAction(cmd *cobra.Command, args []string) {
	mustLoadConfig(cmd)
	now := time.Now()

	action := ""
	if len(args) > 1 {
		cmd.Help()
		os.Exit(1)
	} else if len(args) == 1 {
		action = args[0]
	}

	// do not allow grade as an interactive action
	if action == "grade" {
		log.Printf("'%s action' is for testing code, not for grading", os.Args[0])
		log.Fatalf("  to submit your code for grading, use '%s grade'", os.Args[0])
	}

	// get the user ID
	user := new(User)
	mustGetObject("/users/me", nil, user)

	problemType, problem, _, commit, _ := gatherStudent(now, ".")
	commit.Action = action
	commit.Note = "grind tool session for action " + action
	unsigned := &CommitBundle{
		UserID: user.ID,
		Commit: commit,
	}

	// if the requested action does not exist, report available choices
	if _, exists := problemType.Actions[action]; !exists {
		log.Printf("available actions for problem type %s:", problem.ProblemType)
		for elt := range problemType.Actions {
			if elt == "grade" {
				continue
			}
			log.Printf("   %s", elt)
		}
		log.Fatalf("use '%s action [action]' to initiate an action", os.Args[0])
	}

	// send the commit bundle to the server
	signed := new(CommitBundle)
	mustPostObject("/commit_bundles/unsigned", nil, unsigned, signed)

	// send it to the daycare for grading
	if signed.Hostname == "" {
		log.Fatalf("server was unable to find a suitable daycare, unable to run action")
	}
	log.Printf("starting interactive session for %s step %d", problem.Unique, commit.Step)
	runInteractiveSession(signed, nil, ".")
}

func runInteractiveSession(bundle *CommitBundle, args []string, dir string) {
	stdin, stdout, stderr := term.StdStreams()

	// initialize the input terminal
	in := tty.NewInStream(stdin)
	if !in.IsTerminal() {
		log.Printf("stdin not a terminal")
	}
	if err := in.SetRawTerminal(); err != nil {
		log.Printf("initializing stdin: %v", err)
		return
	}
	defer in.RestoreTerminal()

	// initialize the output terminal
	out := tty.NewOutStream(stdout)
	if !out.IsTerminal() {
		log.Printf("stdout not a terminal")
	}
	if err := out.SetRawTerminal(); err != nil {
		log.Printf("initializing stdout: %v", err)
		return
	}
	rawMode = true
	defer func() { rawMode = false }()
	defer out.RestoreTerminal()

	vals := url.Values{}

	// get the terminal size
	sizey, sizex := out.GetTtySize()
	if sizex > 0 && sizey > 0 {
		vals.Set("COLUMNS", strconv.Itoa(int(sizex)))
		vals.Set("LINES", strconv.Itoa(int(sizey)))
	}
	if term := os.Getenv("TERM"); term != "" {
		vals.Set("TERM", term)
	} else if runtime.GOOS == "windows" {
		vals.Set("TERM", "ansi")
	}

	endpoint := &url.URL{
		Scheme:   "wss",
		Host:     bundle.Hostname,
		Path:     urlPrefix + "/sockets/" + bundle.Problem.ProblemType + "/" + bundle.Commit.Action,
		RawQuery: vals.Encode(),
	}

	socket, resp, err := websocket.DefaultDialer.Dial(endpoint.String(), nil)
	if err != nil {
		log.Printf("error dialing: %v", err)
		if resp != nil && resp.Body != nil {
			dumpBody(resp)
			resp.Body.Close()
		}
		log.Printf("giving up")
		return
	}
	defer socket.Close()

	// form the initial request
	req := &DaycareRequest{CommitBundle: bundle}
	dumpOutgoing(req)
	if err := socket.WriteJSON(req); err != nil {
		log.Printf("error writing request message: %v", err)
		return
	}

	go func() {
		for {
			buffer := make([]byte, 256)
			count, err := in.Read(buffer)
			if count == 0 && err == io.EOF {
				closeReq := &DaycareRequest{CloseStdin: true}
				dumpOutgoing(closeReq)
				if err := socket.WriteJSON(closeReq); err != nil {
					log.Printf("error writing stdin request message: %v", err)
					return
				}
			} else if err != nil {
				log.Printf("terminal error: %v", err)
				closeReq := &DaycareRequest{CloseStdin: true}
				dumpOutgoing(closeReq)
				if err := socket.WriteJSON(closeReq); err != nil {
					log.Printf("error writing stdin request message: %v", err)
				}
				return
			}

			if count > 0 {
				data := make([]byte, count)
				copy(data, buffer[:count])
				stdinReq := &DaycareRequest{Stdin: data}
				dumpOutgoing(stdinReq)
				if err := socket.WriteJSON(stdinReq); err != nil {
					log.Printf("error writing stdin request message: %v", err)
					return
				}
			}
		}
	}()

	// start listening for events
	for {
		reply := new(DaycareResponse)
		if err := socket.ReadJSON(reply); err != nil {
			//log.Printf("socket error reading event: %v", err)
			log.Printf("session closed by server\r")
			return
		}
		dumpIncoming(reply)

		switch {
		case reply.Error != "":
			log.Printf("server returned an error:\r")
			log.Printf("  %s\r", reply.Error)
			return

		case reply.CommitBundle != nil:
			log.Printf("commit bundle returned, quitting\r")
			return

		case reply.Event != nil:
			switch reply.Event.Event {
			case "exec", "stdin", "stdout", "exit", "error":
				fmt.Fprintf(out, "%s", reply.Event.Dump())
			case "stderr":
				fmt.Fprintf(stderr, "%s", reply.Event.Dump())
			case "files":
				if reply.Event.Files != nil {
					for name, contents := range reply.Event.Files {
						log.Printf("downloading file %s\r", name)
						if err := ioutil.WriteFile(filepath.Join(dir, filepath.FromSlash(name)), contents, 0644); err != nil {
							log.Printf("error saving file: %v\r", err)
						}
					}
				}
			}

		default:
			log.Printf("unexpected reply from server\r")
			return
		}
	}
}

var rawMode = false

func dumpOutgoing(msg interface{}) {
	if Config.apiDump {
		raw, err := json.MarshalIndent(msg, "", "    ")
		if err != nil {
			log.Fatalf("json error encoding request: %v", err)
		}
		if rawMode {
			raw = bytes.Replace(raw, []byte("\n"), []byte("\r\n"), -1)
		}
		log.Printf("--> %s\n", raw)
	}
}

func dumpIncoming(msg interface{}) {
	if Config.apiDump {
		raw, err := json.MarshalIndent(msg, "", "    ")
		if err != nil {
			log.Fatalf("json error encoding request: %v", err)
		}
		if rawMode {
			raw = bytes.Replace(raw, []byte("\n"), []byte("\r\n"), -1)
		}
		log.Printf("<-- %s\n", raw)
	}
}
