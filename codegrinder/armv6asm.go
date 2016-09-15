package main

import (
	"encoding/xml"
	"fmt"
	"io"
	"log"
	"path/filepath"
	"regexp"
	"time"
)

func init() {
	problemTypeHandlers["armv6asm"] = map[string]nannyHandler{
		"grade": nannyHandler(asGTestGrade),
		"debug": nannyHandler(asGdb),
		"run":   nannyHandler(asRun),
	}
}

// Google test framework types
type GTestProgram struct {
	XMLName  xml.Name     `xml:"testsuites"`
	Name     string       `xml:"name,attr"`
	Tests    int          `xml:"tests,attr"`
	Failures int          `xml:"failures,attr"`
	Disabled int          `xml:"disabled,attr"`
	Errors   int          `xml:"errors,attr"`
	Time     float64      `xml:"time,attr"`
	Cases    []*GTestCase `xml:"testsuite"`
}

type GTestCase struct {
	Name      string           `xml:"name,attr"`
	Tests     int              `xml:"tests,attr"`
	Failures  int              `xml:"failures,attr"`
	Disabled  int              `xml:"disabled,attr"`
	Errors    int              `xml:"errors,attr"`
	Time      float64          `xml:"time,attr"`
	Functions []*GTestFunction `xml:"testcase"`
}

type GTestFunction struct {
	Name      string        `xml:"name,attr"`
	Status    string        `xml:"status,attr"`
	Time      float64       `xml:"time,attr"`
	ClassName string        `xml:"classname,attr"`
	Failure   *GTestFailure `xml:"failure"`
}

type GTestFailure struct {
	Message string `xml:"message,attr"`
	Type    string `xml:"type,attr"`
	Body    string `xml:",chardata"`
}

func asGTestGrade(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("arm as gTest grade")

	// asCompileAndLink(n, files)
	// if !n.ReportCard.Passed {
	// 	return
	// }

	// parse the output (in common with c++)
	// parseXUnit(n, []string{"./a.out", "--gtest_output=xml"}, nil, "test_detail.xml")
	parseXUnit(n, []string{"make grade"}, nil, "test_detail.xml")
}

func asCompileAndLink(n *Nanny, files map[string]string) {
	// gather list of *.s files and tests/*.cpp files
	var sourceFiles, testFiles []string
	for path := range files {
		dir, file := filepath.Split(path)
		if dir == "" && filepath.Ext(file) == ".s" {
			sourceFiles = append(sourceFiles, path)
		}
		if dir == "tests/" && filepath.Ext(file) == ".cpp" {
			testFiles = append(testFiles, path)
		}
	}
	if len(sourceFiles) == 0 {
		n.ReportCard.LogAndFailf("no source files found")
		return
	}
	if len(testFiles) == 0 {
		n.ReportCard.LogAndFailf("no test files found")
		return
	}

	// assemble source files
	objectFiles := []string{}
	for _, src := range sourceFiles {
		out := src[:len(src)-len(".s")] + ".o"
		objectFiles = append(objectFiles, out)
		cmd := []string{"as", "-g", "-march=armv6zk", "-mcpu=arm1176jzf-s", "-mfloat-abi=hard", "-mfpu=vfp", src, "-o", out}

		// launch the assembler (ignore stdin)
		if err := n.ExecSimple(cmd, nil, false); err != nil {
			return
		}
	}

	// compile tests and link
	cmd := []string{"g++", "-std=c++11", "-Wpedantic", "-g", "-Wall", "-Wextra", "-Werror", "-I.", "-pthread"}
	cmd = append(cmd, objectFiles...)
	cmd = append(cmd, testFiles...)
	cmd = append(cmd, "-lgtest", "-lregwrapper", "-lpthread")
	if err := n.ExecSimple(cmd, nil, false); err != nil {
		return
	}

	return
}

func parseXUnit(n *Nanny, cmd []string, stdin io.Reader, filename string) {
	// run tests with XML output
	_, _, _, status, err := n.Exec(cmd, stdin, false)
	if err != nil {
		n.ReportCard.LogAndFailf("Error running unit tests: %v", err)
		return
	}

	// did it end in a segfault?
	if status > 127 {
		n.ReportCard.LogAndFailf("Unit tests did not finish normally, exit status %d", status)
		return
	}
	n.ReportCard.Passed = status == 0

	// parse the test results
	xmlfiles, err := n.GetFiles([]string{filename})
	if err != nil {
		n.ReportCard.LogAndFailf("Unit test failed: unable to read results")
		return
	}
	results := new(GTestProgram)
	if err = xml.Unmarshal([]byte(xmlfiles[filename]), results); err != nil {
		n.ReportCard.LogAndFailf("error parsing unit test results: %v", err)
		return
	}

	// form a report card
	fails := results.Failures + results.Disabled + results.Errors
	n.ReportCard.Note = fmt.Sprintf("Passed %d/%d tests in %v",
		results.Tests-fails, results.Tests, time.Since(n.Start))
	n.ReportCard.Passed = n.ReportCard.Passed && results.Tests > 0 && fails == 0 && status == 0

	context := regexp.MustCompile(`^(tests/[^:/]*:\d+)`)

	// prepare a report for each test case
	for _, testcase := range results.Cases {
		for _, test := range testcase.Functions {
			name := fmt.Sprintf("%s -> %s", test.ClassName, test.Name)
			if test.Status == "run" && test.Failure == nil {
				n.ReportCard.AddPassedResult(name, "")
			} else {
				details, ctx := "", ""
				if test.Failure != nil {
					details = htmlEscapePre(test.Failure.Body)

					// extract context
					groups := context.FindStringSubmatch(test.Failure.Body)
					if len(groups) > 1 {
						ctx = groups[1]
					}
				}
				n.ReportCard.AddFailedResult(name, details, ctx)
			}
		}
	}
}

func asRun(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("arm run")

	// gather list of *.s files
	var sourceFiles []string
	for path := range files {
		dir, file := filepath.Split(path)
		if dir == "" && filepath.Ext(file) == ".s" {
			sourceFiles = append(sourceFiles, path)
		}
	}
	if len(sourceFiles) == 0 {
		n.ReportCard.LogAndFailf("no source files found")
		return
	}

	// assemble source files
	objectFiles := []string{}
	for _, src := range sourceFiles {
		out := src[:len(src)-len(".s")] + ".o"
		objectFiles = append(objectFiles, out)
		cmd := []string{"as", "-g", "-march=armv6zk", "-mcpu=arm1176jzf-s", "-mfloat-abi=hard", "-mfpu=vfp", src, "-o", out}

		// launch the assembler (ignore stdin)
		if err := n.ExecSimple(cmd, nil, false); err != nil {
			return
		}
	}

	// link
	cmd := []string{"ld"}
	cmd = append(cmd, objectFiles...)
	if err := n.ExecSimple(cmd, nil, false); err != nil {
		return
	}

	// run gdb
	n.ExecSimple([]string{"./a.out"}, stdin, true)
}

func asGdb(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("arm as gdb")

	// gather list of *.s files
	var sourceFiles []string
	for path := range files {
		dir, file := filepath.Split(path)
		if dir == "" && filepath.Ext(file) == ".s" {
			sourceFiles = append(sourceFiles, path)
		}
	}
	if len(sourceFiles) == 0 {
		n.ReportCard.LogAndFailf("no source files found")
		return
	}

	// assemble source files
	objectFiles := []string{}
	for _, src := range sourceFiles {
		out := src[:len(src)-len(".s")] + ".o"
		objectFiles = append(objectFiles, out)
		cmd := []string{"as", "-g", "-march=armv6zk", "-mcpu=arm1176jzf-s", "-mfloat-abi=hard", "-mfpu=vfp", src, "-o", out}

		// launch the assembler (ignore stdin)
		if err := n.ExecSimple(cmd, nil, false); err != nil {
			return
		}
	}

	// link
	cmd := []string{"ld"}
	cmd = append(cmd, objectFiles...)
	if err := n.ExecSimple(cmd, nil, false); err != nil {
		return
	}

	// run gdb
	n.ExecSimple([]string{"gdb", "a.out"}, stdin, true)
}
