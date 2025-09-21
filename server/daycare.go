package main

import (
	"archive/tar"
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-martini/martini"
	"github.com/gorilla/websocket"
	. "github.com/russross/codegrinder/types"
)

// =================================================================================
// Constants & Configuration
// =================================================================================

// containerEngine can be switched to a compatible alternative like "podman".
const containerEngine = "docker"
const studentUID = 1001

// MAX_TRANSCRIPT_SIZE defines the maximum number of bytes to be collected for the
// session transcript. Output beyond this limit will be discarded.
const MAX_TRANSCRIPT_SIZE = 2 * 1024 * 1024 // 2MB

// Global container engine instance, initialized at startup
var daycareContainerEngine ContainerEngine

// Global container limiter from server.go
var containerLimiter chan struct{}

// =================================================================================
// Core Data Structures
// =================================================================================

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
		val, err := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64)
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

// =================================================================================
// Container Abstraction Layer
// =================================================================================

type Container interface {
	ID() string
	PutFiles(files map[string][]byte, mode int64) error
	GetFiles(patterns []string) (map[string][]byte, error)
	Exec(ctx context.Context, cmd []string, stdout, stderr io.Writer) (status int, err error)
	Shutdown(ctx context.Context) error
}

type ContainerEngine interface {
	CreateContainer(ctx context.Context, name, image string, limits *limits) (Container, error)
}

type DockerContainer struct {
	id   string
	name string
}

type DockerContainerEngine struct {
	activeContainersMu sync.Mutex
	activeContainers   map[string]Container
}

func NewDockerContainerEngine() *DockerContainerEngine {
	return &DockerContainerEngine{
		activeContainers: make(map[string]Container),
	}
}

func (dce *DockerContainerEngine) CreateContainer(ctx context.Context, name, image string, limits *limits) (Container, error) {
	dce.activeContainersMu.Lock()
	defer dce.activeContainersMu.Unlock()

	// If container with same name exists, shut it down first (single attempt as required)
	if existing, ok := dce.activeContainers[name]; ok {
		log.Printf("Container conflict for %s. Making single attempt to kill old container.", name)

		// Create a short timeout context for cleanup - don't let this block too long
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		existing.Shutdown(cleanupCtx)
		cancel()
		delete(dce.activeContainers, name)
	}

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

		// ulimits for resources not covered by cgroups.
		"--ulimit", fmt.Sprintf("core=0:0"),
		"--ulimit", fmt.Sprintf("cpu=%d", limits.maxCPU),
		"--ulimit", fmt.Sprintf("fsize=%d", disk),
	}

	// main command just sleeps; this acts as a timeout mechanism for the whole container
	cmdArgs = append(cmdArgs, image, "/bin/sleep", strconv.FormatInt(timeLimit, 10)+"s")

	log.Printf("Creating container %s with image %s", name, image)

	// execute the command with context
	cmd := exec.CommandContext(ctx, containerEngine, cmdArgs...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		// Check if context was cancelled first
		if ctx.Err() != nil {
			return nil, fmt.Errorf("container creation cancelled: %v", ctx.Err())
		}

		// if the container already exists, try to remove it and retry (single attempt)
		if strings.Contains(string(output), "is already in use") {
			log.Printf("killing existing container with same name %s", name)
			if err2 := removeContainer(ctx, name); err2 != nil {
				return nil, err2
			}

			// retry the command once
			cmd = exec.CommandContext(ctx, containerEngine, cmdArgs...)
			output, err = cmd.CombinedOutput()
		}
		if err != nil {
			return nil, fmt.Errorf("container run failed: %v\nOutput: %s", err, string(output))
		}
	}

	containerID := strings.TrimSpace(string(output))
	container := &DockerContainer{id: containerID, name: name}

	dce.activeContainers[name] = container
	return container, nil
}

func (dc *DockerContainer) ID() string {
	return dc.id
}

func (dc *DockerContainer) Shutdown(ctx context.Context) error {
	// Remove from active containers map
	if dce, ok := daycareContainerEngine.(*DockerContainerEngine); ok {
		dce.activeContainersMu.Lock()
		delete(dce.activeContainers, dc.name)
		dce.activeContainersMu.Unlock()
	}

	log.Printf("Shutting down container %s", dc.id)
	return removeContainer(ctx, dc.id)
}

// removeContainer forcefully stops and removes a container by its ID or name.
func removeContainer(ctx context.Context, id string) error {
	cmd := exec.CommandContext(ctx, containerEngine, "rm", "-f", id)
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			// Context cancelled, but we still want to try cleanup without context
			log.Printf("Context cancelled during container removal, attempting forced cleanup for %s", id)
			cmd = exec.Command(containerEngine, "rm", "-f", id)
			cmd.Run() // Best effort, ignore errors
		}
		return fmt.Errorf("error killing container %s: %v", id, err)
	}
	return nil
}

// copy a set of files to the given container
func (dc *DockerContainer) PutFiles(files map[string][]byte, mode int64) error {
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
	cmd := exec.Command(containerEngine, "cp", "-", dc.id+":/home/student/")
	cmd.Stdin = buf

	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("container cp failed: %v\nOutput: %s", err, string(output))
	}
	return nil
}

// GetFiles copies files from the given container.
func (dc *DockerContainer) GetFiles(filenames []string) (map[string][]byte, error) {
	if len(filenames) == 0 {
		return nil, nil
	}

	// use 'docker cp' to get the /home/student directory as a tar stream
	cmd := exec.Command(containerEngine, "cp", dc.id+":/home/student/.", "-")
	var tarFile bytes.Buffer
	cmd.Stdout = &tarFile

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("container cp from container failed: %v", err)
	}

	// extract the files
	files := make(map[string][]byte)
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
		files[name] = contents
	}

	// pick out the requested files
	result := make(map[string][]byte)
	for name, contents := range files {
		for _, pattern := range filenames {
			matched, err := filepath.Match(pattern, name)
			if err != nil {
				log.Printf("GetFiles: bad pattern found: %q", pattern)
			} else if matched {
				result[name] = contents
				break
			}
		}
	}

	return result, nil
}

// Exec runs a command inside the container and captures its output
func (dc *DockerContainer) Exec(ctx context.Context, cmd []string, stdout, stderr io.Writer) (status int, err error) {
	// construct the 'docker exec' command arguments.
	execCmdArgs := []string{"exec", "--user", strconv.Itoa(studentUID), dc.id}
	execCmdArgs = append(execCmdArgs, cmd...)
	command := exec.CommandContext(ctx, containerEngine, execCmdArgs...)

	command.Stdout = stdout
	command.Stderr = stderr

	// start the command
	err = command.Run()

	exitCode := 0
	if err != nil {
		// Check if context was cancelled first
		if ctx.Err() != nil {
			log.Printf("Container exec cancelled for %s: %v", dc.id, ctx.Err())
			return -1, ctx.Err()
		}

		// try to extract the exit code from the error
		if exitError, ok := err.(*exec.ExitError); ok {
			exitCode = exitError.ExitCode()
		} else {
			// a different error occurred (e.g., command not found).
			return -1, fmt.Errorf("exec command failed: %v", err)
		}
	}

	return exitCode, nil
}

// =================================================================================
// Utility Writers for Event Streaming
// =================================================================================

type TruncatingWriter struct {
	w       io.Writer
	max     int
	current int
	mu      sync.Mutex
}

func NewTruncatingWriter(w io.Writer, max int) *TruncatingWriter {
	return &TruncatingWriter{w: w, max: max}
}

func (tw *TruncatingWriter) Write(p []byte) (n int, err error) {
	tw.mu.Lock()
	defer tw.mu.Unlock()
	originalLen := len(p)
	remaining := tw.max - tw.current
	if remaining <= 0 {
		return originalLen, nil
	}
	if len(p) > remaining {
		p = p[:remaining]
	}
	n, err = tw.w.Write(p)
	tw.current += n
	return originalLen, err
}

// eventWriter forwards writes to an event channel for real-time streaming
type eventWriter struct {
	event  string
	events chan<- *EventMessage
}

func (ew *eventWriter) Write(p []byte) (n int, err error) {
	if len(p) == 0 {
		return 0, nil
	}
	clone := make([]byte, len(p))
	copy(clone, p)
	ew.events <- &EventMessage{
		Time:       time.Now(),
		Event:      ew.event,
		StreamData: clone,
	}
	return len(p), nil
}

// =================================================================================
// Core Daycare Processing Logic
// =================================================================================

// HandleDaycareRequest processes a daycare request and returns the updated commit bundle
func HandleDaycareRequest(ctx context.Context, req *DaycareRequest, responseChan chan<- *DaycareResponse, problemTypeName, action string, args []string) (*CommitBundle, error) {
	// Ensure response channel is closed when function returns
	defer close(responseChan)

	now := time.Now()

	// sanity check the request
	if req.CommitBundle == nil {
		return nil, fmt.Errorf("first request message must include the commit bundle")
	}
	if req.CommitBundle.ProblemType == nil {
		return nil, fmt.Errorf("commit bundle must include the problem type")
	}
	if len(req.CommitBundle.ProblemTypeSignature) == 0 {
		return nil, fmt.Errorf("commit bundle must include the problem type signature")
	}
	if req.CommitBundle.ProblemType.Name != problemTypeName {
		return nil, fmt.Errorf("problem type in request URL must match problem type in bundle")
	}
	if action == "" {
		return nil, fmt.Errorf("action must be included in request URL")
	}
	if req.CommitBundle.ProblemType.Actions == nil || req.CommitBundle.ProblemType.Actions[action] == nil {
		return nil, fmt.Errorf("action %q not defined for problem type %s", action, problemTypeName)
	}
	actionDef := req.CommitBundle.ProblemType.Actions[action]
	if req.CommitBundle.Problem == nil {
		return nil, fmt.Errorf("commit bundle must include the problem")
	}
	if len(req.CommitBundle.ProblemSteps) == 0 {
		return nil, fmt.Errorf("commit bundle must include the problem steps")
	}
	if len(req.CommitBundle.ProblemSignature) == 0 {
		return nil, fmt.Errorf("commit bundle must include the problem signature")
	}
	if req.CommitBundle.Commit == nil {
		return nil, fmt.Errorf("commit bundle must include the commit")
	}
	if len(req.CommitBundle.CommitSignature) == 0 {
		return nil, fmt.Errorf("commit bundle must include the commit signature")
	}
	if len(req.CommitBundle.Hostname) == 0 {
		return nil, fmt.Errorf("commit bundle must include the daycare host name")
	}
	if req.CommitBundle.UserID < 1 {
		return nil, fmt.Errorf("commit bundle must include the user's ID")
	}

	if len(args) > 0 {
		log.Printf("args: %v", args)
	}

	// check signatures
	problemTypeObj := req.CommitBundle.ProblemType
	typeSig := problemTypeObj.ComputeSignature(Config.DaycareSecret)
	if req.CommitBundle.ProblemTypeSignature != typeSig {
		return nil, fmt.Errorf("problem type signature mismatch: found %s but expected %s", req.CommitBundle.ProblemTypeSignature, typeSig)
	}
	problem, steps := req.CommitBundle.Problem, req.CommitBundle.ProblemSteps
	problemSig := problem.ComputeSignature(Config.DaycareSecret, steps)
	if req.CommitBundle.ProblemSignature != problemSig {
		return nil, fmt.Errorf("problem signature mismatch: found %s but expected %s", req.CommitBundle.ProblemSignature, problemSig)
	}
	commit := req.CommitBundle.Commit
	commitSig := commit.ComputeSignature(Config.DaycareSecret, typeSig, problemSig, req.CommitBundle.Hostname, req.CommitBundle.UserID)
	if req.CommitBundle.CommitSignature != commitSig {
		return nil, fmt.Errorf("commit signature mismatch: found %s but expected %s", req.CommitBundle.CommitSignature, commitSig)
	}
	req.CommitBundle.CommitSignature = ""

	// host must match
	if req.CommitBundle.Hostname != Config.Hostname {
		return nil, fmt.Errorf("commit is signed for host %s, this is %s", req.CommitBundle.Hostname, Config.Hostname)
	}

	// commit must be recent
	age := time.Since(commit.UpdatedAt)
	if age < 0 {
		// be forgiving of clock skew
		age = -age
	}
	if age > MaxDaycareRequestAge {
		return nil, fmt.Errorf("commit signature is %v off, cannot be more than %v", age, MaxDaycareRequestAge)
	}
	if commit.Action != action {
		return nil, fmt.Errorf("commit says action is %s, but request says %s", commit.Action, action)
	}

	// find the problem step
	if commit.Step < 1 || commit.Step > int64(len(steps)) {
		return nil, fmt.Errorf("commit refers to step number %d, but there are %d steps in the problem", commit.Step, len(steps))
	}
	step := steps[commit.Step-1]
	if step == nil {
		return nil, fmt.Errorf("required step %d is nil", commit.Step)
	}
	if step.Step != commit.Step {
		return nil, fmt.Errorf("step number %d in the problem thinks it is step number %d", commit.Step, step.Step)
	}
	if step.ProblemType != problemTypeObj.Name {
		return nil, fmt.Errorf("step number %d in the problem has problem type %q but the commit bundle included problem type %q", commit.Step, step.ProblemType, problemTypeObj.Name)
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

	// create container
	containerName := fmt.Sprintf("nanny-%d", req.CommitBundle.UserID)
	limits := newLimits(actionDef)
	limits.override(problem.Options)

	container, err := daycareContainerEngine.CreateContainer(ctx, containerName, req.CommitBundle.ProblemType.Image, limits)
	if err != nil {
		return nil, fmt.Errorf("error creating container: %v", err)
	}

	// shutdown the container when finished - ALWAYS ensure cleanup
	defer func() {
		// Give cleanup a reasonable timeout, but not too long
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		if err := container.Shutdown(cleanupCtx); err != nil {
			log.Printf("container shutdown error: %v", err)
		}
		log.Printf("Container %s cleanup completed", containerName)
	}()

	// Initialize report card and transcript
	reportCard := NewReportCard()
	var transcript []*EventMessage

	// Create event listening goroutine with context monitoring
	eventListenerClosed := make(chan struct{})
	eventChan := make(chan *EventMessage, 100)

	go func() {
		defer func() { eventListenerClosed <- struct{}{} }()

		count, overflow, discarded := 0, 0, 0
		for {
			select {
			case <-ctx.Done():
				// Context cancelled - stop processing events
				log.Printf("Event processing stopped due to context cancellation: %v", ctx.Err())
				return
			case event, ok := <-eventChan:
				if !ok {
					// Channel closed normally
					break
				}

				if count > TranscriptDataLimit {
					overflow += len(event.StreamData)
				} else {
					count += len(event.StreamData)

					// record the event in transcript
					if len(event.StreamData) > 0 && len(transcript) > 0 && transcript[len(transcript)-1].Event == event.Event &&
						(event.Event == "stdin" || event.Event == "stdout" || event.Event == "stderr") {
						// merge this with the previous event
						prev := transcript[len(transcript)-1]
						data := make([]byte, 0, len(prev.StreamData)+len(event.StreamData))
						data = append(data, prev.StreamData...)
						data = append(data, event.StreamData...)
						prev.StreamData = data
						prev.Time = event.Time
					} else if len(transcript) < TranscriptEventCountLimit {
						transcript = append(transcript, event)
					} else {
						discarded++
					}
				}

				// transmit the message to the client (non-blocking)
				switch event.Event {
				case "exec", "exit", "stdin", "stdout", "stderr", "stdinclosed", "error", "files":
					select {
					case responseChan <- &DaycareResponse{Event: event}:
						// Sent successfully
					case <-ctx.Done():
						// Context cancelled while trying to send
						log.Printf("Event transmission stopped due to context cancellation")
						return
					}
				}
			}
		}

		// report any truncation
		if overflow > 0 || discarded > 0 {
			log.Printf("transcript truncated by %d events and %d bytes of stream data", discarded, overflow)
		}
	}()

	// copy the files to the container
	if err = container.PutFiles(files, 0666); err != nil {
		reportCard.LogAndFailf("uploading files: %v", err)
		close(eventChan)
		<-eventListenerClosed
		return nil, err
	}

	// Send exec event
	eventChan <- &EventMessage{
		Time:        time.Now(),
		Event:       "exec",
		ExecCommand: strings.Fields(actionDef.Command),
	}

	// run the action with context
	cmd := strings.Fields(actionDef.Command)
	var stdoutBuf, stderrBuf, scriptBuf bytes.Buffer

	// create writers that send events AND write to local buffers
	stdoutWriter := io.MultiWriter(&stdoutBuf, &scriptBuf, &eventWriter{event: "stdout", events: eventChan})
	stderrWriter := io.MultiWriter(&stderrBuf, &scriptBuf, &eventWriter{event: "stderr", events: eventChan})

	status, err := container.Exec(ctx, cmd, stdoutWriter, stderrWriter)

	// Send exit event
	eventChan <- &EventMessage{
		Time:       time.Now(),
		Event:      "exit",
		ExitStatus: status,
	}

	if err != nil {
		reportCard.LogAndFailf("%q exec error: %v", strings.Join(cmd, " "), err)
	} else if status != 0 {
		reportCard.LogAndFailf("%q failed with exit status %d", strings.Join(cmd, " "), status)
	}

	// Parse the results based on the parser type
	switch actionDef.Parser {
	case "xunit":
		parseXUnitResults(reportCard, &stdoutBuf)
	case "check":
		parseCheckResults(reportCard, &stdoutBuf)
	case "":
		// no parser, just use the exit status
		reportCard.Passed = status == 0
	default:
		reportCard.LogAndFailf("unknown parser %q for problem type %s action %s",
			actionDef.Parser, problemTypeName, action)
	}

	// download any files requested
	for _, option := range problem.Options {
		parts := strings.SplitN(option, "=", 2)
		if len(parts) != 2 || parts[0] != "download" {
			continue
		}
		files, err := container.GetFiles(strings.Split(parts[1], ","))
		if err != nil {
			log.Printf("error trying to download files from container: %v", err)
		} else if len(files) > 0 {
			eventChan <- &EventMessage{Event: "files", Files: files}
		}
	}

	// wait for listener to finish
	close(eventChan)
	<-eventListenerClosed

	// Update commit with results
	commit.ReportCard = reportCard
	commit.Transcript = transcript

	// compute the score for this step on a scale of 0.0 to 1.0
	if action == "grade" {
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

		return req.CommitBundle, nil
	}

	return nil, nil
}

// =================================================================================
// WebSocket Transport Layer
// =================================================================================

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow connections from any origin for now
	},
}

// SocketProblemTypeAction handles WebSocket requests for daycare operations
func SocketProblemTypeAction(w http.ResponseWriter, r *http.Request, params martini.Params) {
	problemType := params["problem_type"]
	action := params["action"]

	// We'll set the context timeout after we parse the request and know the limits
	ctx := r.Context()
	var cancel context.CancelFunc

	// CORS header for browser-based requests if the TA is a different host than the daycare
	w.Header().Set("Access-Control-Allow-Origin", "https://"+Config.TAHostname)

	// get a websocket
	socket, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		loggedHTTPErrorf(w, http.StatusBadRequest, "websocket error: %v", err)
		return
	}

	// Ensure WebSocket is ALWAYS closed properly
	defer func() {
		// Send close frame with timeout
		closeMsg := websocket.FormatCloseMessage(websocket.CloseNormalClosure, "Session completed")
		socket.WriteControl(websocket.CloseMessage, closeMsg, time.Now().Add(5*time.Second))
		socket.Close()
		log.Printf("WebSocket connection closed for %s/%s", problemType, action)
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

	// Now we can set proper timeout based on the configuration
	if req.CommitBundle != nil && req.CommitBundle.ProblemType != nil && req.CommitBundle.ProblemType.Actions != nil {
		if actionDef, ok := req.CommitBundle.ProblemType.Actions[action]; ok {
			// Use same calculation as container timeout: maxCPU * 2 + buffer for cleanup
			timeLimit := time.Duration(actionDef.MaxCPU*2+10) * time.Second
			ctx, cancel = context.WithTimeout(ctx, timeLimit)
			defer cancel()
			log.Printf("Session timeout set to %v for %s/%s", timeLimit, problemType, action)
		} else {
			// Fallback timeout if action not found
			ctx, cancel = context.WithTimeout(ctx, 5*time.Minute)
			defer cancel()
		}
	} else {
		// Fallback timeout if request is malformed
		ctx, cancel = context.WithTimeout(ctx, 5*time.Minute)
		defer cancel()
	}

	// create output channel for responses
	responseChan := make(chan *DaycareResponse, 10) // buffered channel to reduce waiting on websocket
	finished := make(chan struct{})

	// Monitor for early WebSocket disconnection
	go func() {
		for {
			_, _, err := socket.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					log.Printf("WebSocket disconnected unexpectedly: %v", err)
				} else {
					log.Printf("WebSocket closed by client: %v", err)
				}
				// Cancel context to stop container processing
				cancel()
				return
			}
		}
	}()

	// start goroutine to read from channel and send to websocket
	go func() {
		defer func() { finished <- struct{}{} }()

		broken := false
		for {
			select {
			case <-ctx.Done():
				log.Printf("WebSocket sender stopping due to context cancellation: %v", ctx.Err())
				return
			case res, ok := <-responseChan:
				if !ok {
					// Channel closed normally
					return
				}
				if broken {
					// on websocket error, continue draining channel but ignore values
					continue
				}
				if err := socket.WriteJSON(res); err != nil {
					// keep going to drain the channel so we can't block the sender
					broken = true
					if strings.Contains(err.Error(), "use of closed network connection") {
						log.Printf("WebSocket connection closed during write")
					} else {
						logAndTransmitErrorf("websocket write error: %v", err)
					}
					// Cancel context when websocket fails
					cancel()
				}
			}
		}
	}()

	// call the common handler with context
	commitBundle, err := HandleDaycareRequest(ctx, req, responseChan, problemType, action, args)

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
}

// =================================================================================
// Initialization
// =================================================================================

// InitDaycareEngine initializes the singleton container engine for the daycare service.
// This must be called once by the main application during startup.
func InitDaycareEngine() {
	daycareContainerEngine = NewDockerContainerEngine()
	log.Println("Daycare container engine initialized.")
}