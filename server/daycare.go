package main

import (
	"archive/tar"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"math/rand"
	"net/http"
	"os"
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

// OCI container spec structures
type OCISpec struct {
	OCIVersion string      `json:"ociVersion"`
	Process    Process     `json:"process"`
	Root       Root        `json:"root"`
	Hostname   string      `json:"hostname"`
	Mounts     []Mount     `json:"mounts"`
	Linux      LinuxConfig `json:"linux"`
}

type Process struct {
	User         OCIUser      `json:"user"`
	Args         []string     `json:"args"`
	Env          []string     `json:"env"`
	Cwd          string       `json:"cwd"`
	Capabilities Capabilities `json:"capabilities"`
	Rlimits      []Rlimit     `json:"rlimits"`
}

type OCIUser struct {
	UID int `json:"uid"`
	GID int `json:"gid"`
}

type Capabilities struct {
	Bounding    []string `json:"bounding"`
	Effective   []string `json:"effective"`
	Inheritable []string `json:"inheritable"`
	Permitted   []string `json:"permitted"`
}

type Rlimit struct {
	Type string `json:"type"`
	Hard uint64 `json:"hard"`
	Soft uint64 `json:"soft"`
}

type Root struct {
	Path     string `json:"path"`
	Readonly bool   `json:"readonly"`
}

type Mount struct {
	Destination string   `json:"destination"`
	Type        string   `json:"type"`
	Source      string   `json:"source"`
	Options     []string `json:"options,omitempty"`
}

type LinuxConfig struct {
	Namespaces []Namespace `json:"namespaces"`
}

type Namespace struct {
	Type string `json:"type"`
}

var stateDir string

// problem type/problem resource limits
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

	// launch a nanny process
	nannyName := fmt.Sprintf("nanny-%d", req.CommitBundle.UserID)
	//log.Printf("launching container for %s", nannyName)
	limits := newLimits(action)
	limits.override(problem.Options)
	//ctx, cancel := context.WithDeadline(context.Background(), now.Add(time.Duration(limits.maxCPU*2)*time.Second))
	ctx, cancel := context.WithDeadline(context.Background(), now.Add(30*time.Second))
	defer cancel()
	n, err := NewNanny(ctx, req.CommitBundle.ProblemType, problem, action.Action, args, limits, nannyName)
	if err != nil {
		logAndTransmitErrorf("error creating container: %v", err)
		return
	}

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
	if err = n.PutFiles(ctx, files, 0666); err != nil {
		n.ReportCard.LogAndFailf("uploading files: %v", err)
		return
	}

	// run the action
	//log.Printf("%s: %s", action.ProblemType, action.Message)
	cmd := strings.Fields(action.Command)
	switch {
	case action.Parser == "xunit":
		runAndParseXUnit(ctx, n, cmd)

	case action.Parser == "check":
		runAndParseCheckXML(ctx, n, cmd)

	case action.Parser != "":
		n.ReportCard.LogAndFailf("unknown parser %q for problem type %s action %s",
			action.Parser, action.ProblemType, action.Action)
		return

	default:
		status, err := n.Exec(ctx, cmd)
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
		files, err := n.GetFiles(ctx, strings.Split(parts[1], ","))
		if err != nil {
			log.Printf("error trying to download files from container: %v", err)
		} else if len(files) > 0 {
			n.Events <- &EventMessage{Event: "files", Files: files}
		}
	}

	// shutdown the nanny
	n.Shutdown("action finished")

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
	UID        int64
	ReportCard *ReportCard
	Events     chan *EventMessage
	Transcript []*EventMessage
	Closed     bool
	Files      map[string][]byte
}

func NewNanny(ctx context.Context, problemType *ProblemType, problem *Problem, action string, args []string, limits *limits, name string) (*Nanny, error) {
	// create a container
	uid, err := allocUID()
	if err != nil {
		return nil, err
	}
	defer func() {
		if uid > 0 {
			releaseUID(uid)
			uid = 0
		}
	}()
	mem := limits.maxMemory * 1024 * 1024
	disk := limits.maxFileSize * 1024 * 1024
	timeLimit := limits.maxCPU * 2

	// make sure the state directory exists
	if stateDir == "" {
		stateDir = filepath.Join(root, "state")
		if err := os.MkdirAll(stateDir, 0755); err != nil {
			return nil, err
		}
	}

	// create a directory for the container config
	containerDir := filepath.Join(root, "bundles", name)
	if err := os.MkdirAll(containerDir, 0755); err != nil {
		return nil, err
	}
	defer os.RemoveAll(containerDir)

	configPath := filepath.Join(containerDir, "config.json")

	// prepare the OCI spec file
	spec := OCISpec{
		OCIVersion: "1.0.0",
		Process: Process{
			User: OCIUser{
				UID: int(uid),
				GID: int(uid),
			},
			Args: []string{"/bin/sleep", fmt.Sprintf("%ds", timeLimit)},
			Env: []string{
				"USER=student",
				"HOME=/home/student",
				"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
				"TERM=xterm",
			},
			Cwd: "/home/student",
			Capabilities: Capabilities{
				Bounding:    []string{},
				Effective:   []string{},
				Inheritable: []string{},
				Permitted:   []string{},
			},
			Rlimits: []Rlimit{
				{Type: "RLIMIT_CORE", Hard: 0, Soft: 0},
				{Type: "RLIMIT_CPU", Hard: uint64(limits.maxCPU), Soft: uint64(limits.maxCPU)},
				{Type: "RLIMIT_DATA", Hard: uint64(mem), Soft: uint64(mem)},
				{Type: "RLIMIT_FSIZE", Hard: uint64(disk), Soft: uint64(disk)},
				{Type: "RLIMIT_MEMLOCK", Hard: 0, Soft: 0},
				{Type: "RLIMIT_NOFILE", Hard: uint64(limits.maxFD), Soft: uint64(limits.maxFD)},
				{Type: "RLIMIT_NPROC", Hard: uint64(limits.maxThreads), Soft: uint64(limits.maxThreads)},
			},
		},
		Root: Root{
			Path:     "/rootfs",
			Readonly: true,
		},
		Hostname: name,
		Mounts: []Mount{
			{
				Destination: "/proc",
				Type:        "proc",
				Source:      "proc",
			},
			{
				Destination: "/dev",
				Type:        "tmpfs",
				Source:      "tmpfs",
			},
			{
				Destination: "/sys",
				Type:        "sysfs",
				Source:      "sysfs",
				Options:     []string{"nosuid", "noexec", "nodev", "ro"},
			},
			{
				Destination: "/home/student",
				Type:        "tmpfs",
				Source:      "tmpfs",
				Options: []string{
					"rw",
					"exec",
					"nosuid",
					"nodev",
					fmt.Sprintf("size=%dk", disk/1024),
					fmt.Sprintf("uid=%d", uid),
					fmt.Sprintf("gid=%d", uid),
				},
			},
			{
				Destination: "/tmp",
				Type:        "tmpfs",
				Source:      "tmpfs",
				Options: []string{
					"rw",
					"exec",
					"nosuid",
					"nodev",
					fmt.Sprintf("size=%dk", disk/1024),
					fmt.Sprintf("uid=%d", uid),
					fmt.Sprintf("gid=%d", uid),
				},
			},
		},
		Linux: LinuxConfig{
			Namespaces: []Namespace{
				{Type: "pid"},
				{Type: "network"},
				{Type: "ipc"},
				{Type: "uts"},
				{Type: "mount"},
			},
		},
	}

	configJSON, err := json.MarshalIndent(spec, "", "    ")
	if err != nil {
		return nil, fmt.Errorf("failed to marshal container spec: %v", err)
	}
	if err := ioutil.WriteFile(configPath, configJSON, 0644); err != nil {
		return nil, fmt.Errorf("failed to write config file: %v", err)
	}

	log.Printf("new container %s; action %s on %s (%s); params cpu=%d, fd=%d, file=%d, mem=%d, threads=%d",
		name, action, problem.Unique, problemType.Name,
		limits.maxCPU, limits.maxFD, limits.maxFileSize, limits.maxMemory, limits.maxThreads)

	// kill any existing container for this user
	removeContainer(name)

	// Run the container with runsc
	cmd := exec.CommandContext(ctx,
		"runsc",
		"-root", stateDir,
		//"-rootless",
		"-network", "none",
		"-debug-log", "/dev/log",
		"-debug",
		"run",
		"-bundle", containerDir,
		"-detach",
		name,
	)

	// Start the container
	if err = cmd.Run(); err != nil {
		return nil, fmt.Errorf("failed to start container: %v", err)
	}

	nanny := &Nanny{
		Name:       name,
		Start:      time.Now(),
		UID:        uid,
		ReportCard: NewReportCard(),
		Events:     make(chan *EventMessage),
		Transcript: []*EventMessage{},
		Closed:     false,
		Files:      nil,
	}

	// tell the deferred function that we succeeded so it doesn't free the UID
	uid = 0

	return nanny, nil
}

func (n *Nanny) Shutdown(msg string) {
	if n.Closed {
		return
	}
	n.Closed = true

	// shut down the container
	log.Printf("shutting down %s: %s", n.Name, msg)
	removeContainer(n.Name)
	releaseUID(n.UID)
}

// PutFiles copies a set of files to the given container.
// The container must be running.
func (n *Nanny) PutFiles(ctx context.Context, files map[string][]byte, mode int64) error {
	// nothing to do?
	if len(files) == 0 {
		return nil
	}

	// tar the files
	nowish := time.Now().Add(-time.Second)
	buf := new(bytes.Buffer)
	writer := tar.NewWriter(buf)
	dirs := make(map[string]bool)
	for name, contents := range files {
		dir := filepath.Dir(name)
		if dir != "" && !dirs[dir] {
			dirs[dir] = true
			header := &tar.Header{
				Name:       dir,
				Mode:       0777,
				Uid:        int(n.UID),
				Gid:        int(n.UID),
				Size:       0,
				ModTime:    nowish,
				Typeflag:   tar.TypeDir,
				Uname:      strconv.FormatInt(n.UID, 10),
				Gname:      strconv.FormatInt(n.UID, 10),
				AccessTime: nowish,
				ChangeTime: nowish,
			}
			if err := writer.WriteHeader(header); err != nil {
				log.Printf("writing tar header for directory: %v", err)
				return err
			}
		}
		header := &tar.Header{
			Name:       name,
			Mode:       mode,
			Uid:        int(n.UID),
			Gid:        int(n.UID),
			Size:       int64(len(contents)),
			ModTime:    nowish,
			Typeflag:   tar.TypeReg,
			Uname:      strconv.FormatInt(n.UID, 10),
			Gname:      strconv.FormatInt(n.UID, 10),
			AccessTime: nowish,
			ChangeTime: nowish,
		}
		if err := writer.WriteHeader(header); err != nil {
			log.Printf("writing tar header: %v", err)
			return err
		}
		if _, err := writer.Write(contents); err != nil {
			log.Printf("writing to tar file: %v", err)
			return err
		}
	}
	if err := writer.Close(); err != nil {
		log.Printf("closing tar file: %v", err)
		return err
	}

	// exec tar in the container
	cmd := exec.CommandContext(ctx,
		"runsc",
		"-root", stateDir,
		//"-rootless",
		"-network", "none",
		"-debug-log", "/dev/log",
		"-debug",
		"exec",
		n.Name,
		"/bin/tar", "x", "-f", "-", "-C", "/home/student",
	)
	cmd.Stdin = buf
	out, err := cmd.CombinedOutput()
	if len(out) != 0 {
		log.Printf("tar output: %q", out)
		//return fmt.Errorf("tar gave non-empty output when extracting files into container")
	}
	if err != nil {
		log.Printf("running tar command output when uploading files: %v", err)
		return err
	}

	return nil
}

// GetFiles copies a set of files from the given container.
// All student files are copied from the container on the first call to GetFiles.
// Subsequent calls will just gather files from the collection.
// The container must be running or the files must have already been fetched
// by a previous call to GetFiles.
func (n *Nanny) GetFiles(ctx context.Context, filenames []string) (map[string][]byte, error) {
	// nothing to do?
	if len(filenames) == 0 {
		return nil, nil
	}

	// do we need to fetch the files?
	if n.Files == nil {
		// cannot fetch files if the container is closed
		if n.Closed {
			return nil, nil
		}

		cmd := exec.CommandContext(ctx,
			"runsc",
			"-root", stateDir,
			//"-rootless",
			"-network", "none",
			"exec",
			n.Name,
			"/bin/tar", "c", "-f", "-", "-C", "/home/student", ".",
		)

		// decode stdout as a tar file
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			log.Printf("attaching to tar command output to download files: %v", err)
			return nil, err
		}
		reader := tar.NewReader(stdout)

		// watch for any stderr output
		tarErr := new(bytes.Buffer)
		cmd.Stderr = tarErr

		// start the command
		if err = cmd.Start(); err != nil {
			log.Printf("running tar command to download files: %v", err)
			return nil, err
		}

		// extract the files
		n.Files = make(map[string][]byte)
		for {
			header, err := reader.Next()
			if err == io.EOF {
				break
			}
			if err != nil {
				log.Printf("error decoding tar file: %v", err)
				return nil, err
			}
			if header.Typeflag != tar.TypeReg {
				continue
			}
			contents := make([]byte, header.Size)
			if _, err = io.ReadFull(reader, contents); err != nil {
				log.Printf("error reading %q from tar file: %v", header.Name, err)
				return nil, err
			}

			name := filepath.Clean(header.Name)
			n.Files[name] = contents
		}
		if err := cmd.Wait(); err != nil {
			log.Printf("waiting for tar command to finish to download files: %v", err)
			return nil, err
		}

		if tarErr.Len() != 0 {
			log.Printf("tar gave non-empty error output when gathering files from container: %q", tarErr.String())
			return nil, err
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
				//log.Printf("getfiles: getting %s", name)
				break
			}
		}
	}
	if badpattern != "" {
		log.Printf("GetFiles: bad pattern found: %q", badpattern)
	}

	return files, nil
}

type execOutput struct {
	mutex  sync.Mutex
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
	out.mutex.Lock()
	n, err = out.script.Write(data)
	out.mutex.Unlock()
	if err != nil || n != len(data) {
		log.Printf("execStdout.Write: error writing to script buffer: %v", err)
		return n, err
	}

	clone := make([]byte, len(data))
	copy(clone, data)
	out.events <- &EventMessage{
		Time:       time.Now(),
		Event:      "stdout",
		StreamData: clone,
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
	out.mutex.Lock()
	n, err = out.script.Write(data)
	out.mutex.Unlock()
	if err != nil || n != len(data) {
		log.Printf("execStderr.Write: error writing to script buffer: %v", err)
		return n, err
	}

	clone := make([]byte, len(data))
	copy(clone, data)
	out.events <- &EventMessage{
		Time:       time.Now(),
		Event:      "stderr",
		StreamData: clone,
	}

	return n, err
}

func (n *Nanny) Exec(ctx context.Context, execCmd []string) (status int, err error) {
	// log the event
	n.Events <- &EventMessage{
		Time:        time.Now(),
		Event:       "exec",
		ExecCommand: execCmd,
	}

	// create
	args := append(
		[]string{
			"-root", stateDir,
			//"-rootless",
			"-network", "none",
			"-debug-log", "/dev/log",
			"-debug",
			"exec",
			n.Name,
		},
		execCmd...)
	cmd := exec.CommandContext(ctx,
		"runsc", args...,
	)

	// gather output
	var out execOutput
	out.events = n.Events
	cmd.Stdout = (*execStdout)(&out)
	cmd.Stderr = (*execStdout)(&out)

	// start
	exitStatus := 0
	if err := cmd.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitStatus = exitErr.ExitCode()
		} else {
			log.Printf("Exec: %v", err)
			return 0, err
		}
	}

	n.Events <- &EventMessage{
		Time:       time.Now(),
		Event:      "exit",
		ExitStatus: exitStatus,
	}

	return exitStatus, nil
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

func removeContainer(name string) {
	cmd := exec.Command(
		"runsc",
		"-root", stateDir,
		//"-rootless",
		"-debug-log", "/dev/log",
		"-debug",
		"kill", name, "SIGKILL", "-all",
	)

	// note: this gives an error when it actually kills one,
	// and returns success when there was nothing to kill
	if out, err := cmd.CombinedOutput(); err != nil {
		log.Printf("error killing container: %v with output %q", err, out)
	}

	cmd = exec.Command(
		"runsc",
		"-root", stateDir,
		//"-rootless",
		"-debug-log", "/dev/log",
		"-debug",
		"delete", "-force",
		name,
	)

	// note: this gives an error when it actually kills one,
	// and returns success when there was nothing to kill
	if out, err := cmd.CombinedOutput(); err != nil {
		log.Printf("error deleting container: %v with output %q", err, out)
	}
}
