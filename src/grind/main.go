package main

import (
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

type Action struct {
	Type  string
	Files map[string]string
}

type EventMessage struct {
	Pid         int           `json:"pid,omitempty"`
	When        time.Time     `json:"-"`
	Since       time.Duration `json:"since"`
	Event       string        `json:"event"`
	ExecCommand []string      `json:"execcommand,omitempty"`
	ExitStatus  string        `json:"exitstatus,omitempty"`
	StreamData  string        `json:"streamdata,omitempty"`
	Error       string        `json:"error,omitempty"`
	//ReportCard  *ReportCard       `json:"reportcard,omitempty"`
	Files map[string]string `json:"files,omitempty"`
}

func getAllFiles() map[string]string {
	// gather all the files in the current directory
	files := make(map[string]string)
	err := filepath.Walk(".", func(path string, info os.FileInfo, err error) error {
		if err != nil {
			log.Printf("walk error for %s: %v", path, err)
			return err
		}
		if info.IsDir() {
			return nil
		}
		if strings.HasPrefix(path, ".") {
			return nil
		}
		contents, err := ioutil.ReadFile(path)
		if err != nil {
			log.Printf("error loading %s: %v", path, err)
			return err
		}
		log.Printf("found %s with %d bytes", path, len(contents))
		files[path] = string(contents)
		return nil
	})
	if err != nil {
		log.Fatalf("walk error: %v", err)
	}
	return files
}

func main() {
	// create a websocket connection to the server
	headers := make(http.Header)
	socket, resp, err := websocket.DefaultDialer.Dial("ws://dorking.cs.dixie.edu:8080/python2unittest", headers)
	if err != nil {
		log.Printf("websocket dial: %v", err)
		if resp != nil && resp.Body != nil {
			io.Copy(os.Stderr, resp.Body)
			resp.Body.Close()
		}
		log.Fatalf("giving up")
	}

	// get the files to submit
	var action Action
	action.Type = "python2unittest"
	action.Files = getAllFiles()
	if err := socket.WriteJSON(&action); err != nil {
		log.Fatalf("error writing Action message: %v", err)
	}

	// start listening for events
	for {
		var event EventMessage
		if err := socket.ReadJSON(&event); err != nil {
			log.Printf("socket error reading event: %v", err)
			break
		}
		fmt.Print(event.StreamData)
	}
	socket.Close()
	log.Printf("quitting")
}
