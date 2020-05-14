package main

import (
	"bytes"
	"io"
	"log"
	"path/filepath"
	"strings"

	. "github.com/russross/codegrinder/types"
)

func init() {
	problemTypeHandlers["python3unittest"] = map[string]nannyHandler{
		"grade":      nannyHandler(python3UnittestGrade),
		"test":       nannyHandler(python3UnittestTest),
		"debug":      nannyHandler(python3Debug),
		"run":        nannyHandler(python3Run),
		"shell":      nannyHandler(python3Shell),
		"stylecheck": nannyHandler(python3StyleCheck),
		"stylefix":   nannyHandler(python3StyleFix),
	}
	problemTypeHandlers["python3inout"] = map[string]nannyHandler{
		"grade":      nannyHandler(python3InOutGrade),
		"test":       nannyHandler(python3InOutTest),
		"step":       nannyHandler(python3InOutStep),
		"debug":      nannyHandler(python3Debug),
		"run":        nannyHandler(python3Run),
		"shell":      nannyHandler(python3Shell),
		"stylecheck": nannyHandler(python3StyleCheck),
		"stylefix":   nannyHandler(python3StyleFix),
	}
}

func python3UnittestGrade(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("python 3 unittest grade")
	runAndParseXUnit(n, []string{"make", "grade"}, nil, "test_detail.xml")
}

func python3InOutGrade(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("python 3 inout grade")
	runAndParseXUnit(n, []string{"make", "grade"}, nil, "test_detail.xml")
}

func python3UnittestTest(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("python 3 unittest test")
	n.ExecSimple([]string{"make", "test"}, stdin, true)
}

func python3InOutTest(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("python 3 inout test")
	n.ExecSimple([]string{"make", "test"}, stdin, true)
}

func python3InOutStep(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("python 3 inout step")
	n.ExecSimple([]string{"make", "step"}, stdin, true)
}

func python3Debug(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("python 3 debug")
	n.ExecSimple([]string{"make", "debug"}, stdin, true)
}

func python3Run(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("python 3 run")
	n.ExecSimple([]string{"make", "run"}, stdin, true)
}

func python3Shell(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("python 3 shell")
	n.ExecSimple([]string{"make", "shell"}, stdin, true)
}

func python3StyleCheck(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("python 3 stylecheck")
	n.ExecSimple([]string{"make", "stylecheck"}, stdin, true)
}

func python3StyleFix(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("python 3 stylefix")
	if err := n.ExecSimple([]string{"make", "stylefix"}, stdin, true); err != nil {
		return
	}

	// find changed files and return them to the user
	var sources []string
	for name := range files {
		dir, _ := filepath.Split(name)
		if dir == "" && strings.HasSuffix(name, ".py") {
			sources = append(sources, name)
		}
	}
	if len(sources) == 0 {
		n.ReportCard.LogAndFailf("no source files found")
		return
	}
	after, err := n.GetFiles(sources)
	if err != nil {
		log.Printf("error trying to download files from container: %v", err)
		return
	}
	changed := make(map[string][]byte)
	for name, contents := range after {
		if !bytes.Equal(files[name], contents) {
			changed[name] = contents
		}
	}
	if len(changed) > 0 {
		n.Events <- &EventMessage{Event: "files", Files: changed}
	}
}
