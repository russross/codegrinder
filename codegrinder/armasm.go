package main

import (
	"io"
	"log"
)

func init() {
	problemTypeHandlers["armv6asm"] = map[string]nannyHandler{
		"grade":    nannyHandler(armGrade),
		"test":     nannyHandler(armTest),
		"valgrind": nannyHandler(armValgrind),
		"debug":    nannyHandler(armDebug),
		"run":      nannyHandler(armRun),
	}
	problemTypeHandlers["armv8asm"] = map[string]nannyHandler{
		"grade":    nannyHandler(armGrade),
		"test":     nannyHandler(armTest),
		"valgrind": nannyHandler(armValgrind),
		"debug":    nannyHandler(armDebug),
		"run":      nannyHandler(armRun),
	}
	problemTypeHandlers["arm64inout"] = map[string]nannyHandler{
		"grade":    nannyHandler(armGrade),
		"test":     nannyHandler(armTest),
		"valgrind": nannyHandler(armValgrind),
		"debug":    nannyHandler(armDebug),
		"run":      nannyHandler(armRun),
		"step":     nannyHandler(armStep),
	}
}

func arm32Grade(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("arm grade")
	runAndParseXUnit(n, []string{"make", "grade"}, nil, "test_detail.xml")
}

func arm64Grade(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("arm grade")
	runAndParseXUnit(n, []string{"make", "grade"}, nil, "test_results.xml")
}

func armTest(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("arm test")
	n.ExecSimple([]string{"make", "test"}, stdin, true)
}

func armValgrind(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("arm valgrind")
	n.ExecSimple([]string{"make", "valgrind"}, stdin, true)
}

func armDebug(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("arm debug")
	n.ExecSimple([]string{"make", "debug"}, stdin, true)
}

func armRun(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("arm run")
	n.ExecSimple([]string{"make", "run"}, stdin, true)
}

func armStep(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("arm step")
	n.ExecSimple([]string{"make", "step"}, stdin, true)
}
