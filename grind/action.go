package main

import (
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/ssh/terminal"

	"github.com/gorilla/websocket"
	. "github.com/russross/codegrinder/common"
	"github.com/spf13/cobra"
)

func CommandAction(cmd *cobra.Command, args []string) {
	mustLoadConfig(cmd)
	now := time.Now()

	// find the directory
	dir := ""
	action := ""
	switch len(args) {
	case 0:
		dir = "."
	case 1:
		action = args[0]
		dir = "."
	case 2:
		action = args[0]
		dir = args[1]
	default:
		cmd.Help()
		return
	}
	if action == "grade" {
		log.Printf("'%s action' is for testing code, not for grading", os.Args[0])
		log.Fatalf("  to submit your code for grading, use '%s grade'", os.Args[0])
	}

	// get the user ID
	user := new(User)
	mustGetObject("/users/me", nil, user)

	problemType, problem, _, commit, _ := gather(now, dir)
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
	runInteractiveSession(signed, nil, dir)
}

func runInteractiveSession(bundle *CommitBundle, args []string, dir string) {
	stdin := int(os.Stdin.Fd())
	if !terminal.IsTerminal(stdin) {
		log.Printf("not a terminal")
	}

	// initialize the terminal
	if oldState, err := terminal.MakeRaw(stdin); err != nil {
		log.Printf("initializing terminal: %v", err)
		return
	} else {
		defer terminal.Restore(stdin, oldState)
	}

	headers := make(http.Header)
	vals := url.Values{}

	// get the terminal size
	sizex, sizey, err := terminal.GetSize(stdin)
	if err != nil && runtime.GOOS == "windows" {
		sizex, sizey, err = getWindowsTerminalSize()
	}
	if err != nil {
		log.Printf("error getting terminal size: %v", err)
	} else if sizex > 0 && sizey > 0 {
		vals.Set("COLUMNS", strconv.Itoa(sizex))
		vals.Set("LINES", strconv.Itoa(sizey))
	}
	if term := os.Getenv("TERM"); term != "" {
		vals.Set("TERM", term)
	} else if runtime.GOOS == "windows" {
		vals.Set("TERM", "cygwin")
	}

	endpoint := &url.URL{
		Scheme:   "wss",
		Host:     bundle.Hostname,
		Path:     "/v2/sockets/" + bundle.Problem.ProblemType + "/" + bundle.Commit.Action,
		RawQuery: vals.Encode(),
	}

	socket, resp, err := websocket.DefaultDialer.Dial(endpoint.String(), headers)
	if err != nil {
		log.Printf("error dialing: %v", err)
		if resp != nil && resp.Body != nil {
			io.Copy(os.Stderr, resp.Body)
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
			count, err := os.Stdin.Read(buffer)
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
				stdinReq := &DaycareRequest{Stdin: string(buffer[:count])}
				dumpOutgoing(stdinReq)
				if err := socket.WriteJSON(stdinReq); err != nil {
					log.Printf("error writing stdin request message: %v", err)
					return
				}
			}
		}
	}()

	// start listening for events
	cr := func(s string) string {
		pieces := strings.Split(s, "\r\n")
		for i := range pieces {
			pieces[i] = strings.Replace(pieces[i], "\n", "\r\n", -1)
		}
		return strings.Join(pieces, "\r\n")
	}
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
				fmt.Printf("%s", cr(reply.Event.Dump()))
			case "stderr":
				fmt.Fprintf(os.Stderr, "%s", cr(reply.Event.Dump()))
			case "files":
				if reply.Event.Files != nil {
					for name, contents := range reply.Event.Files {
						log.Printf("downloading file %s\r", name)
						if err := ioutil.WriteFile(filepath.Join(dir, name), []byte(contents), 0644); err != nil {
							log.Fatalf("error saving file: %v\r", err)
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

func dumpOutgoing(msg interface{}) {
	if Config.apiDump {
		raw, err := json.MarshalIndent(msg, "", "    ")
		if err != nil {
			log.Fatalf("json error encoding request: %v", err)
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
		log.Printf("<-- %s\n", raw)
	}
}
