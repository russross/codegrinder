package main

import (
	"crypto/hmac"
	"fmt"
	"net/http"
	"time"

	"github.com/go-martini/martini"
	"github.com/gorilla/websocket"
)

const MaxDaycareRequestAge = 15 * time.Minute

type DaycareRequest struct {
	Problem *Problem `json:"problem,omitempty"`
	Commit  *Commit  `json:"commit,omitempty"`
	Stdin   string   `json:"stdin,omitempty"`
}

type DaycareResponse struct {
	Commit *Commit       `json:"commit,omitempty"`
	Event  *EventMessage `json:"event,omitempty"`
	Error  string        `json:"error,omitempty"`
}

func SocketProblemTypeAction(w http.ResponseWriter, r *http.Request, params martini.Params) {
	now := time.Now()

	problemType, exists := problemTypes[params["problem_type"]]
	if !exists {
		loggedHTTPErrorf(w, http.StatusNotFound, "problem type %q not found", params["problem_type"])
		return
	}
	action, exists := problemType.Actions[params["action"]]
	if !exists {
		loggedHTTPErrorf(w, http.StatusNotFound, "action %q not defined from problem type %s", params["action"], params["problem_type"])
		return
	}

	// get a websocket
	socket, err := websocket.Upgrade(w, r, nil, 1024, 1024)
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "websocket error: %v", err)
		return
	}
	defer socket.Close()
	logAndTransmitErrorf := func(format string, args ...interface{}) {
		msg := fmt.Sprintf(format, args...)
		loge.Print(msg)
		res := &DaycareResponse{Error: msg}
		if err := socket.WriteJSON(res); err != nil {
			// what can we do? we already logged the error
		}
	}

	// get the first message
	req := new(DaycareRequest)
	if err := socket.ReadJSON(req); err != nil {
		logAndTransmitErrorf("error reading first request message: %v", err)
		return
	}
	if req.Problem == nil {
		logAndTransmitErrorf("first request message must include the problem")
		return
	}
	problem := req.Problem
	if req.Commit == nil {
		logAndTransmitErrorf("first request message must include the commit")
		return
	}
	commit := req.Commit

	if problem.Signature == "" {
		logAndTransmitErrorf("problem must be signed")
		return
	}
	problemSig := problem.computeSignature(Config.DaycareSecret)
	if !hmac.Equal([]byte(problem.Signature), []byte(problemSig)) {
		logAndTransmitErrorf("problem signature mismatch: found %s but expected %s", problem.Signature, problemSig)
		return
	}

	// check commit signature
	if commit.ProblemSignature != problemSig {
		logAndTransmitErrorf("commit says problem signature is %s, but it is actually %s", commit.ProblemSignature, problemSig)
		return
	}
	age := time.Since(commit.UpdatedAt)
	if age < 0 {
		age = -age
	}
	if age > MaxDaycareRequestAge {
		logAndTransmitErrorf("commit signature is %v off, cannot be more than %v", age, MaxDaycareRequestAge)
		return
	}
	if commit.Signature == "" {
		logAndTransmitErrorf("commit must be signed")
		return
	}
	if commit.Action != params["action"] {
		logAndTransmitErrorf("commit says action is %s, but request says %s", commit.Action, params["action"])
		return
	}
	commitSig := commit.computeSignature(Config.DaycareSecret)
	if !hmac.Equal([]byte(commit.Signature), []byte(commitSig)) {
		logAndTransmitErrorf("commit signature mismatch: found %s but expected %s", commit.Signature, commitSig)
		return
	}

	// prepare the problem step
	if commit.ProblemStepNumber < 0 || commit.ProblemStepNumber >= len(problem.Steps) {
		logAndTransmitErrorf("commit refers to step number that does not exist: %d", commit.ProblemStepNumber)
		return
	}

	// collect the files from the problem step
	step := problem.Steps[commit.ProblemStepNumber]
	files := make(map[string]string)
	for name, contents := range step.Files {
		files[name] = contents
	}

	// add the files from the commit
	whitelists := getStepWhitelists(problem)
	if err := commit.normalize(now, whitelists[commit.ProblemStepNumber]); err != nil {
		logAndTransmitErrorf("error in commit: %v", err)
		return
	}
	for name, contents := range commit.Files {
		files[name] = contents
	}

	// launch a nanny process
	nannyName := fmt.Sprintf("nanny-user-%d", commit.UserID)
	logi.Printf("launching container for %s", nannyName)
	n, err := NewNanny(problemType.Image, nannyName)
	if err != nil {
		logAndTransmitErrorf("error creating nanny: %v", err)
		return
	}

	// start a listener
	finished := make(chan struct{})
	go func() {
		for event := range n.Events {
			// record the event
			commit.Transcript = append(commit.Transcript, event)

			// feed event back to client
			switch event.Event {
			case "exec", "exit", "stdin", "stdout", "stderr", "stdinclosed", "error":
				res := &DaycareResponse{Event: event}
				if err := socket.WriteJSON(res); err != nil {
					logAndTransmitErrorf("error writing event JSON: %v", err)
				}
			}
		}
		finished <- struct{}{}
	}()

	// grade the problem
	r.ParseForm()
	action.handler(n, r.Form["args"], problem.Options, files)
	commit.ReportCard = n.ReportCard
	//dump(commit.ReportCard)

	// shutdown the nanny
	if err := n.Shutdown(); err != nil {
		logAndTransmitErrorf("nanny shutdown error: %v", err)
	}

	// wait for listener to finish
	close(n.Events)
	<-finished

	// send the final commit back to the client
	commit.compress()

	// compute the score for this step on a scale of 0.0 to 1.0
	if commit.ReportCard.Passed {
		// award full credit for this step
		commit.Score = 1.0
	} else if len(commit.ReportCard.Results) == 0 {
		// no results? fail...
		commit.Score = 0.0
	} else {
		// compute partial credit for this step
		passed := 0
		for _, elt := range commit.ReportCard.Results {
			if elt.Outcome == "passed" {
				passed++
			}
		}
		commit.Score = float64(passed) / float64(len(commit.ReportCard.Results))
	}
	commit.UpdatedAt = now
	commit.Signature = commit.computeSignature(Config.DaycareSecret)

	res := &DaycareResponse{Commit: commit}
	if err := socket.WriteJSON(res); err != nil {
		logAndTransmitErrorf("error writing final commit JSON: %v", err)
		return
	}
}
