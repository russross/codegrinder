package main

import (
	"archive/tar"
	"bytes"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"time"

	"github.com/fsouza/go-dockerclient"
	"github.com/go-martini/martini"
	"github.com/gorilla/websocket"
	. "github.com/russross/codegrinder/types"
)

var dockerClient *docker.Client

// SocketProblemTypeAction handles a request to /sockets/:problem_type/:action
// It expects a websocket connection, which will receive a series of DaycareRequest objects
// and will respond with DaycareResponse objects, though not in a one-to-one fashion.
// The first DaycareRequest must have the CommitBundle field present. Future requests
// should only have Stdin present.
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
		log.Print(msg)
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

	// sanity check
	if req.CommitBundle == nil {
		logAndTransmitErrorf("first request message must include the commit bundle")
		return
	}
	if req.CommitBundle.Problem == nil {
		logAndTransmitErrorf("commit bundle must include the problem")
		return
	}
	if len(req.CommitBundle.ProblemSteps) == 0 {
		logAndTransmitErrorf("commit bundle must include the problem steps")
		return
	}
	if len(req.CommitBundle.ProblemSignature) == 0 {
		logAndTransmitErrorf("commit bundle must include the problem signature")
		return
	}
	if req.CommitBundle.Commit == nil {
		logAndTransmitErrorf("commit bundle must include the commit")
		return
	}
	if len(req.CommitBundle.CommitSignature) == 0 {
		logAndTransmitErrorf("commit bundle must include the commit signature")
		return
	}

	// check signatures
	problem, steps := req.CommitBundle.Problem, req.CommitBundle.ProblemSteps
	problemSig := problem.ComputeSignature(Config.DaycareSecret, steps)
	if req.CommitBundle.ProblemSignature != problemSig {
		logAndTransmitErrorf("problem signature mismatch: found %s but expected %s", req.CommitBundle.ProblemSignature, problemSig)
		return
	}
	commit := req.CommitBundle.Commit
	commitSig := commit.ComputeSignature(Config.DaycareSecret, problemSig)
	if req.CommitBundle.CommitSignature != commitSig {
		logAndTransmitErrorf("commit signature mismatch: found %s but expected %s", req.CommitBundle.CommitSignature, commitSig)
		return
	}
	req.CommitBundle.CommitSignature = ""

	// commit must be recent
	age := time.Since(commit.UpdatedAt)
	if age < 0 {
		// be forgiving of clock skew
		age = -age
	}
	if age > MaxDaycareRequestAge {
		logAndTransmitErrorf("commit signature is %v off, cannot be more than %v", age, MaxDaycareRequestAge)
		return
	}
	if commit.Action != params["action"] {
		logAndTransmitErrorf("commit says action is %s, but request says %s", commit.Action, params["action"])
		return
	}

	// find the problem step
	if commit.Step < 1 || commit.Step > int64(len(steps)) {
		logAndTransmitErrorf("commit refers to step number %d, but there are %d steps in the problem", commit.Step, len(steps))
		return
	}
	step := steps[commit.Step-1]
	if step.Step != commit.Step {
		logAndTransmitErrorf("step number %d in the problem thinks it is step number %d", commit.Step, step.Step)
		return
	}

	// collect the files from the problem step and overlay the files from the commit
	files := make(map[string]string)
	for name, contents := range step.Files {
		files[name] = contents
	}
	for name, contents := range commit.Files {
		files[name] = contents
	}

	// launch a nanny process
	nannyName := fmt.Sprintf("nanny-user-%d", req.UserID)
	log.Printf("launching container for %s", nannyName)
	n, err := NewNanny(problemType, problem, nannyName)
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
	handler, ok := action.Handler.(nannyHandler)
	if ok {
		handler(n, r.Form["args"], problem.Options, files)
	} else {
		logAndTransmitErrorf("handler for action %s is of wrong type", commit.Action)
	}
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
	commit.Compress()

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
	req.CommitBundle.CommitSignature = commit.ComputeSignature(Config.DaycareSecret, req.CommitBundle.ProblemSignature)

	res := &DaycareResponse{CommitBundle: req.CommitBundle}
	if err := socket.WriteJSON(res); err != nil {
		logAndTransmitErrorf("error writing final commit JSON: %v", err)
		return
	}
}

type Nanny struct {
	Start      time.Time
	Container  *docker.Container
	ReportCard *ReportCard
	Input      chan string
	Events     chan *EventMessage
	Transcript []*EventMessage
}

type nannyHandler func(*Nanny, []string, []string, map[string]string)

var getContainerIDRE = regexp.MustCompile(`The name .* is already in use by container (.*)\. You have to delete \(or rename\) that container to be able to reuse that name`)

func getContainerID(msg string) string {
	groups := getContainerIDRE.FindStringSubmatch(msg)
	if len(groups) != 2 {
		return ""
	}
	return groups[1]
}

func NewNanny(problemType *ProblemType, problem *Problem, name string) (*Nanny, error) {
	// create a container
	mem := problemType.MaxMemory * 1024 * 1024
	config := &docker.Config{
		Hostname:        name,
		Memory:          int64(mem),
		MemorySwap:      -1,
		NetworkDisabled: true,
		Cmd:             []string{"/bin/sh", "-c", "sleep infinity"},
		Image:           problemType.Image,
	}
	hostConfig := &docker.HostConfig{
		CapDrop: []string{
			"NET_RAW",
			"NET_BIND_SERVICE",
			"AUDIT_READ",
			"AUDIT_WRITE",
			"DAC_OVERRIDE",
			"SETFCAP",
			"SETPCAP",
			"SETGID",
			"SETUID",
			"MKNOD",
			"CHOWN",
			"FOWNER",
			"FSETID",
			"KILL",
			"SYS_CHROOT",
		},
		Ulimits: []docker.ULimit{},
	}

	container, err := dockerClient.CreateContainer(docker.CreateContainerOptions{Name: name, Config: config, HostConfig: hostConfig})
	if err != nil {
		if apiError, ok := err.(*docker.Error); ok && apiError.Status == http.StatusConflict && getContainerID(apiError.Message) != "" {
			// container already exists with that name--try killing it
			err2 := dockerClient.RemoveContainer(docker.RemoveContainerOptions{
				ID:    getContainerID(apiError.Message),
				Force: true,
			})
			if err2 != nil {
				log.Printf("NewNanny->StartContainer error killing existing container: %v", err2)
				return nil, err2
			}

			// try it one more time
			container, err = dockerClient.CreateContainer(docker.CreateContainerOptions{Name: name, Config: config, HostConfig: hostConfig})
		}
		if err != nil {
			log.Printf("NewNanny->CreateContainer: %#v", err)
			return nil, err
		}
	}

	// start it
	err = dockerClient.StartContainer(container.ID, nil)
	if err != nil {
		log.Printf("NewNanny->StartContainer: %v", err)
		err2 := dockerClient.RemoveContainer(docker.RemoveContainerOptions{
			ID:    container.ID,
			Force: true,
		})
		if err2 != nil {
			log.Printf("NewNanny->StartContainer error killing container: %v", err2)
		}
		return nil, err
	}

	return &Nanny{
		Start:      time.Now(),
		Container:  container,
		ReportCard: NewReportCard(),
		Input:      make(chan string),
		Events:     make(chan *EventMessage),
		Transcript: []*EventMessage{},
	}, nil
}

func (n *Nanny) Shutdown() error {
	// shut down the container
	err := dockerClient.RemoveContainer(docker.RemoveContainerOptions{
		ID:    n.Container.ID,
		Force: true,
	})
	if err != nil {
		log.Printf("Nanny.Shutdown: %v", err)
		return err
	}
	return nil
}

// PutFiles copies a set of files to the given container.
// The container must be running.
func (n *Nanny) PutFiles(files map[string]string) error {
	// nothing to do?
	if len(files) == 0 {
		return nil
	}

	// tar the files
	now := time.Now()
	buf := new(bytes.Buffer)
	writer := tar.NewWriter(buf)
	for name, contents := range files {
		header := &tar.Header{
			Name:       name,
			Mode:       0644,
			Uid:        10000,
			Gid:        10000,
			Size:       int64(len(contents)),
			ModTime:    now,
			Typeflag:   tar.TypeReg,
			Uname:      "student",
			Gname:      "student",
			AccessTime: now,
			ChangeTime: now,
		}
		if err := writer.WriteHeader(header); err != nil {
			log.Printf("PutFiles: writing tar header: %v", err)
			return err
		}
		if _, err := writer.Write([]byte(contents)); err != nil {
			log.Printf("PutFiles: writing to tar file: %v", err)
			return err
		}
	}
	if err := writer.Close(); err != nil {
		log.Printf("PutFiles: closing tar file: %v", err)
		return err
	}

	// exec tar in the container
	exec, err := dockerClient.CreateExec(docker.CreateExecOptions{
		AttachStdin:  true,
		AttachStdout: true,
		AttachStderr: true,
		Tty:          false,
		Cmd:          []string{"/bin/tar", "xf", "-"},
		Container:    n.Container.ID,
	})
	if err != nil {
		log.Printf("PutFiles: creating exec command: %v", err)
		return err
	}
	out := new(bytes.Buffer)
	err = dockerClient.StartExec(exec.ID, docker.StartExecOptions{
		Detach:       false,
		Tty:          false,
		InputStream:  buf,
		OutputStream: out,
		ErrorStream:  out,
		RawTerminal:  false,
	})
	if err != nil {
		log.Printf("PutFiles: starting exec command: %v", err)
		return err
	}

	if out.Len() != 0 {
		log.Printf("PutFiles: tar output: %q", out.String())
		return fmt.Errorf("PutFiles: tar gave non-empty output")
	}
	return nil
}

// GetFiles copies a set of files from the given container.
// The container must be running.
func (n *Nanny) GetFiles(filenames []string) (map[string]string, error) {
	// nothing to do?
	if len(filenames) == 0 {
		return nil, nil
	}

	// exec tar in the container
	exec, err := dockerClient.CreateExec(docker.CreateExecOptions{
		AttachStdin:  false,
		AttachStdout: true,
		AttachStderr: true,
		Tty:          false,
		Cmd:          append([]string{"/bin/tar", "cf", "-"}, filenames...),
		Container:    n.Container.ID,
	})
	if err != nil {
		log.Printf("GetFiles: creating exec command: %v", err)
		return nil, err
	}
	tarFile := new(bytes.Buffer)
	tarErr := new(bytes.Buffer)
	err = dockerClient.StartExec(exec.ID, docker.StartExecOptions{
		Detach:       false,
		Tty:          false,
		InputStream:  nil,
		OutputStream: tarFile,
		ErrorStream:  tarErr,
		RawTerminal:  false,
	})
	if err != nil {
		log.Printf("GetFiles: starting exec command: %v", err)
		return nil, err
	}

	if tarErr.Len() != 0 {
		log.Printf("GetFiles: tar error output: %q", tarErr.String())
		return nil, fmt.Errorf("GetFiles: tar gave non-empty error output")
	}

	// untar the files
	files := make(map[string]string)
	reader := tar.NewReader(tarFile)
	for {
		header, err := reader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			log.Printf("GetFiles: reading tar file header: %v", err)
			return nil, err
		}
		if header.Typeflag != tar.TypeReg {
			continue
		}
		if header.Size == 0 {
			files[header.Name] = ""
			continue
		}
		contents := make([]byte, int(header.Size))
		if _, err = reader.Read(contents); err != nil {
			log.Printf("GetFiles: reading tar file contents: %v", err)
			return nil, err
		}
		files[header.Name] = string(contents)
	}

	return files, nil
}

type execOutput struct {
	stdout bytes.Buffer
	stderr bytes.Buffer
	script bytes.Buffer
	events chan *EventMessage
}

type execStdout execOutput

func (out *execStdout) Write(data []byte) (n int, err error) {
	n, err = out.stdout.Write(data)
	if err != nil || n != len(data) {
		log.Printf("execStdout.Write: error writing to stdout buffer: %v", err)
		return n, err
	}
	n, err = out.script.Write(data)
	if err != nil || n != len(data) {
		log.Printf("execStdout.Write: error writing to script buffer: %v", err)
		return n, err
	}

	out.events <- &EventMessage{
		Time:       time.Now(),
		Event:      "stdout",
		StreamData: string(data),
	}

	return n, err
}

type execStderr execOutput

func (out *execStderr) Write(data []byte) (n int, err error) {
	n, err = out.stderr.Write(data)
	if err != nil || n != len(data) {
		log.Printf("execStderr.Write: error writing to stderr buffer: %v", err)
		return n, err
	}
	n, err = out.script.Write(data)
	if err != nil || n != len(data) {
		log.Printf("execStderr.Write: error writing to script buffer: %v", err)
		return n, err
	}

	out.events <- &EventMessage{
		Time:       time.Now(),
		Event:      "stderr",
		StreamData: string(data),
	}

	return n, err
}

func (n *Nanny) ExecNonInteractive(cmd []string) (stdout, stderr, script *bytes.Buffer, status int, err error) {
	// log the event
	n.Events <- &EventMessage{
		Time:        time.Now(),
		Event:       "exec",
		ExecCommand: cmd,
	}

	// create
	exec, err := dockerClient.CreateExec(docker.CreateExecOptions{
		AttachStdin:  false,
		AttachStdout: true,
		AttachStderr: true,
		Tty:          false,
		Cmd:          cmd,
		Container:    n.Container.ID,
	})
	if err != nil {
		log.Printf("Nanny.ExecNonInteractive->docker.CreateExec: %v", err)
		return nil, nil, nil, -1, err
	}

	// gather output
	var out execOutput
	out.events = n.Events

	// start
	err = dockerClient.StartExec(exec.ID, docker.StartExecOptions{
		Detach:       false,
		Tty:          false,
		InputStream:  nil,
		OutputStream: (*execStdout)(&out),
		ErrorStream:  (*execStderr)(&out),
		RawTerminal:  false,
	})
	if err != nil {
		log.Printf("Nanny.ExecNonInteractive->docker.StartExec: %v", err)
		return nil, nil, nil, -1, err
	}

	// inspect
	inspect, err := dockerClient.InspectExec(exec.ID)
	if err != nil {
		log.Printf("Nanny.ExecNonInteractive->docker.InspectExec: %v", err)
		return nil, nil, nil, -1, err
	}
	if inspect.Running {
		log.Printf("Nanny.ExecNonInteractive: process still running")
	} else {
		n.Events <- &EventMessage{
			Time:       time.Now(),
			Event:      "exit",
			ExitStatus: fmt.Sprintf("exit status %d", inspect.ExitCode),
		}
	}
	return &out.stdout, &out.stderr, &out.script, inspect.ExitCode, nil
}
