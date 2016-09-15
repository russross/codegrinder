package main

import (
	"io"
	"log"
)

func init() {
	problemTypeHandlers["standardmlunittest"] = map[string]nannyHandler{
		"grade": nannyHandler(standardMLGrade),
		"run":   nannyHandler(standardMLRun),
		"shell": nannyHandler(standardMLShell),
	}
}

func standardMLGrade(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("standard ML grade")
	runAndParseXUnit(n, []string{"make", "grade"}, nil, "test_detail.xml")
}

func standardMLRun(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("standard ML run")
	n.ExecSimple([]string{"make", "run"}, stdin, true)
}

func standardMLShell(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("standard ML shell")
	n.ExecSimple([]string{"ledit", "poly"}, stdin, true)
}
