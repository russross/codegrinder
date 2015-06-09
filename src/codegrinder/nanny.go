package main

import (
	"archive/tar"
	"bytes"
	"fmt"
	"io"
	"time"

	"github.com/fsouza/go-dockerclient"
)

var dockerClient *docker.Client

type Nanny struct {
	Start      time.Time
	Container  *docker.Container
	ReportCard *ReportCard
	Input      chan string
	Events     chan *EventMessage
	Transcript []*EventMessage
}

func NewNanny(image, name string) (*Nanny, error) {
	// create a container
	container, err := dockerClient.CreateContainer(docker.CreateContainerOptions{
		Name: name,
		Config: &docker.Config{
			NetworkDisabled: true,
			Cmd: []string{
				"/bin/sh",
				"-c",
				"sleep infinity",
			},
			Image: image,
		},
	})
	if err != nil {
		logi.Printf("NewNanny->CreateContainer: %v", err)
		return nil, err
	}

	// start it
	err = dockerClient.StartContainer(container.ID, nil)
	if err != nil {
		logi.Printf("NewNanny->StartContainer: %v", err)
		return nil, err
	}

	return &Nanny{
		Start:      time.Now(),
		Container:  container,
		ReportCard: new(ReportCard),
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
		logi.Printf("Nanny.Shutdown: %v", err)
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
			loge.Printf("PutFiles: writing tar header: %v", err)
			return err
		}
		if _, err := writer.Write([]byte(contents)); err != nil {
			loge.Printf("PutFiles: writing to tar file: %v", err)
			return err
		}
	}
	if err := writer.Close(); err != nil {
		loge.Printf("PutFiles: closing tar file: %v", err)
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
		loge.Printf("PutFiles: creating exec command: %v", err)
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
		loge.Printf("PutFiles: starting exec command: %v", err)
		return err
	}

	if out.Len() != 0 {
		loge.Printf("PutFiles: tar output: %q", out.String())
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
		loge.Printf("GetFiles: creating exec command: %v", err)
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
		loge.Printf("GetFiles: starting exec command: %v", err)
		return nil, err
	}

	if tarErr.Len() != 0 {
		loge.Printf("GetFiles: tar error output: %q", tarErr.String())
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
			loge.Printf("GetFiles: reading tar file header: %v", err)
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
			loge.Printf("GetFiles: reading tar file contents: %v", err)
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
		loge.Printf("execStdout.Write: error writing to stdout buffer: %v", err)
		return n, err
	}
	n, err = out.script.Write(data)
	if err != nil || n != len(data) {
		loge.Printf("execStdout.Write: error writing to script buffer: %v", err)
		return n, err
	}

	out.events <- &EventMessage{
		When:       time.Now(),
		Event:      "stdout",
		StreamData: string(data),
	}

	return n, err
}

type execStderr execOutput

func (out *execStderr) Write(data []byte) (n int, err error) {
	n, err = out.stderr.Write(data)
	if err != nil || n != len(data) {
		loge.Printf("execStderr.Write: error writing to stderr buffer: %v", err)
		return n, err
	}
	n, err = out.script.Write(data)
	if err != nil || n != len(data) {
		loge.Printf("execStderr.Write: error writing to script buffer: %v", err)
		return n, err
	}

	out.events <- &EventMessage{
		When:       time.Now(),
		Event:      "stderr",
		StreamData: string(data),
	}

	return n, err
}

func (n *Nanny) ExecNonInteractive(cmd []string) (stdout, stderr, script *bytes.Buffer, status int, err error) {
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
		loge.Printf("Nanny.ExecNonInteractive->docker.CreateExec: %v", err)
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
		loge.Printf("Nanny.ExecNonInteractive->docker.StartExec: %v", err)
		return nil, nil, nil, -1, err
	}

	// inspect
	inspect, err := dockerClient.InspectExec(exec.ID)
	if err != nil {
		loge.Printf("Nanny.ExecNonInteractive->docker.InspectExec: %v", err)
		return nil, nil, nil, -1, err
	}
	if inspect.Running {
		loge.Printf("Nanny.ExecNonInteractive: process still running")
	}
	return &out.stdout, &out.stderr, &out.script, inspect.ExitCode, nil
}
