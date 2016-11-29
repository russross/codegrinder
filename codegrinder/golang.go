package main

import (
	"io"
	"log"
)

func init() {
	problemTypeHandlers["gounittest"] = map[string]nannyHandler{
		"grade": nannyHandler(goGrade),
		"test":  nannyHandler(goTest),
		"run":   nannyHandler(goRun),
	}
}

func goGrade(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("go grade")
	runAndParseXUnit(n, []string{"make", "grade"}, nil, "test_detail.xml")
}

func goTest(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("go test")
	n.ExecSimple([]string{"make", "test"}, stdin, true)
}

func goRun(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("go run")
	n.ExecSimple([]string{"make", "run"}, stdin, true)
}
