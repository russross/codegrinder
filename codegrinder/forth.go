package main

import (
	"io"
	"log"
)

func init() {
	problemTypeHandlers["forthinout"] = map[string]nannyHandler{
		"grade": nannyHandler(forthGrade),
		"test":  nannyHandler(forthTest),
		"run":   nannyHandler(forthRun),
		"step":  nannyHandler(forthStep),
		"shell": nannyHandler(forthShell),
	}
}

func forthGrade(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("forth inout grade")
	runAndParseXUnit(n, []string{"make", "grade"}, nil, "test_detail.xml")
}

func forthTest(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("forth test")
	n.ExecSimple([]string{"make", "test"}, stdin, true)
}

func forthRun(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("forth run")
	n.ExecSimple([]string{"make", "run"}, stdin, true)
}

func forthStep(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("forth step")
	n.ExecSimple([]string{"make", "step"}, stdin, true)
}

func forthShell(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("forth shell")
	n.ExecSimple([]string{"make", "shell"}, stdin, true)
}
