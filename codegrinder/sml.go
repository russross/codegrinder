package main

import (
	"io"
	"log"
)

func init() {
	problemTypeHandlers["standardmlunittest"] = map[string]nannyHandler{
		"grade": nannyHandler(standardMLGrade),
		"test":  nannyHandler(standardMLTest),
		"run":   nannyHandler(standardMLRun),
		"shell": nannyHandler(standardMLShell),
	}
}

func standardMLGrade(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("standard ML grade")
	runAndParseXUnit(n, []string{"make", "grade"}, nil, "test_detail.xml")
}

func standardMLTest(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("standard ML test")
	n.ExecSimple([]string{"make", "test"}, stdin, true)
}

func standardMLRun(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("standard ML run")
	n.ExecSimple([]string{"make", "run"}, stdin, true)
}

func standardMLShell(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("standard ML shell")
	n.ExecSimple([]string{"make", "shell"}, stdin, true)
}
