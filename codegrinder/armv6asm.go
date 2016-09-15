package main

import (
	"encoding/xml"
	"fmt"
	"io"
	"log"
	"regexp"
	"time"
)

func init() {
	problemTypeHandlers["armv6asm"] = map[string]nannyHandler{
		"grade": nannyHandler(armAsGrade),
		"test":  nannyHandler(armAsTest),
		"debug": nannyHandler(armAsDebug),
		"run":   nannyHandler(armAsRun),
	}
}

func armAsGrade(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("arm as gTest grade")
	parseXUnit(n, []string{"make", "grade"}, nil, "test_detail.xml")
}

func armAsTest(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("arm as gTest test")
	n.ExecSimple([]string{"make", "test"}, stdin, true)
}

func armAsDebug(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("arm as gdb")
	n.ExecSimple([]string{"make", "debug"}, stdin, true)
}

func armAsRun(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("arm run")
	n.ExecSimple([]string{"make", "run"}, stdin, true)
}

// XUnit types
type XUnitProgram struct {
	XMLName  xml.Name     `xml:"testsuites"`
	Name     string       `xml:"name,attr"`
	Tests    int          `xml:"tests,attr"`
	Failures int          `xml:"failures,attr"`
	Disabled int          `xml:"disabled,attr"`
	Errors   int          `xml:"errors,attr"`
	Time     float64      `xml:"time,attr"`
	Cases    []*XUnitCase `xml:"testsuite"`
}

type XUnitCase struct {
	Name      string           `xml:"name,attr"`
	Tests     int              `xml:"tests,attr"`
	Failures  int              `xml:"failures,attr"`
	Disabled  int              `xml:"disabled,attr"`
	Errors    int              `xml:"errors,attr"`
	Time      float64          `xml:"time,attr"`
	Functions []*XUnitFunction `xml:"testcase"`
}

type XUnitFunction struct {
	Name      string        `xml:"name,attr"`
	Status    string        `xml:"status,attr"`
	Time      float64       `xml:"time,attr"`
	ClassName string        `xml:"classname,attr"`
	Failure   *XUnitFailure `xml:"failure"`
}

type XUnitFailure struct {
	Message string `xml:"message,attr"`
	Type    string `xml:"type,attr"`
	Body    string `xml:",chardata"`
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
		n.ReportCard.LogAndFailf("Crashed with exit status %d while running unit tests", status)
		return
	}
	n.ReportCard.Passed = status == 0

	// parse the test results
	xmlfiles, err := n.GetFiles([]string{filename})
	if err != nil {
		n.ReportCard.LogAndFailf("Unit test failed: unable to read results")
		return
	}
	results := new(XUnitProgram)
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
