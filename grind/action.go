package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	termbox "github.com/nsf/termbox-go"
	. "github.com/russross/codegrinder/types"
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
		cmd.Help()
		return
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

	// get the user ID
	user := new(User)
	mustGetObject("/users/me", nil, user)

	problem, _, commit, _ := gather(now, dir)
	commit.Action = action
	commit.Note = "grind tool session for action " + action
	unsigned := &CommitBundle{
		UserID: user.ID,
		Commit: commit,
	}

	// get the problem type
	problemType := new(ProblemType)
	mustGetObject(fmt.Sprintf("/problem_types/%s", problem.ProblemType), nil, problemType)
	if _, exists := problemType.Actions[action]; !exists {
		log.Fatalf("the %s problem type does not have action %q", problem.ProblemType, action)
	}

	// send the commit bundle to the server
	signed := new(CommitBundle)
	mustPostObject("/commit_bundles/unsigned", nil, unsigned, signed)

	// send it to the daycare for grading
	if signed.Hostname == "" {
		log.Fatalf("server was unable to find a suitable daycare, unable to grade")
	}
	log.Printf("starting interactive session for %s step %d", problem.Unique, commit.Step)
	runInteractiveSession(signed, nil)
}

func runInteractiveSession(bundle *CommitBundle, args []string) {
	headers := make(http.Header)
	url := "wss://" + bundle.Hostname + "/v2/sockets/" + bundle.Problem.ProblemType + "/" + bundle.Commit.Action
	socket, resp, err := websocket.DefaultDialer.Dial(url, headers)
	if err != nil {
		log.Printf("error dialing %s: %v", url, err)
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

	// start watching the keyboard
	if err := termbox.Init(); err != nil {
		log.Printf("initializing keyboard: %v", err)
		return
	}
	defer termbox.Close()

	// show the cursor
	fmt.Print("\033[?25h")

	go func() {
		for {
			key := []byte{}
			switch event := termbox.PollEvent(); event.Type {
			case termbox.EventKey:
				if event.Key > 0 && event.Key <= termbox.KeyBackspace2 {
					key = append(key, byte(event.Key))
				} else if event.Ch != 0 {
					key = append(key, byte(event.Ch))
				} else {
					// interpret some special keys using VT100 escape sequences
					switch event.Key {
					case termbox.KeyArrowUp:
						key = append(key, '\033', '[', 'A')
					case termbox.KeyArrowDown:
						key = append(key, '\033', '[', 'B')
					case termbox.KeyArrowRight:
						key = append(key, '\033', '[', 'C')
					case termbox.KeyArrowLeft:
						key = append(key, '\033', '[', 'D')
					case termbox.KeyInsert:
						key = append(key, '\033', '[', '2', '~')
					case termbox.KeyDelete:
						key = append(key, '\033', '[', '3', '~')
					case termbox.KeyHome:
						key = append(key, '\033', '[', 'H')
					case termbox.KeyEnd:
						key = append(key, '\033', '[', 'F')
					case termbox.KeyPgup:
						key = append(key, '\033', '[', '5', '~')
					case termbox.KeyPgdn:
						key = append(key, '\033', '[', '6', '~')
					}
				}
				if len(key) > 0 {
					stdinReq := &DaycareRequest{Stdin: string(key)}
					dumpOutgoing(stdinReq)
					if err := socket.WriteJSON(stdinReq); err != nil {
						log.Printf("error writing stdin request message: %v", err)
						return
					}
				} else {
					log.Printf("unimplemented input event %v", event)
				}

			case termbox.EventError:
				log.Printf("terminal error: %v", err)
				closeReq := &DaycareRequest{CloseStdin: true}
				dumpOutgoing(closeReq)
				if err := socket.WriteJSON(closeReq); err != nil {
					log.Printf("error writing stdin request message: %v", err)
					return
				}
				return
			}
		}
	}()

	/*
		// start watching the keyboard
		go func() {
			oldState, err := terminal.MakeRaw(0)
			if err != nil {
				log.Fatalf("putting terminal into raw mode: %v", err)
			}
			defer terminal.Restore(0, oldState)

			term := terminal.NewTerminal(os.Stdin, "")
			for {
				line, err := term.ReadLine()
				if err != nil {
					terminal.Restore(0, oldState)
					log.Fatalf("error reading line: %v", err)
				}
				stdinReq := &DaycareRequest{Stdin: line + "\n"}
				dumpOutgoing(stdinReq)
				if err := socket.WriteJSON(stdinReq); err != nil {
					log.Fatalf("error writing stdin request message: %v", err)
				}
			}
			closeReq := &DaycareRequest{CloseStdin: true}
			dumpOutgoing(closeReq)
			if err := socket.WriteJSON(closeReq); err != nil {
				log.Fatalf("error writing stdin EOF request message: %v", err)
			}
		}()
	*/

	// start listening for events
	for {
		reply := new(DaycareResponse)
		if err := socket.ReadJSON(reply); err != nil {
			log.Printf("socket error reading event: %v", err)
			return
		}
		dumpIncoming(reply)

		switch {
		case reply.Error != "":
			log.Printf("server returned an error:")
			log.Printf("  %s", reply.Error)
			return

		case reply.CommitBundle != nil:
			log.Printf("commit bundle returned, quitting")
			return

		case reply.Event != nil:
			switch reply.Event.Event {
			case "exec":
				fmt.Printf("$ %s\n", strings.Join(reply.Event.ExecCommand, " "))
			case "stdin":
				fmt.Printf("%s", reply.Event.StreamData)
			case "stdout":
				fmt.Printf("%s", reply.Event.StreamData)
			case "stderr":
				fmt.Printf("%s", reply.Event.StreamData)
			case "exit":
				fmt.Printf("exit status %d\n", reply.Event.ExitStatus)
			case "error":
				fmt.Printf("Error: %s\n", reply.Event.Error)
			}

		default:
			log.Printf("unexpected reply from server")
			return
		}
	}

	log.Printf("no commit returned from server")
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
