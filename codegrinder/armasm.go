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
	problemTypeHandlers["armv8asm"] = map[string]nannyHandler{
		"grade":    nannyHandler(arm64AsGrade),
		"test":     nannyHandler(arm64AsTest),
		"valgrind": nannyHandler(arm64AsValgrind),
		"debug":    nannyHandler(arm64AsDebug),
		"run":      nannyHandler(arm64AsRun),
	}
	problemTypeHandlers["arm64inout"] = map[string]nannyHandler{
		"grade":    nannyHandler(arm64AsGrade),
		"test":     nannyHandler(arm64AsTest),
		"valgrind": nannyHandler(arm64AsValgrind),
		"debug":    nannyHandler(arm64AsDebug),
		"run":      nannyHandler(arm64AsRun),
		"step":     nannyHandler(arm64AsStep),
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

func arm64AsGrade(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("arm64 grade")
	runAndParseCheckXML(n, []string{"make", "grade"}, nil, "test_results.xml")
}

func arm64AsTest(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("arm64 test")
	n.ExecSimple([]string{"make", "test"}, stdin, true)
}

func arm64AsValgrind(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("arm64 valgrind")
	n.ExecSimple([]string{"make", "valgrind"}, stdin, true)
}

func arm64AsDebug(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("arm64 debug")
	n.ExecSimple([]string{"make", "debug"}, stdin, true)
}

func arm64AsRun(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("arm64 run")
	n.ExecSimple([]string{"make", "run"}, stdin, true)
}

func arm64AsStep(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("arm64 step")
	n.ExecSimple([]string{"make", "step"}, stdin, true)
}
