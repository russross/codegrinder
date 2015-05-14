package main

import (
	"log"
	"net/http"

	"github.com/fsouza/go-dockerclient"
	"github.com/go-martini/martini"
	"github.com/gorilla/websocket"
)

type Action struct {
	Type  string
	Files map[string]string
}

func main() {
	// attach and try a ping
	var err error
	dockerClient, err = docker.NewVersionedClient("unix:///var/run/docker.sock", "1.18")
	if err != nil {
		log.Fatalf("NewVersionedClient: %v", err)
	}
	if err = dockerClient.Ping(); err != nil {
		log.Fatalf("Ping: %v", err)
	}

	// set up a web handler
	m := martini.Classic()
	m.Get("/python2unittest", func(w http.ResponseWriter, r *http.Request) {
		// set up websocket
		socket, err := websocket.Upgrade(w, r, nil, 1024, 1024)
		if err != nil {
			log.Printf("websocket error: %v", err)
			http.Error(w, "websocket error", http.StatusBadRequest)
			return
		}
		log.Printf("websocket upgraded")

		// get the first message
		var action Action
		if err := socket.ReadJSON(&action); err != nil {
			log.Printf("error reading Action message: %v", err)
			socket.Close()
			return
		}
		log.Printf("read request: type = %s", action.Type)

		// launch a nanny process
		n, err := NewNanny("codegrinder/python2", "foo")
		if err != nil {
			log.Fatalf("error creating nanny")
		}

		// start a listener
		finished := make(chan struct{})
		go func() {
			for event := range n.Events {
				// feed events back to client
				if err := socket.WriteJSON(event); err != nil {
					log.Printf("error writing event JSON: %v", err)
				}
			}
			finished <- struct{}{}
		}()

		// grade the problem
		rc := NewReportCard()
		python2UnittestGrade(n, rc, nil, nil, action.Files)
		dump(rc)

		// shutdown the nanny
		if err := n.Shutdown(); err != nil {
			log.Printf("nanny shutdown error: %v", err)
		}

		// wait for listener to finish
		close(n.Events)
		<-finished

		socket.Close()
	})
	m.RunOnAddr(":8080")
}
