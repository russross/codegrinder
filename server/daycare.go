package main

import (
	"archive/tar"
	"bytes"
	"fmt"
	"io"
	"log"
	"net/http"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-martini/martini"
	"github.com/gorilla/websocket"
	. "github.com/russross/codegrinder/types"
)

// containerEngine defines the command-line executable to use for container management.
const containerEngine = "docker"

// studentUID defines the static user and group ID to be used inside containers.
const studentUID = 1001

type limits struct {
	maxCPU      int64
	maxSession  int64
	maxTimeout  int64
	maxFD       int64
	maxFileSize int64
	maxMemory   int64
	maxThreads  int64
}

func newLimits(t *ProblemTypeAction) *limits {
	return &limits{
		maxCPU:      t.MaxCPU,
		maxSession:  t.MaxSession,
		maxTimeout:  t.MaxTimeout,
		maxFD:       t.MaxFD,
		maxFileSize: t.MaxFileSize,
		maxMemory:   t.MaxMemory,
		maxThreads:  t.MaxThreads,
	}
}

func (l *limits) override(options []string) {
	for _, elt := range options {
		parts := strings.Split(elt, "=")
		if len(parts) != 2 {
			continue
		}
		val, err := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 63)
		if err != nil {
			continue
		}
		switch strings.TrimSpace(parts[0]) {
		case "maxCPU":
			l.maxCPU = val
		case "maxSession":
			l.maxSession = val
		case "maxTimeout":
			l.maxTimeout = val
		case "maxFD":
			l.maxFD = val
		case "maxFileSize":
			l.maxFileSize = val
		case "maxMemory":
			l.maxMemory = val
		case "maxThreads":
			l.maxThreads = val
		}
	}
}

var containerLimiter chan struct{}

// SocketProblemTypeAction handles a request to /sockets/:problem_type/:action
// It expects a websocket connection, which will receive a series of DaycareRequest objects
// and will respond with DaycareResponse objects, though not in a one-to-one fashion.
// The first DaycareRequest must have the CommitBundle field present. Future requests
// should only have Stdin present.
func SocketProblemTypeAction(w http.ResponseWriter, r *http.Request, params martini.Params) {
	now := time.Now()

	// CORS header for browser-based requests if the TA is a different host than the daycare
	w.Header().Set("Access-Control-Allow-Origin", "https://"+Config.TAHostname)

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
	if req.CommitBundle.ProblemType == nil {
		logAndTransmitErrorf("commit bundle must include the problem type")
		return
	}
	if len(req.CommitBundle.ProblemTypeSignature) == 0 {
		logAndTransmitErrorf("commit bundle must include the problem type signature")
		return
	}
	if req.CommitBundle.ProblemType.Name != params["problem_type"] {
		logAndTransmitErrorf("problem type in request URL must match problem type in bundle")
		return
	}
	if params["action"] == "" {
		logAndTransmitErrorf("action must be included in request URL")
		return
	}
	if req.CommitBundle.ProblemType.Actions == nil || req.CommitBundle.ProblemType.Actions[params["action"]] == nil {
		logAndTransmitErrorf("action %q not defined for problem type %s", params["action"], params["problem_type"])
		return
	}
	action := req.CommitBundle.ProblemType.Actions[params["action"]]
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
	problemType := req.CommitBundle.ProblemType
	typeSig := problemType.ComputeSignature(Config.DaycareSecret)
	if req.CommitBundle.ProblemTypeSignature != typeSig {
		logAndTransmitErrorf("problem type signature mismatch: found %s but expected %s", req.CommitBundle.ProblemTypeSignature, typeSig)
		return
	}
	problem, steps := req.CommitBundle.Problem, req.CommitBundle.ProblemSteps
	problemSig := problem.ComputeSignature(Config.DaycareSecret, steps)
	if req.CommitBundle.ProblemSignature != problemSig {
		logAndTransmitErrorf("problem signature mismatch: found %s but expected %s", req.CommitBundle.ProblemSignature, problemSig)
		return
	}
	commit := req.CommitBundle.Commit
	commitSig := commit.ComputeSignature(Config.DaycareSecret, typeSig, problemSig, req.CommitBundle.Hostname, req.CommitBundle.UserID)
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
	if step == nil {
		logAndTransmitErrorf("required step %d is nil", commit.Step)
		return
	}
	if step.Step != commit.Step {
		logAndTransmitErrorf("step number %d in the problem thinks it is step number %d", commit.Step, step.Step)
		return
	}
	if step.ProblemType != problemType.Name {
		logAndTransmitErrorf("step number %d in the problem has problem type %q but the commit bundle included problem type %q", step.ProblemType, problemType)
		return
	}

	// collect the files from the problem step, commit, and problem type
	files := make(map[string][]byte)
	for name, contents := range step.Files {
		files[name] = contents
	}
	for name, contents := range commit.Files {
		files[name] = contents
	}
	for name, contents := range req.CommitBundle.ProblemType.Files {
		files[name] = contents
	}

	// limit the number of concurrent containers
	containerLimiter <- struct{}{}
	defer func() {
		<-containerLimiter
	}()

	// launch a nanny process
	nannyName := fmt.Sprintf("nanny-%d", req.CommitBundle.UserID)
	limits := newLimits(action)
	limits.override(problem.Options)
	n, err := NewNanny(req.CommitBundle.ProblemType, problem, action.Action, args, limits, nannyName)
	if err != nil {
		logAndTransmitErrorf("error creating container: %v", err)
		return
	}

	// shutdown the container when finished
	defer func() {
		if err := n.Shutdown("action finished"); err != nil {
			logAndTransmitErrorf("nanny shutdown error: %v", err)
		}
	}()

	// relay container events to the socket
	eventListenerClosed := make(chan struct{})
	go func() {
		count, overflow, discarded := 0, 0, 0
		for event := range n.Events {
			if count > TranscriptDataLimit {
				overflow += len(event.StreamData)
			} else {
				count += len(event.StreamData)

				// record the event
				if len(commit.Transcript) > 0 && commit.Transcript[len(commit.Transcript)-1].Event == event.Event &&
					(event.Event == "stdin" || event.Event == "stdout" || event.Event == "stderr") {
					// merge this with the previous event
					prev := commit.Transcript[len(commit.Transcript)-1]

					data := make([]byte, 0, len(prev.StreamData)+len(event.StreamData))
					data = append(data, prev.StreamData...)
					data = append(data, event.StreamData...)
					prev.StreamData = data
					prev.Time = event.Time
				} else if len(commit.Transcript) < TranscriptEventCountLimit {
					commit.Transcript = append(commit.Transcript, event)
				} else {
					discarded++
				}
			}

			// transmit the message to the client
			switch event.Event {
			case "exec", "exit", "stdin", "stdout", "stderr", "stdinclosed", "error", "files":
				if event.Event == "files" {
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
		}

		// report any truncation
		if overflow > 0 || discarded > 0 {
			log.Printf("transcript truncated by %d events and %d bytes of stream data", discarded, overflow)
		}

		eventListenerClosed <- struct{}{}
	}()

	// copy the files to the container
	if err = n.PutFiles(files, 0666); err != nil {
		n.ReportCard.LogAndFailf("uploading files: %v", err)
		return
	}

	// run the action
	cmd := strings.Fields(action.Command)
	switch {
	case action.Parser == "xunit":
		runAndParseXUnit(n, cmd)

	case action.Parser == "check":
		runAndParseCheckXML(n, cmd)

	case action.Parser != "":
		n.ReportCard.LogAndFailf("unknown parser %q for problem type %s action %s",
			action.Parser, action.ProblemType, action.Action)
		return

	default:
		_, _, _, status, err := n.Exec(cmd)
		if err != nil {
			n.ReportCard.LogAndFailf("%q exec error: %v", strings.Join(cmd, " "), err)
		}
		if status != 0 {
			err := fmt.Errorf("%q failed with exit status %d", strings.Join(cmd, " "), status)
			n.ReportCard.LogAndFailf("%v", err)
		}
	}

	commit.ReportCard = n.ReportCard

	// download any files?
	for _, option := range problem.Options {
		parts := strings.SplitN(option, "=", 2)
		if len(parts) != 2 || parts[0] != "download" {
			continue
		}
		files, err := n.GetFiles(strings.Split(parts[1], ","))
		if err != nil {
			log.Printf("error trying to download files from container: %v", err)
		} else if len(files) > 0 {
			n.Events <- &EventMessage{Event: "files", Files: files}
		}
	}

	// wait for listener to finish
	close(n.Events)
	<-eventListenerClosed

	// send the final commit back to the client
	if commit.Action == "grade" {
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
		req.CommitBundle.CommitSignature = commit.ComputeSignature(Config.DaycareSecret, req.CommitBundle.ProblemTypeSignature, req.CommitBundle.ProblemSignature, req.CommitBundle.Hostname, req.CommitBundle.UserID)

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
	ID         string
	ReportCard *ReportCard
	Input      chan string
	Events     chan *EventMessage
	Transcript []*EventMessage
	Closed     bool
	Files      map[string][]byte
}

func NewNanny(problemType *ProblemType, problem *Problem, action string, args []string, limits *limits, name string) (*Nanny, error) {
	disk := limits.maxFileSize * 1024 * 1024
	timeLimit := limits.maxCPU * 2
	userAndGroup := fmt.Sprintf("%d:%d", studentUID, studentUID)
	memStr := fmt.Sprintf("%dm", limits.maxMemory)

	// construct the 'docker run' command arguments
	cmdArgs := []string{
		"run",
		"-d", // detached mode.
		"--name", name,
		"--hostname", name,
		"--user", userAndGroup,
		"--net=none",

		// cgroup-based resource limits.
		"--memory", memStr,
		"--memory-swap", memStr, // prevent swapping
		"--pids-limit", strconv.FormatInt(limits.maxThreads, 10),

		// security hardening flags.
		"--cap-drop", "ALL",
		"--security-opt", "no-new-privileges", // prevent privilege escalation
		//"--security-opt", "seccomp=default",   // apply default syscall filter

		// ulimits for resources not covered by cgroups.
		// note: --pids-limit makes nproc redundant
		// note: nofile is less critical with modern kernels
		"--ulimit", fmt.Sprintf("core=0:0"),
		"--ulimit", fmt.Sprintf("cpu=%d", limits.maxCPU),
		"--ulimit", fmt.Sprintf("fsize=%d", disk),
	}

	// main command just sleeps; this acts as a timeout mechanism for the whole container
	cmdArgs = append(cmdArgs, problemType.Image, "/bin/sleep", strconv.FormatInt(timeLimit, 10)+"s")

	log.Printf("new container %s; action %s on %s (%s); params cpu=%d, fd=%d, file=%d, mem=%d, threads=%d",
		name, action, problem.Unique, problemType.Name,
		limits.maxCPU, limits.maxFD, limits.maxFileSize, limits.maxMemory, limits.maxThreads)

	// execute the command.
	cmd := exec.Command(containerEngine, cmdArgs...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		// if the container already exists, try to remove it and retry
		// this prevents a single student running multiple graders concurrently
		if strings.Contains(string(output), "is already in use") {
			log.Printf("killing existing container with same name %s", name)
			if err2 := removeContainer(name); err2 != nil {
				return nil, err2
			}

			// retry the command
			output, err = exec.Command(containerEngine, cmdArgs...).CombinedOutput()
		}
		if err != nil {
			return nil, fmt.Errorf("container run failed: %v\nOutput: %s", err, string(output))
		}
	}

	containerID := strings.TrimSpace(string(output))

	return &Nanny{
		Name:       name,
		Start:      time.Now(),
		ID:         containerID,
		ReportCard: NewReportCard(),
		Input:      make(chan string),
		Events:     make(chan *EventMessage),
	}, nil
}

func (n *Nanny) Shutdown(msg string) error {
	if n.Closed {
		return nil
	}
	n.Closed = true

	// shut down the container
	if err := removeContainer(n.ID); err != nil {
		return fmt.Errorf("Nanny.Shutdown: %v", err)
	}
	return nil
}

// removeContainer forcefully stops and removes a container by its ID or name.
func removeContainer(id string) error {
	cmd := exec.Command(containerEngine, "rm", "-f", id)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("error killing container %s: %v", id, err)
	}
	return nil
}

// copy a set of files to the given container
// by streaming a tarball to the 'docker cp' command
// note: the container must be running
func (n *Nanny) PutFiles(files map[string][]byte, mode int64) error {
	if len(files) == 0 {
		return nil
	}

	// create a tar archive in memory
	nowish := time.Now().Add(-time.Second)
	buf := new(bytes.Buffer)
	writer := tar.NewWriter(buf)
	dirs := make(map[string]bool)
	for name, contents := range files {
		dir := filepath.Dir(name)
		if dir != "" && dir != "." && !dirs[dir] {
			dirs[dir] = true
			header := &tar.Header{
				Name:       dir,
				Mode:       0777,
				Uid:        studentUID,
				Gid:        studentUID,
				ModTime:    nowish,
				Typeflag:   tar.TypeDir,
				Uname:      strconv.Itoa(studentUID),
				Gname:      strconv.Itoa(studentUID),
				AccessTime: nowish,
				ChangeTime: nowish,
			}
			if err := writer.WriteHeader(header); err != nil {
				return fmt.Errorf("writing tar header for directory: %v", err)
			}
		}
		header := &tar.Header{
			Name:       name,
			Mode:       mode,
			Uid:        studentUID,
			Gid:        studentUID,
			Size:       int64(len(contents)),
			ModTime:    nowish,
			Typeflag:   tar.TypeReg,
			Uname:      strconv.Itoa(studentUID),
			Gname:      strconv.Itoa(studentUID),
			AccessTime: nowish,
			ChangeTime: nowish,
		}
		if err := writer.WriteHeader(header); err != nil {
			return fmt.Errorf("writing tar header: %v", err)
		}
		if _, err := writer.Write(contents); err != nil {
			return fmt.Errorf("writing to tar file: %v", err)
		}
	}
	if err := writer.Close(); err != nil {
		return fmt.Errorf("closing tar file: %v", err)
	}

	// use 'docker cp' to copy the tarball into the /home/student directory.
	// pipe the tar buffer to the command's stdin.
	cmd := exec.Command(containerEngine, "cp", "-", n.ID+":/home/student/")
	cmd.Stdin = buf

	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("container cp failed: %v\nOutput: %s", err, string(output))
	}
	return nil
}

// GetFiles copies files from the given container.
// All student files are copied from the container on the first call to GetFiles.
// Subsequent calls will gather files from the cached collection.
func (n *Nanny) GetFiles(filenames []string) (map[string][]byte, error) {
	if len(filenames) == 0 {
		return nil, nil
	}

	// do we need to fetch the files?
	if n.Files == nil {
		// cannot fetch files if the container is closed
		if n.Closed {
			return nil, fmt.Errorf("cannot fetch files, container is closed")
		}

		// use 'docker cp' to get the /home/student directory as a tar stream
		cmd := exec.Command(containerEngine, "cp", n.ID+":/home/student/.", "-")
		var tarFile bytes.Buffer
		cmd.Stdout = &tarFile

		// capture stderr in case of error
		var stderr bytes.Buffer
		cmd.Stderr = &stderr

		if err := cmd.Run(); err != nil {
			return nil, fmt.Errorf("container cp from container failed: %v\nOutput: %s", err, tarFile.String())
		}

		// extract the files
		n.Files = make(map[string][]byte)
		reader := tar.NewReader(&tarFile)
		for {
			header, err := reader.Next()
			if err == io.EOF {
				break
			}
			if err != nil {
				return nil, fmt.Errorf("error decoding tar file: %v", err)
			}
			if header.Typeflag != tar.TypeReg {
				continue
			}
			contents, err := io.ReadAll(reader)
			if err != nil {
				return nil, fmt.Errorf("error reading %q from tar file: %v", header.Name, err)
			}
			name := filepath.Clean(header.Name)
			n.Files[name] = contents
		}
	}

	// pick out the requested files
	files := make(map[string][]byte)
	badpattern := ""
	for name, contents := range n.Files {
		for _, pattern := range filenames {
			matched, err := filepath.Match(pattern, name)
			if err != nil {
				badpattern = pattern
			} else if matched {
				files[name] = contents
				break
			}
		}
	}
	if badpattern != "" {
		log.Printf("GetFiles: bad pattern found: %q", badpattern)
	}

	return files, nil
}

// eventWriter is a helper type that implements io.Writer. It forwards writes
// to an event channel for real-time streaming to the client.
type eventWriter struct {
	event  string
	events chan *EventMessage
}

func (ew *eventWriter) Write(p []byte) (int, error) {
	clone := make([]byte, len(p))
	copy(clone, p)
	ew.events <- &EventMessage{
		Time:       time.Now(),
		Event:      ew.event,
		StreamData: clone,
	}
	return len(p), nil
}

// Exec runs a command inside the container and captures its output
func (n *Nanny) Exec(cmd []string) (stdout, stderr, script *bytes.Buffer, status int, err error) {
	n.Events <- &EventMessage{
		Time:        time.Now(),
		Event:       "exec",
		ExecCommand: cmd,
	}

	// construct the 'docker exec' command arguments.
	execCmdArgs := []string{"exec", "--user", strconv.Itoa(studentUID), n.ID}
	execCmdArgs = append(execCmdArgs, cmd...)
	command := exec.Command(containerEngine, execCmdArgs...)

	// buffers to capture the full output for return.
	var stdoutBuf, stderrBuf, scriptBuf bytes.Buffer

	// create writers that send events over the channel AND write to local buffers.
	stdoutWriter := io.MultiWriter(&stdoutBuf, &scriptBuf, &eventWriter{event: "stdout", events: n.Events})
	stderrWriter := io.MultiWriter(&stderrBuf, &scriptBuf, &eventWriter{event: "stderr", events: n.Events})

	command.Stdout = stdoutWriter
	command.Stderr = stderrWriter

	// start the command
	err = command.Run()

	exitCode := 0
	if err != nil {
		// try to extract the exit code from the error
		if exitError, ok := err.(*exec.ExitError); ok {
			exitCode = exitError.ExitCode()
		} else {
			// a different error occurred (e.g., command not found).
			return &stdoutBuf, &stderrBuf, &scriptBuf, -1, fmt.Errorf("exec command failed: %v", err)
		}
	}

	n.Events <- &EventMessage{
		Time:       time.Now(),
		Event:      "exit",
		ExitStatus: exitCode,
	}

	return &stdoutBuf, &stderrBuf, &scriptBuf, exitCode, nil
}
