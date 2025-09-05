package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"github.com/gorilla/websocket"
	. "github.com/russross/codegrinder/types"
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

	// Check if the --daycare flag is set (instructor only)
	daycareFlag := cmd.Flag("daycare")
	if daycareFlag != nil && daycareFlag.Value.String() != "" {
		// Instructor is using a direct daycare connection
		daycareHost := formatDaycareURL(daycareFlag.Value.String())

		// Extract the hostname part for the signature
		parsedURL, err := url.Parse(daycareHost)
		if err != nil {
			log.Fatalf("invalid daycare URL: %v", err)
		}

		// Prepare the signed bundle
		bundle, err := prepareSignedBundle(now, action, parsedURL.Host)
		if err != nil {
			log.Fatalf("error preparing signed bundle: %v", err)
		}

		fmt.Printf("starting interactive session for %s step %d with daycare server %s\n",
			bundle.Problem.Unique, bundle.Commit.Step, daycareHost)

		// Connect to the specified daycare server directly
		runInteractiveSession(bundle, nil, ".")
		return
	}

	// do not allow grade as an interactive action
	if action == "grade" {
		log.Printf("'%s action' is for testing code, not for grading", os.Args[0])
		log.Fatalf("  to submit your code for grading, use '%s grade'", os.Args[0])
	}

	// get the user ID
	user := new(User)
	mustGetObject("/users/me", nil, user)

	problemType, problem, _, _, commit, _, _ := gatherStudent(now, ".")
	commit.Action = action
	commit.Note = "grind action " + action
	unsigned := &CommitBundle{
		UserID: user.ID,
		Commit: commit,
	}

	// if the requested action does not exist, report available choices
	if _, exists := problemType.Actions[action]; !exists {
		fmt.Printf("available actions for problem type %s:\n", problemType.Name)
		for elt := range problemType.Actions {
			if elt == "grade" {
				continue
			}
			fmt.Printf("   %s\n", elt)
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
	fmt.Printf("starting interactive session for %s step %d\n", problem.Unique, commit.Step)
	runInteractiveSession(signed, nil, ".")
}

func runInteractiveSession(bundle *CommitBundle, args []string, directory string) {
	endpoint := &url.URL{
		Scheme: "wss",
		Host:   bundle.Hostname,
		Path:   "/sockets/" + bundle.ProblemType.Name + "/" + bundle.Commit.Action,
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
				fmt.Printf("%s", reply.Event.Dump())
			case "stderr":
				fmt.Printf("%s", reply.Event.Dump())
			case "files":
				if reply.Event.Files != nil {
					for name, contents := range reply.Event.Files {
						log.Printf("downloading file %s\r", name)
						if err := ioutil.WriteFile(filepath.Join(directory, filepath.FromSlash(name)), contents, 0644); err != nil {
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
