package main

import (
	"archive/tar"
	"bytes"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
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
	if len(req.CommitBundle.Hostname) == 0 {
		logAndTransmitErrorf("commit bundle must include the daycare host name")
		return
	}
	if req.CommitBundle.UserID < 1 {
		logAndTransmitErrorf("commit bundle must include the user's ID")
		return
	}

	// gather any args
	r.ParseForm()
	args := []string{}
	for key, vals := range r.Form {
		if len(vals) == 1 {
			args = append(args, key+"="+vals[0])
		}
	}
	if len(args) > 0 {
		log.Printf("args: %v", args)
	}

	// check signatures
	problem, steps := req.CommitBundle.Problem, req.CommitBundle.ProblemSteps
	problemSig := problem.ComputeSignature(Config.DaycareSecret, steps)
	if req.CommitBundle.ProblemSignature != problemSig {
		logAndTransmitErrorf("problem signature mismatch: found %s but expected %s", req.CommitBundle.ProblemSignature, problemSig)
		return
	}
	commit := req.CommitBundle.Commit
	commitSig := commit.ComputeSignature(Config.DaycareSecret, problemSig, req.CommitBundle.Hostname, req.CommitBundle.UserID)
	if req.CommitBundle.CommitSignature != commitSig {
		logAndTransmitErrorf("commit signature mismatch: found %s but expected %s", req.CommitBundle.CommitSignature, commitSig)
		return
	}
	req.CommitBundle.CommitSignature = ""

	// host must match
	if req.CommitBundle.Hostname != Config.Hostname {
		logAndTransmitErrorf("commit is signed for host %s, this is %s", req.CommitBundle.Hostname, Config.Hostname)
		return
	}

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
	nannyName := fmt.Sprintf("nanny-%d", req.CommitBundle.UserID)
	log.Printf("launching container for %s", nannyName)
	n, err := NewNanny(problemType, problem, action.Interactive, args, nannyName)
	if err != nil {
		logAndTransmitErrorf("error creating container: %v", err)
		return
	}
	rw := newReadWriteBuffer()

	// watch for timeouts
	alive := make(chan bool)
	go func() {
		duration := time.Duration(problemType.MaxTimeout) * time.Second
		t := time.NewTimer(duration)

		for alive != nil {
			select {
			case keepGoing := <-alive:
				if !t.Stop() {
					<-t.C
				}
				if keepGoing {
					t.Reset(duration)
				} else {
					alive = nil
				}
			case <-t.C:
				if err := n.Shutdown("timeout"); err != nil {
					log.Printf("error shutting down container: %v", err)
				}
			}
		}
	}()

	// relay stdin events from socket to the container through rw
	go func() {
		broken := false
		for {
			msg := new(DaycareRequest)
			if err := socket.ReadJSON(msg); err != nil {
				if strings.Contains(err.Error(), "use of closed network connection") || strings.Contains(err.Error(), "close 1005") {
					// websocket closed
				} else {
					log.Printf("websocket read error: %v", err)
				}
				broken = true
				break
			}
			if msg.CommitBundle != nil {
				logAndTransmitErrorf("unexpected commit bundle received from client; quitting")
				broken = true
				break
			}
			if len(msg.Stdin) > 0 {
				if _, err := rw.Write([]byte(msg.Stdin)); err != nil {
					break
				}
				alive <- true
			}
			if msg.CloseStdin {
				rw.MarkEOF()
			}
		}
		rw.Close()
		alive <- false

		// if the connection closed on the client side, kill the container
		if broken {
			if err := n.Shutdown("broken websocket"); err != nil {
				log.Printf("error shutting down container: %v", err)
			}
		}
		log.Printf("stdin listener closed")
	}()

	// relay container events to the socket
	eventListenerClosed := make(chan struct{})
	go func() {
		for event := range n.Events {
			// record the event
			commit.Transcript = append(commit.Transcript, event)

			switch event.Event {
			case "exec", "exit", "stdin", "stdout", "stderr", "stdinclosed", "error":
				if event.Event == "exec" {
					log.Printf("%s", event)
				}
				res := &DaycareResponse{Event: event}
				if err := socket.WriteJSON(res); err != nil {
					if strings.Contains(err.Error(), "use of closed network connection") {
						// websocket closed
					} else {
						logAndTransmitErrorf("websocket write error: %v", err)
					}

					break
				}

			default:
				// ignore other event types
			}
			if event.Event == "shutdown" {
				break
			}
		}
		rw.Close()
		eventListenerClosed <- struct{}{}
	}()

	// copy the files to the container
	if err = n.PutFiles(files); err != nil {
		n.ReportCard.LogAndFailf("PutFiles error: %v", err)
		return
	}

	// run the problem-type specific handler
	handler, ok := action.Handler.(nannyHandler)
	if ok {
		handler(n, args, problem.Options, files, rw)
	} else {
		logAndTransmitErrorf("handler for action %s is of wrong type", commit.Action)
	}
	commit.ReportCard = n.ReportCard

	// shutdown the nanny
	if err := n.Shutdown("action finished"); err != nil {
		logAndTransmitErrorf("nanny shutdown error: %v", err)
	}

	// wait for listener to finish
	close(n.Events)
	<-eventListenerClosed

	if commit.Action == "grade" {
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
		req.CommitBundle.CommitSignature = commit.ComputeSignature(Config.DaycareSecret, req.CommitBundle.ProblemSignature, req.CommitBundle.Hostname, req.CommitBundle.UserID)

		res := &DaycareResponse{CommitBundle: req.CommitBundle}
		if err := socket.WriteJSON(res); err != nil {
			logAndTransmitErrorf("error writing final commit JSON: %v", err)
			return
		}
	}
	log.Printf("handler for %s finished", nannyName)
}

type Nanny struct {
	Name       string
	Start      time.Time
	Container  *docker.Container
	UID        int64
	ReportCard *ReportCard
	Input      chan string
	Events     chan *EventMessage
	Transcript []*EventMessage
	Closed     bool
}

type nannyHandler func(nanny *Nanny, args, options []string, files map[string]string, stdin io.Reader)

var getContainerIDRE = regexp.MustCompile(`The name .* is already in use by container (.*)\. You have to delete \(or rename\) that container to be able to reuse that name`)

func getContainerID(msg string) string {
	groups := getContainerIDRE.FindStringSubmatch(msg)
	if len(groups) != 2 {
		return ""
	}
	return groups[1]
}

func NewNanny(problemType *ProblemType, problem *Problem, interactive bool, args []string, name string) (*Nanny, error) {
	// create a container
	mem := problemType.MaxMemory * 1024 * 1024
	disk := problemType.MaxFileSize * 1024 * 1024
	uid, err := allocUID()
	if err != nil {
		return nil, err
	}

	timeLimit := problemType.MaxCPU * 2
	if interactive {
		timeLimit = problemType.MaxSession
	}
	config := &docker.Config{
		Hostname:        name,
		User:            uidgid(uid),
		Memory:          int64(mem),
		MemorySwap:      -1,
		Cmd:             []string{"/bin/sleep", strconv.FormatInt(timeLimit, 10) + "s"},
		Env:             []string{"USER=student", "HOME=/home/student"},
		Image:           problemType.Image,
		NetworkDisabled: true,
	}
	for _, s := range args {
		if strings.HasPrefix(s, "COLUMNS=") {
			config.Env = append(config.Env, s)
		}
		if strings.HasPrefix(s, "LINES=") {
			config.Env = append(config.Env, s)
		}
		if strings.HasPrefix(s, "TERM=") {
			config.Env = append(config.Env, s)
		}
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
		PidsLimit: problemType.MaxThreads,
		Ulimits: []docker.ULimit{
			{Name: "core", Soft: 0, Hard: 0},
			{Name: "cpu", Soft: problemType.MaxCPU, Hard: problemType.MaxCPU},
			{Name: "data", Soft: mem, Hard: mem},
			{Name: "fsize", Soft: disk, Hard: disk},
			{Name: "memlock", Soft: 0, Hard: 0},
			{Name: "nofile", Soft: problemType.MaxFD, Hard: problemType.MaxFD},
			{Name: "nproc", Soft: problemType.MaxThreads, Hard: problemType.MaxThreads},
			{Name: "stack", Soft: mem, Hard: mem},
		},
	}

	container, err := dockerClient.CreateContainer(docker.CreateContainerOptions{Name: name, Config: config, HostConfig: hostConfig})
	if err != nil {
		if err == docker.ErrContainerAlreadyExists {
			// container already exists with that name--try killing it
			log.Printf("killing existing container with same name %s", name)
			err2 := dockerClient.RemoveContainer(docker.RemoveContainerOptions{
				ID:    name,
				Force: true,
			})
			if err2 != nil {
				log.Printf("error killing existing container with same name: %v", err2)
				releaseUID(uid)
				return nil, err2
			}

			// try it one more time
			container, err = dockerClient.CreateContainer(docker.CreateContainerOptions{Name: name, Config: config, HostConfig: hostConfig})
		}
		if err != nil {
			log.Printf("CreateContainer: %v", err)
			releaseUID(uid)
			return nil, err
		}
	}

	// start it
	err = dockerClient.StartContainer(container.ID, nil)
	if err != nil {
		log.Printf("StartContainer: %v", err)
		releaseUID(uid)
		err2 := dockerClient.RemoveContainer(docker.RemoveContainerOptions{
			ID:    container.ID,
			Force: true,
		})
		if err2 != nil {
			log.Printf("RemoveContainer: %v", err2)
		}
		return nil, err
	}

	return &Nanny{
		Name:       name,
		Start:      time.Now(),
		Container:  container,
		UID:        uid,
		ReportCard: NewReportCard(),
		Input:      make(chan string),
		Events:     make(chan *EventMessage),
		Transcript: []*EventMessage{},
	}, nil
}

func (n *Nanny) Shutdown(msg string) error {
	if n.Closed {
		return nil
	}
	n.Closed = true

	// shut down the container
	log.Printf("shutting down %s: %s", n.Name, msg)
	err := dockerClient.RemoveContainer(docker.RemoveContainerOptions{
		ID:    n.Container.ID,
		Force: true,
	})
	releaseUID(n.UID)
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
			Uid:        int(n.UID),
			Gid:        int(n.UID),
			Size:       int64(len(contents)),
			ModTime:    now,
			Typeflag:   tar.TypeReg,
			Uname:      strconv.FormatInt(n.UID, 10),
			Gname:      strconv.FormatInt(n.UID, 10),
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
		User:         uidgid(n.UID),
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
		User:         uidgid(n.UID),
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

func (n *Nanny) Exec(cmd []string, stdin io.Reader, useTTY bool) (stdout, stderr, script *bytes.Buffer, status int, err error) {
	// log the event
	n.Events <- &EventMessage{
		Time:        time.Now(),
		Event:       "exec",
		ExecCommand: cmd,
	}

	// create
	exec, err := dockerClient.CreateExec(docker.CreateExecOptions{
		AttachStdin:  stdin != nil,
		AttachStdout: true,
		AttachStderr: true,
		Tty:          useTTY,
		Cmd:          cmd,
		Container:    n.Container.ID,
		User:         uidgid(n.UID),
	})
	if err != nil {
		return nil, nil, nil, -1, err
	}

	// gather output
	var out execOutput
	out.events = n.Events

	// start
	err = dockerClient.StartExec(exec.ID, docker.StartExecOptions{
		Detach:       false,
		Tty:          useTTY,
		InputStream:  stdin,
		OutputStream: (*execStdout)(&out),
		ErrorStream:  (*execStderr)(&out),
		RawTerminal:  useTTY,
	})
	if err != nil {
		return nil, nil, nil, -1, err
	}

	// inspect
	inspect, err := dockerClient.InspectExec(exec.ID)
	if err != nil {
		return nil, nil, nil, -1, err
	}
	if inspect.Running {
		return nil, nil, nil, -1, fmt.Errorf("process still running")
	}

	n.Events <- &EventMessage{
		Time:       time.Now(),
		Event:      "exit",
		ExitStatus: inspect.ExitCode,
	}

	return &out.stdout, &out.stderr, &out.script, inspect.ExitCode, nil
}

func (n *Nanny) ExecSimple(cmd []string, stdin io.Reader, useTTY bool) error {
	_, _, _, status, err := n.Exec(cmd, stdin, useTTY)
	if err != nil {
		n.ReportCard.LogAndFailf("%s exec error: %v", cmd[0], err)
		return err
	}
	if status != 0 {
		err := fmt.Errorf("%s failed with exit status %d", cmd[0], status)
		n.ReportCard.LogAndFailf("%v", err)
		return err
	}
	return nil
}

var uidsInUse map[int64]bool = make(map[int64]bool)
var uidsMutex sync.Mutex

func allocUID() (int64, error) {
	uidsMutex.Lock()
	defer uidsMutex.Unlock()
	if len(uidsInUse) > 1000 {
		err := fmt.Errorf("more than 1000 UIDs in use, cannot create more nanny containers")
		log.Printf("%v", err)
		return 0, err
	}
	for {
		uid := rand.Int63n(1000) + 10000
		if !uidsInUse[uid] {
			uidsInUse[uid] = true
			return uid, nil
		}
	}
}

func releaseUID(uid int64) {
	uidsMutex.Lock()
	defer uidsMutex.Unlock()
	delete(uidsInUse, uid)
}

func uidgid(uid int64) string {
	return fmt.Sprintf("%d:%d", uid, uid)
}

type readWritebuffer struct {
	lock     sync.Mutex
	notEmpty sync.Cond
	notFull  sync.Cond
	buf      bytes.Buffer
	eof      bool
	closed   bool
}

const maxReadWriteBufferLen int = 1e6

func newReadWriteBuffer() *readWritebuffer {
	rw := new(readWritebuffer)
	rw.notEmpty.L = &rw.lock
	rw.notFull.L = &rw.lock
	return rw
}

func (rw *readWritebuffer) Read(p []byte) (n int, err error) {
	rw.lock.Lock()
	defer rw.lock.Unlock()
	if rw.closed {
		return 0, io.EOF
	}
	for rw.buf.Len() == 0 {
		if rw.eof {
			return 0, io.EOF
		}
		rw.notEmpty.Wait()
		if rw.closed {
			return 0, io.EOF
		}
	}
	rw.notFull.Broadcast()
	return rw.buf.Read(p)
}

func (rw *readWritebuffer) Write(p []byte) (n int, err error) {
	rw.lock.Lock()
	defer rw.lock.Unlock()
	if rw.closed || rw.eof {
		return 0, io.EOF
	}
	for rw.buf.Len()+len(p) > maxReadWriteBufferLen {
		rw.notFull.Wait()
		if rw.closed || rw.eof {
			return 0, io.EOF
		}
	}
	rw.notEmpty.Broadcast()
	return rw.buf.Write(p)
}

func (rw *readWritebuffer) MarkEOF() {
	rw.lock.Lock()
	defer rw.lock.Unlock()
	rw.eof = true
	rw.notEmpty.Broadcast()
	rw.notFull.Broadcast()
}

func (rw *readWritebuffer) Close() {
	rw.lock.Lock()
	defer rw.lock.Unlock()
	rw.eof = true
	rw.closed = true
	rw.buf.Reset()
	rw.notEmpty.Broadcast()
	rw.notFull.Broadcast()
}
