package main

import (
	"io"
	"log"
)

func init() {
	problemTypeHandlers["cppunittest"] = map[string]nannyHandler{
		"grade":    nannyHandler(cppUnittestGrade),
		"test":     nannyHandler(cppUnittestTest),
		"valgrind": nannyHandler(cppUnittestValgrind),
		"debug":    nannyHandler(cppDebug),
		"run":      nannyHandler(cppRun),
	}
}

func cppUnittestGrade(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("cpp unittest grade")
	runAndParseXUnit(n, []string{"make", "grade"}, nil, "test_detail.xml")
}

func cppUnittestTest(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("cpp unittest test")
	n.ExecSimple([]string{"make", "test"}, stdin, true)
}

func cppUnittestValgrind(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("cpp unittest valgrind")
	n.ExecSimple([]string{"make", "valgrind"}, stdin, true)
}

func cppDebug(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("cpp debug")
	n.ExecSimple([]string{"make", "debug"}, stdin, true)
}

func cppRun(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("cpp run")
	n.ExecSimple([]string{"make", "run"}, stdin, true)
}
