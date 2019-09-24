package main

import (
	"io"
	"log"
)

func init() {
	problemTypeHandlers["standardmlunittest"] = map[string]nannyHandler{
		"grade": nannyHandler(standardMLUnittestGrade),
		"test":  nannyHandler(standardMLTest),
		"run":   nannyHandler(standardMLRun),
		"shell": nannyHandler(standardMLShell),
	}
	problemTypeHandlers["standardmlinout"] = map[string]nannyHandler{
		"grade": nannyHandler(standardMLInOutGrade),
		"test":  nannyHandler(standardMLTest),
		"run":   nannyHandler(standardMLRun),
		"step":  nannyHandler(standardMLStep),
		"shell": nannyHandler(standardMLShell),
	}
}

func standardMLUnittestGrade(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("standard ML unittest grade")
	runAndParseXUnit(n, []string{"make", "grade"}, nil, "test_detail.xml")
}

func standardMLInOutGrade(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("standard ML inout grade")
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

func standardMLStep(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("standard ML step")
	n.ExecSimple([]string{"make", "step"}, stdin, true)
}

func standardMLShell(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("standard ML shell")
	n.ExecSimple([]string{"make", "shell"}, stdin, true)
}
