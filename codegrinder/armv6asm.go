package main

import (
	"io"
	"log"
)

func init() {
	problemTypeHandlers["armv6asm"] = map[string]nannyHandler{
		"grade":    nannyHandler(armAsGrade),
		"test":     nannyHandler(armAsTest),
		"valgrind": nannyHandler(armAsValgrind),
		"debug":    nannyHandler(armAsDebug),
		"run":      nannyHandler(armAsRun),
	}
}

func armAsGrade(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("arm grade")
	runAndParseXUnit(n, []string{"make", "grade"}, nil, "test_detail.xml")
}

func armAsTest(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("arm test")
	n.ExecSimple([]string{"make", "test"}, stdin, true)
}

func armAsValgrind(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("arm valgrind")
	n.ExecSimple([]string{"make", "valgrind"}, stdin, true)
}

func armAsDebug(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("arm debug")
	n.ExecSimple([]string{"make", "debug"}, stdin, true)
}

func armAsRun(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("arm run")
	n.ExecSimple([]string{"make", "run"}, stdin, true)
}
