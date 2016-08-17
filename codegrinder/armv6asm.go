package main

import (
	"encoding/xml"
	"fmt"
	"io"
	"log"
	"path/filepath"
	"regexp"
	"time"

	. "github.com/russross/codegrinder/types"
)

func init() {
	problemTypes["armv6asm"] = &ProblemType{
		Name:        "armv6asm",
		Image:       "codegrinder/armv6asm",
		MaxCPU:      60,
		MaxClock:    120,
		MaxFD:       100,
		MaxFileSize: 10,
		MaxMemory:   128,
		MaxThreads:  20,
		Actions: map[string]*ProblemTypeAction{
			"grade": &ProblemTypeAction{
				Action:  "grade",
				Button:  "Grade",
				Message: "Grading‥",
				Handler: nannyHandler(asGTestGrade),
			},
		},
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
	log.Printf("as gTest grade")

	// put the files in the container
	if err := n.PutFiles(files); err != nil {
		n.ReportCard.LogAndFailf("PutFiles error: %v", err)
		return
	}

	asCompileAndLink(n, files)
	if !n.ReportCard.Passed {
		return
	}

	// run a.out and parse the output (in common with c++)
	gTestAOutCommon(n, files, nil)
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

	// assemble source files
	objectFiles := []string{}
	for _, src := range sourceFiles {
		out := src[:len(src)-len(".s")] + ".o"
		objectFiles = append(objectFiles, out)
		cmd := []string{"as", "-g", "-march=armv6zk", "-mcpu=arm1176jzf-s", "-mfloat-abi=hard", "-mfpu=vfp", src, "-o", out}

		// launch the assembler (ignore stdin)
		_, _, _, status, err := n.ExecNonInteractive(cmd, nil)
		if err != nil {
			n.ReportCard.LogAndFailf("as exec error: %v", err)
			return
		}
		if status != 0 {
			n.ReportCard.LogAndFailf("as failed on %s with exit code %d", src, status)
			return
		}
	}

	// compile tests and link
	cmd := []string{"g++", "-std=c++11", "-Wpedantic", "-g", "-Wall", "-Wextra", "-Werror", "-I.", "-pthread"}
	cmd = append(cmd, objectFiles...)
	cmd = append(cmd, testFiles...)
	cmd = append(cmd, "-lgtest", "-lpthread")
	_, _, _, status, err := n.ExecNonInteractive(cmd, nil)
	if err != nil {
		n.ReportCard.LogAndFailf("g++ exec error: %v", err)
		return
	}
	if status != 0 {
		n.ReportCard.LogAndFailf("g++ failed with exit code %d", status)
		return
	}

	return
}

func gTestAOutCommon(n *Nanny, files map[string]string, stdin io.Reader) {
	// run a.out with XML output
	_, _, _, status, err := n.ExecNonInteractive([]string{"./a.out", "--gtest_output=xml"}, stdin)

	if err != nil {
		n.ReportCard.LogAndFailf("Error running unit tests: %v", err)
		return
	}

	// did it end in a segfault?
	if status > 127 {
		n.ReportCard.LogAndFailf("Unit tests did not finish normally, exit code %d", status)
		return
	}

	// parse the test results
	n.ReportCard.Passed = status == 0
	xmlfiles, err := n.GetFiles([]string{"test_detail.xml"})
	if err != nil {
		n.ReportCard.LogAndFailf("Unit test failed: unable to read results")
		return
	}
	results := new(GTestProgram)
	if err = xml.Unmarshal([]byte(xmlfiles["test_detail.xml"]), results); err != nil {
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
