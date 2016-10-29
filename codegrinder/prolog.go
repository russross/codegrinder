package main

import (
	"io"
	"log"
)

func init() {
	problemTypeHandlers["prologunittest"] = map[string]nannyHandler{
		"grade": nannyHandler(prologGrade),
		"test":  nannyHandler(prologTest),
		"run":   nannyHandler(prologRun),
		"shell": nannyHandler(prologShell),
	}
}

func prologGrade(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("prolog grade")
	runAndParseXUnit(n, []string{"make", "grade"}, nil, "test_detail.xml")
}

func prologTest(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("prolog test")
	n.ExecSimple([]string{"make", "test"}, nil, false)
}

func prologRun(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("prolog run")
	n.ExecSimple([]string{"make", "run"}, stdin, true)
}

func prologShell(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("prolog shell")
	n.ExecSimple([]string{"swipl"}, stdin, true)
}
