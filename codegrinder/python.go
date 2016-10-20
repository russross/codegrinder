package main

import (
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
		"debug":      nannyHandler(python34UnittestDebug),
		"run":        nannyHandler(python34UnittestRun),
		"shell":      nannyHandler(python34UnittestShell),
		"stylecheck": nannyHandler(python34UnittestStyleCheck),
		"stylefix":   nannyHandler(python34UnittestStyleFix),
	}
}

func python34UnittestGrade(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("python3.4 unittest grade")
	runAndParseXUnit(n, []string{"make", "grade"}, nil, "test_detail.xml")
}

func python34UnittestTest(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("python3.4 unittest test")
	n.ExecSimple([]string{"make", "test"}, stdin, true)
}

func python34UnittestDebug(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("python3.4 unittest debug")
	n.ExecSimple([]string{"make", "debug"}, stdin, true)
}

func python34UnittestRun(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("python3.4 unittest run")
	n.ExecSimple([]string{"make", "run"}, stdin, true)
}

func python34UnittestShell(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("python3.4 unittest shell")
	n.ExecSimple([]string{"make", "shell"}, stdin, true)
}

func python34UnittestStyleCheck(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("python3.4 unittest stylecheck")
	n.ExecSimple([]string{"make", "stylecheck"}, stdin, true)
}

func python34UnittestStyleFix(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("python3.4 unittest stylefix")
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
	log.Printf("found %d source file(s)", len(sources))
	after, err := n.GetFiles(sources)
	if err != nil {
		log.Printf("error trying to download files from container: %v", err)
		return
	}
	log.Printf("downloaded %d after file(s)", len(after))
	changed := make(map[string]string)
	for name, contents := range after {
		if files[name] != contents {
			changed[name] = contents
		}
	}
	log.Printf("found %d changed file(s)", len(changed))
	if len(changed) > 0 {
		n.Events <- &EventMessage{Event: "files", Files: changed}
	}
}
