package main

import (
	"archive/tar"
	"bytes"
	"context"
	"errors"
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
// The first DaycareRequest must have the CommitBundle field present.
func SocketProblemTypeAction(w http.ResponseWriter, r *http.Request, params martini.Params) {
	// CORS header for browser-based requests
	w.Header().Set("Access-Control-Allow-Origin", "https://"+Config.TAHostname)

	socket, err := websocket.Upgrade(w, r, nil, 1024, 1024)
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "websocket error: %v", err)
		return
	}
	defer func() {
		socket.WriteControl(websocket.CloseMessage, nil, time.Now().Add(5*time.Second))
		socket.Close()
	}()

	// This helper is used to transmit errors that occur before the main event loop starts.
	logAndTransmitErrorf := func(format string, args ...interface{}) {
		msg := fmt.Sprintf(format, args...)
		log.Print(msg)
		res := &DaycareResponse{Error: msg}
		if err := socket.WriteJSON(res); err != nil {
			log.Printf("error writing error to websocket: %v", err)
		}
	}

	req := new(DaycareRequest)
	if err := socket.ReadJSON(req); err != nil {
		logAndTransmitErrorf("error reading first request message: %v", err)
		return
	}

	if req.CommitBundle == nil {
		logAndTransmitErrorf("first request message must include the commit bundle")
		return
	}

	// Gather any args from the URL query.
	r.ParseForm()
	args := []string{}
	for key, vals := range r.Form {
		if len(vals) == 1 {
			args = append(args, key+"="+vals[0])
		}
	}

	// Create a channel for HandleProblemAction to send responses.
	eventChan := make(chan *DaycareResponse, 100)

	// Create a request-scoped context that can be canceled on websocket failure.
	actionCtx, cancelAction := context.WithCancel(context.Background())
	defer cancelAction()

	// Launch the core logic in a goroutine.
	go HandleProblemAction(actionCtx, req.CommitBundle, params["problem_type"], params["action"], args, eventChan)

	// Bridge the event channel to the websocket.
	broken := false
	for res := range eventChan {
		if broken {
			// Continue to drain the channel after a websocket failure
			continue
		}
		if err := socket.WriteJSON(res); err != nil {
			broken = true
			cancelAction()
			if !strings.Contains(err.Error(), "use of closed network connection") {
				log.Printf("websocket write error: %v", err)
			}
			continue
		}
	}
}

// HandleProblemAction contains the core logic for running a problem action,
// completely decoupled from the websocket/HTTP transport layer.
func HandleProblemAction(parentCtx context.Context, bundle *CommitBundle, problemTypeParam, actionParam string, args []string, eventChan chan<- *DaycareResponse) {
	defer close(eventChan)
	now := time.Now()

	// Helper to send an error message over the event channel.
	sendError := func(err error) {
		log.Print(err)
		eventChan <- &DaycareResponse{Error: err.Error()}
	}

	action, err := validateAndExtractAction(bundle, problemTypeParam, actionParam)
	if err != nil {
		sendError(fmt.Errorf("validation error: %w", err))
		return
	}

	// The signature is now validated, so we can clear it to prevent potential re-use.
	bundle.CommitSignature = ""

	_, files, err := gatherFilesAndStep(bundle)
	if err != nil {
		sendError(fmt.Errorf("error gathering files: %w", err))
		return
	}

	// Limit the number of concurrent containers.
	containerLimiter <- struct{}{}
	log.Printf("container locked for user %d", bundle.UserID)
	defer func() {
		<-containerLimiter
		log.Printf("container unlocked for user %d", bundle.UserID)
	}()

	nannyName := fmt.Sprintf("nanny-%d", bundle.UserID)
	limits := newLimits(action)
	limits.override(bundle.Problem.Options)
	timeout := time.Duration(limits.maxCPU*2+5) * time.Second
	ctx, cancel := context.WithTimeout(parentCtx, timeout)
	defer cancel()

	n, err := NewNanny(ctx, bundle.ProblemType, bundle.Problem, action.Action, args, limits, nannyName)
	if err != nil {
		sendError(fmt.Errorf("error creating container: %w", err))
		return
	}
	defer func() {
		if err := n.Shutdown("action finished"); err != nil {
			log.Printf("nanny shutdown error: %v", err)
		}
	}()

	// Launch the event streamer.
	eventListenerDone := make(chan struct{})
	go streamNannyEvents(n, bundle.Commit, eventChan, eventListenerDone)

	if err = n.PutFiles(files, 0666); err != nil {
		n.ReportCard.LogAndFailf("uploading files: %v", err)
		close(n.Events) // Ensure the event streamer terminates.
		<-eventListenerDone
		return
	}

	// Run the action command.
	cmd := strings.Fields(action.Command)
	switch {
	case action.Parser == "xunit":
		runAndParseXUnit(n, cmd)
	case action.Parser == "check":
		runAndParseCheckXML(n, cmd)
	case action.Parser != "":
		n.ReportCard.LogAndFailf("unknown parser %q for problem type %s action %s",
			action.Parser, action.ProblemType, action.Action)
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

	bundle.Commit.ReportCard = n.ReportCard

	// Handle file downloads.
	for _, option := range bundle.Problem.Options {
		parts := strings.SplitN(option, "=", 2)
		if len(parts) != 2 || parts[0] != "download" {
			continue
		}
		dlFiles, err := n.GetFiles(strings.Split(parts[1], ","))
		if err != nil {
			log.Printf("error trying to download files from container: %v", err)
		} else if len(dlFiles) > 0 {
			n.Events <- &EventMessage{Event: "files", Files: dlFiles}
		}
	}

	// Wait for the event streamer to finish.
	close(n.Events)
	<-eventListenerDone

	// Send the final commit back to the client if grading.
	if bundle.Commit.Action == "grade" {
		commit := bundle.Commit
		// Compute score.
		if commit.ReportCard.Passed {
			commit.Score = 1.0
		} else if len(commit.ReportCard.Results) == 0 {
			commit.Score = 0.0
		} else {
			passed := 0
			for _, elt := range commit.ReportCard.Results {
				if elt.Outcome == "passed" {
					passed++
				}
			}
			commit.Score = float64(passed) / float64(len(commit.ReportCard.Results))
		}
		commit.UpdatedAt = now
		bundle.CommitSignature = commit.ComputeSignature(Config.DaycareSecret, bundle.ProblemTypeSignature, bundle.ProblemSignature, bundle.Hostname, bundle.UserID)

		eventChan <- &DaycareResponse{CommitBundle: bundle}
	}
	log.Printf("handler for %s finished", nannyName)
}

// validateAndExtractAction performs sanity checks and signature validation on the commit bundle.
func validateAndExtractAction(bundle *CommitBundle, problemTypeParam, actionParam string) (*ProblemTypeAction, error) {
	if bundle.ProblemType == nil {
		return nil, fmt.Errorf("commit bundle must include the problem type")
	}
	if len(bundle.ProblemTypeSignature) == 0 {
		return nil, fmt.Errorf("commit bundle must include the problem type signature")
	}
	if bundle.Problem == nil {
		return nil, fmt.Errorf("commit bundle must include the problem")
	}
	if bundle.ProblemType.Name != problemTypeParam {
		return nil, fmt.Errorf("problem type in URL (%s) must match problem type in bundle (%s)", problemTypeParam, bundle.ProblemType.Name)
	}
	if actionParam == "" {
		return nil, fmt.Errorf("action must be included in request URL")
	}
	if bundle.ProblemType.Actions == nil || bundle.ProblemType.Actions[actionParam] == nil {
		return nil, fmt.Errorf("action %q not defined for problem type %s", actionParam, bundle.ProblemType.Name)
	}
	if len(bundle.ProblemSteps) == 0 {
		return nil, fmt.Errorf("commit bundle must include the problem steps")
	}
	if len(bundle.ProblemSignature) == 0 {
		return nil, fmt.Errorf("commit bundle must include the problem signature")
	}
	if bundle.Commit == nil {
		return nil, fmt.Errorf("commit bundle must include the commit")
	}
	if len(bundle.CommitSignature) == 0 {
		return nil, fmt.Errorf("commit bundle must include the commit signature")
	}
	if len(bundle.Hostname) == 0 {
		return nil, fmt.Errorf("commit bundle must include the daycare host name")
	}
	if bundle.UserID < 1 {
		return nil, fmt.Errorf("commit bundle must include the user's ID")
	}

	// Check signatures
	typeSig := bundle.ProblemType.ComputeSignature(Config.DaycareSecret)
	if bundle.ProblemTypeSignature != typeSig {
		return nil, fmt.Errorf("problem type signature mismatch")
	}
	problemSig := bundle.Problem.ComputeSignature(Config.DaycareSecret, bundle.ProblemSteps)
	if bundle.ProblemSignature != problemSig {
		return nil, fmt.Errorf("problem signature mismatch")
	}
	commitSig := bundle.Commit.ComputeSignature(Config.DaycareSecret, typeSig, problemSig, bundle.Hostname, bundle.UserID)
	if bundle.CommitSignature != commitSig {
		return nil, fmt.Errorf("commit signature mismatch")
	}

	if bundle.Hostname != Config.Hostname {
		return nil, fmt.Errorf("commit is signed for host %s, this is %s", bundle.Hostname, Config.Hostname)
	}

	age := time.Since(bundle.Commit.UpdatedAt)
	if age < 0 {
		age = -age // Forgiving of clock skew.
	}
	if age > MaxDaycareRequestAge {
		return nil, fmt.Errorf("commit signature is %v old, cannot be more than %v", age, MaxDaycareRequestAge)
	}
	if bundle.Commit.Action != actionParam {
		return nil, fmt.Errorf("commit says action is %s, but request says %s", bundle.Commit.Action, actionParam)
	}

	return bundle.ProblemType.Actions[actionParam], nil
}

// gatherFilesAndStep finds the correct problem step and aggregates files from the bundle.
func gatherFilesAndStep(bundle *CommitBundle) (*ProblemStep, map[string][]byte, error) {
	commit := bundle.Commit
	steps := bundle.ProblemSteps
	problemType := bundle.ProblemType

	if commit.Step < 1 || commit.Step > int64(len(steps)) {
		return nil, nil, fmt.Errorf("commit refers to step number %d, but there are %d steps", commit.Step, len(steps))
	}
	step := steps[commit.Step-1]
	if step == nil {
		return nil, nil, fmt.Errorf("required step %d is nil", commit.Step)
	}
	if step.Step != commit.Step {
		return nil, nil, fmt.Errorf("step number mismatch: commit is for step %d, but step object thinks it is %d", commit.Step, step.Step)
	}
	if step.ProblemType != problemType.Name {
		return nil, nil, fmt.Errorf("problem type mismatch in step %d: expected %q, got %q", step.Step, problemType.Name, step.ProblemType)
	}

	// Collect files from the problem type, problem step, and commit.
	files := make(map[string][]byte)
	for name, contents := range problemType.Files {
		files[name] = contents
	}
	for name, contents := range step.Files {
		files[name] = contents
	}
	for name, contents := range commit.Files {
		files[name] = contents
	}

	return step, files, nil
}

// streamNannyEvents relays events from the nanny to the event channel.
func streamNannyEvents(n *Nanny, commit *Commit, eventChan chan<- *DaycareResponse, done chan<- struct{}) {
	defer func() { done <- struct{}{} }()

	count, overflow, discarded := 0, 0, 0
	for event := range n.Events {
		// Handle transcript data limits.
		if count > TranscriptDataLimit {
			overflow += len(event.StreamData)
		} else {
			count += len(event.StreamData)
			// Merge stream data if possible.
			if len(commit.Transcript) > 0 && commit.Transcript[len(commit.Transcript)-1].Event == event.Event &&
				(event.Event == "stdin" || event.Event == "stdout" || event.Event == "stderr") {
				prev := commit.Transcript[len(commit.Transcript)-1]
				prev.StreamData = append(prev.StreamData, event.StreamData...)
				prev.Time = event.Time
			} else if len(commit.Transcript) < TranscriptEventCountLimit {
				commit.Transcript = append(commit.Transcript, event)
			} else {
				discarded++
			}
		}

		// Transmit the event to the client.
		switch event.Event {
		case "exec", "exit", "stdin", "stdout", "stderr", "stdinclosed", "error", "files":
			if event.Event == "files" {
				log.Printf("%s", event)
			}
			eventChan <- &DaycareResponse{Event: event}
		default:
			// Ignore other event types.
		}
	}

	if overflow > 0 || discarded > 0 {
		log.Printf("transcript truncated by %d events and %d bytes of stream data", discarded, overflow)
	}
}

type Nanny struct {
	ctx        context.Context
	Name       string
	Start      time.Time
	ID         string
	ReportCard *ReportCard
	Events     chan *EventMessage
	Transcript []*EventMessage
	Closed     bool
	Files      map[string][]byte
}

func NewNanny(ctx context.Context, problemType *ProblemType, problem *Problem, action string, args []string, limits *limits, name string) (*Nanny, error) {
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
	cmd := exec.CommandContext(ctx, containerEngine, cmdArgs...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		// if the container already exists, try to remove it and retry
		// this prevents a single student running multiple graders concurrently
		if strings.Contains(string(output), "is already in use") {
			log.Printf("killing existing container with same name %s", name)
			if err2 := removeContainer(ctx, name); err2 != nil {
				return nil, err2
			}

			// retry the command
			output, err = exec.CommandContext(ctx, containerEngine, cmdArgs...).CombinedOutput()
		}
		if err != nil {
			return nil, fmt.Errorf("container run failed: %w\nOutput: %s", err, string(output))
		}
	}

	containerID := strings.TrimSpace(string(output))

	return &Nanny{
			ctx:        ctx,
			Name:       name,
			Start:      time.Now(),
			ID:         containerID,
			ReportCard: NewReportCard(),
			Events:     make(chan *EventMessage, 100),
		},
		nil
}

func (n *Nanny) Shutdown(msg string) error {
	if n.Closed {
		return nil
	}
	n.Closed = true

	// shut down the container
	// Use a fresh, short-lived context so cleanup still happens if the
	// request context has already expired.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := removeContainer(ctx, n.ID); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			log.Printf("nanny shutdown timed out for container %s: %v", n.ID, err)
		}
		return fmt.Errorf("Nanny.Shutdown: %w", err)
	}
	return nil
}

// removeContainer forcefully stops and removes a container by its ID or name.
func removeContainer(ctx context.Context, id string) error {
	cmd := exec.CommandContext(ctx, containerEngine, "rm", "-f", id)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("error killing container %s: %w", id, err)
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
				return fmt.Errorf("writing tar header for directory: %w", err)
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
			return fmt.Errorf("writing tar header: %w", err)
		}
		if _, err := writer.Write(contents); err != nil {
			return fmt.Errorf("writing to tar file: %w", err)
		}
	}
	if err := writer.Close(); err != nil {
		return fmt.Errorf("closing tar file: %w", err)
	}

	// use 'docker cp' to copy the tarball into the /home/student directory.
	// pipe the tar buffer to the command's stdin.
	cmd := exec.CommandContext(n.ctx, containerEngine, "cp", "-", n.ID+":/home/student/")
	cmd.Stdin = buf

	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("container cp failed: %w\nOutput: %s", err, string(output))
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
		cmd := exec.CommandContext(n.ctx, containerEngine, "cp", n.ID+":/home/student/.", "-")
		var tarFile bytes.Buffer
		cmd.Stdout = &tarFile

		// capture stderr in case of error
		var stderr bytes.Buffer
		cmd.Stderr = &stderr

		if err := cmd.Run(); err != nil {
			return nil, fmt.Errorf("container cp from container failed: %w\nOutput: %s", err, tarFile.String())
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
				return nil, fmt.Errorf("error decoding tar file: %w", err)
			}
			if header.Typeflag != tar.TypeReg {
				continue
			}
			contents, err := io.ReadAll(reader)
			if err != nil {
				return nil, fmt.Errorf("error reading %q from tar file: %w", header.Name, err)
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
	command := exec.CommandContext(n.ctx, containerEngine, execCmdArgs...)

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
			return &stdoutBuf, &stderrBuf, &scriptBuf, -1, fmt.Errorf("exec command failed: %w", err)
		}
	}

	n.Events <- &EventMessage{
		Time:       time.Now(),
		Event:      "exit",
		ExitStatus: exitCode,
	}

	return &stdoutBuf, &stderrBuf, &scriptBuf, exitCode, nil
}
