package main

import (
	"archive/tar"
	"bytes"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	docker "github.com/fsouza/go-dockerclient"
	"github.com/go-martini/martini"
	"github.com/gorilla/websocket"
	. "github.com/russross/codegrinder/types"
)

var dockerClient *docker.Client

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
	n, err := NewNanny(req.CommitBundle.ProblemType, problem, action.Interactive, action.Action, args, limits, nannyName)
	if err != nil {
		logAndTransmitErrorf("error creating container: %v", err)
		return
	}
	rw := newReadWriteBuffer()

	// watch for timeouts
	alive := make(chan bool)
	go func() {
		duration := time.Duration(limits.maxTimeout) * time.Second
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
				if _, err := rw.Write(msg.Stdin); err != nil {
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
		//log.Printf("stdin listener closed")
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
		rw.Close()

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
	//log.Printf("%s: %s", action.ProblemType, action.Message)
	var stdin io.Reader
	if action.Interactive {
		stdin = rw
	}
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
		_, _, _, status, err := n.Exec(cmd, stdin, true)
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

	// shutdown the nanny
	if err := n.Shutdown("action finished"); err != nil {
		logAndTransmitErrorf("nanny shutdown error: %v", err)
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
	Container  *docker.Container
	UID        int64
	ReportCard *ReportCard
	Input      chan string
	Events     chan *EventMessage
	Transcript []*EventMessage
	Closed     bool
	Files      map[string][]byte
}

var getContainerIDRE = regexp.MustCompile(`The name .* is already in use by container (.*)\. You have to delete \(or rename\) that container to be able to reuse that name`)

func getContainerID(msg string) string {
	groups := getContainerIDRE.FindStringSubmatch(msg)
	if len(groups) != 2 {
		return ""
	}
	return groups[1]
}

func NewNanny(problemType *ProblemType, problem *Problem, interactive bool, action string, args []string, limits *limits, name string) (*Nanny, error) {
	// create a container
	mem := limits.maxMemory * 1024 * 1024
	disk := limits.maxFileSize * 1024 * 1024
	uid, err := allocUID()
	if err != nil {
		return nil, err
	}

	timeLimit := limits.maxCPU * 2
	if interactive {
		timeLimit = limits.maxSession
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
		PidsLimit: &limits.maxThreads,
		Ulimits: []docker.ULimit{
			{Name: "core", Soft: 0, Hard: 0},
			{Name: "cpu", Soft: limits.maxCPU, Hard: limits.maxCPU},
			{Name: "data", Soft: mem, Hard: mem},
			{Name: "fsize", Soft: disk, Hard: disk},
			{Name: "memlock", Soft: 0, Hard: 0},
			{Name: "nofile", Soft: limits.maxFD, Hard: limits.maxFD},
			{Name: "nproc", Soft: limits.maxThreads, Hard: limits.maxThreads},
			//{Name: "stack", Soft: mem, Hard: mem},
		},
		Tmpfs: map[string]string{
			"/home/student": fmt.Sprintf("rw,exec,nosuid,nodev,size=%dk,uid=%d,gid=%d", disk/1024, uid, uid),
			"/tmp":          fmt.Sprintf("rw,exec,nosuid,nodev,size=%dk,uid=%d,gid=%d", disk/1024, uid, uid),
		},
		ReadonlyRootfs: true,
	}

	log.Printf("new container %s; action %s on %s (%s); params cpu=%d, fd=%d, file=%d, mem=%d, threads=%d",
		name, action, problem.Unique, problemType.Name,
		limits.maxCPU, limits.maxFD, limits.maxFileSize, limits.maxMemory, limits.maxThreads)
	container, err := dockerClient.CreateContainer(docker.CreateContainerOptions{
		Name:       name,
		Config:     config,
		HostConfig: hostConfig,
	})
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
		Closed:     false,
		Files:      nil,
	}, nil
}

func (n *Nanny) Shutdown(msg string) error {
	if n.Closed {
		return nil
	}
	n.Closed = true

	// shut down the container
	//log.Printf("shutting down %s: %s", n.Name, msg)
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
func (n *Nanny) PutFiles(files map[string][]byte, mode int64) error {
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
	exec, err := dockerClient.CreateExec(docker.CreateExecOptions{
		AttachStdin:  true,
		AttachStdout: true,
		AttachStderr: true,
		Tty:          false,
		Cmd:          []string{"/bin/tar", "xf", "-", "-C", "/home/student"},
		Container:    n.Container.ID,
		User:         uidgid(n.UID),
	})
	if err != nil {
		log.Printf("creating tar command to upload files: %v", err)
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
		log.Printf("running tar command to upload files: %v", err)
		return err
	}
	if out.Len() != 0 {
		log.Printf("tar output: %q", out.String())
		return fmt.Errorf("tar gave non-empty output when extracting files into container")
	}

	return nil
}

// GetFiles copies a set of files from the given container.
// All student files are copied from the container on the first call to GetFiles.
// Subsequent calls will just gather files from the collection.
// The container must be running or the files must have already been fetched
// by a previous call to GetFiles.
func (n *Nanny) GetFiles(filenames []string) (map[string][]byte, error) {
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

		// exec tar in the container
		exec, err := dockerClient.CreateExec(docker.CreateExecOptions{
			AttachStdin:  false,
			AttachStdout: true,
			AttachStderr: true,
			Tty:          false,
			Cmd:          []string{"/bin/tar", "cf", "-", "-C", "/home/student", "."},
			Container:    n.Container.ID,
			User:         uidgid(n.UID),
		})
		if err != nil {
			log.Printf("createing tar command to download files: %v", err)
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
			log.Printf("running tar command to download files: %v", err)
			return nil, err
		}
		if tarErr.Len() != 0 {
			log.Printf("tar gave non-empty error output when gathering files from container: %q", tarErr.String())
			return nil, err
		}

		// extract the files
		n.Files = make(map[string][]byte)
		reader := tar.NewReader(bytes.NewReader(tarFile.Bytes()))
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
	n, err = out.script.Write(data)
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
