package main

import (
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	. "github.com/russross/codegrinder/types"
)

// SetupDaycareRest registers daycare websocket endpoints using raw HTTP handlers
func SetupDaycareRest(mux *http.ServeMux) {
	// WebSocket endpoint for problem type actions
	socketPattern := regexp.MustCompile(`^/sockets/([^/]+)/([^/]+)$`)
	mux.HandleFunc("/sockets/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Extract URL parameters
		matches := socketPattern.FindStringSubmatch(r.URL.Path)
		if matches == nil {
			loggedHTTPErrorf(w, http.StatusNotFound, "Invalid socket URL format")
			return
		}
		problemType := matches[1]
		action := matches[2]

		// CORS header for browser-based requests if the TA is a different host than the daycare
		w.Header().Set("Access-Control-Allow-Origin", "https://"+Config.TAHostname)

		// get a websocket
		upgrader := websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
		}
		socket, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			loggedHTTPErrorf(w, http.StatusBadRequest, "websocket error: %v", err)
			return
		}
		defer func() {
			socket.WriteControl(websocket.CloseMessage, nil, time.Now().Add(5*time.Second))
			socket.Close()
		}()

		logAndTransmitErrorf := func(format string, args ...interface{}) {
			msg := fmt.Sprintf(format, args...)
			log.Print(msg)
			res := &DaycareResponse{Error: msg}
			if err := socket.WriteJSON(res); err != nil {
				// what can we do? we already logged the error
			}
		}

		// gather any args from URL query parameters
		r.ParseForm()
		args := []string{}
		for key, vals := range r.Form {
			if len(vals) == 1 {
				args = append(args, key+"="+vals[0])
			}
		}

		// get the first message
		req := new(DaycareRequest)
		if err := socket.ReadJSON(req); err != nil {
			logAndTransmitErrorf("error reading first request message: %v", err)
			return
		}

		// create output channel for responses
		responseChan := make(chan *DaycareResponse, 10) // buffered channel to reduce waiting on websocket
		finished := make(chan struct{})

		// start goroutine to read from channel and send to websocket
		go func() {
			broken := false
			for res := range responseChan {
				if broken {
					// on websocker error, continue draining channel but ignore values
					continue
				}
				if err := socket.WriteJSON(res); err != nil {
					// keep going to drain the channel so we can't block the sender
					broken = true
					if strings.Contains(err.Error(), "use of closed network connection") {
						// websocket closed
					} else {
						logAndTransmitErrorf("websocket write error: %v", err)
					}
				}
			}

			// signal that we finished
			finished <- struct{}{}
		}()

		// call the common handler
		commitBundle, err := HandleDaycareRequest(req, responseChan, problemType, action, args)

		// wait for channel and any websocket writes from it
		<-finished

		// now check error
		if err != nil {
			logAndTransmitErrorf("daycare request error: %v", err)
			return
		}

		// send the final commit back to the client if grading
		if commitBundle != nil && action == "grade" {
			res := &DaycareResponse{CommitBundle: commitBundle}
			if err := socket.WriteJSON(res); err != nil {
				logAndTransmitErrorf("error writing final commit JSON: %v", err)
				return
			}
		}

		log.Printf("daycare websocket handler finished for %s/%s", problemType, action)
	})
}
