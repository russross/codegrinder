package main

import (
	"bytes"
	"io"
	"log"
	"path/filepath"
	"strings"

	. "github.com/russross/codegrinder/common"
)

func init() {
	problemTypeHandlers["python34unittest"] = map[string]nannyHandler{
		"grade":      nannyHandler(python34UnittestGrade),
		"test":       nannyHandler(python34UnittestTest),
		"debug":      nannyHandler(python34Debug),
		"run":        nannyHandler(python34Run),
		"shell":      nannyHandler(python34Shell),
		"stylecheck": nannyHandler(python34StyleCheck),
		"stylefix":   nannyHandler(python34StyleFix),
	}
	problemTypeHandlers["python34inout"] = map[string]nannyHandler{
		"grade":      nannyHandler(python34InOutGrade),
		"test":       nannyHandler(python34InOutTest),
		"debug":      nannyHandler(python34Debug),
		"run":        nannyHandler(python34Run),
		"shell":      nannyHandler(python34Shell),
		"stylecheck": nannyHandler(python34StyleCheck),
		"stylefix":   nannyHandler(python34StyleFix),
	}
}

func python34UnittestGrade(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("python3.4 unittest grade")
	runAndParseXUnit(n, []string{"make", "grade"}, nil, "test_detail.xml")
}

func python34InOutGrade(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("python3.4 inout grade")
	runAndParseXUnit(n, []string{"make", "grade"}, nil, "test_detail.xml")
}

func python34UnittestTest(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("python3.4 unittest test")
	n.ExecSimple([]string{"make", "test"}, stdin, true)
}

func python34InOutTest(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("python3.4 inout test")
	n.ExecSimple([]string{"make", "test"}, stdin, true)
}

func python34Debug(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("python3.4 debug")
	n.ExecSimple([]string{"make", "debug"}, stdin, true)
}

func python34Run(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("python3.4 run")
	n.ExecSimple([]string{"make", "run"}, stdin, true)
}

func python34Shell(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("python3.4 shell")
	n.ExecSimple([]string{"make", "shell"}, stdin, true)
}

func python34StyleCheck(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("python3.4 stylecheck")
	n.ExecSimple([]string{"make", "stylecheck"}, stdin, true)
}

func python34StyleFix(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("python3.4 stylefix")
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
