package main

import (
	"encoding/xml"
	"fmt"
	"io"
	"regexp"
	"time"
)

// XUnit types
type XUnitProgram struct {
	XMLName  xml.Name      `xml:"testsuites"`
	Name     string        `xml:"name,attr"`
	Tests    int           `xml:"tests,attr"`
	Failures int           `xml:"failures,attr"`
	Disabled int           `xml:"disabled,attr"`
	Errors   int           `xml:"errors,attr"`
	Time     float64       `xml:"time,attr"`
	Suites   []*XUnitSuite `xml:"testsuite"`
}

type XUnitSuite struct {
	Name     string       `xml:"name,attr"`
	Tests    int          `xml:"tests,attr"`
	Failures int          `xml:"failures,attr"`
	Disabled int          `xml:"disabled,attr"`
	Skipped  int          `xml:"skipped,attr"`
	Errors   int          `xml:"errors,attr"`
	Time     float64      `xml:"time,attr"`
	Cases    []*XUnitCase `xml:"testcase"`
}

type XUnitCase struct {
	Name      string         `xml:"name,attr"`
	Status    string         `xml:"status,attr"`
	Time      float64        `xml:"time,attr"`
	ClassName string         `xml:"classname,attr"`
	Failure   *XUnitFailure  `xml:"failure"`
	Error     *XUnitError    `xml:"error"`
	Disabled  *XUnitDisabled `xml:"disabled"`
}

type XUnitFailure struct {
	Message string `xml:"message,attr"`
	Type    string `xml:"type,attr"`
	Body    string `xml:",chardata"`
}

type XUnitError struct {
	Message string `xml:"message,attr"`
	Type    string `xml:"type,attr"`
	Body    string `xml:",chardata"`
}

type XUnitDisabled struct {
	Message string `xml:"message,attr"`
	Type    string `xml:"type,attr"`
	Body    string `xml:",chardata"`
}

func runAndParseXUnit(n *Nanny, cmd []string, stdin io.Reader, filename string) {
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

	parseXUnit(n, xmlfiles[filename])
}

var testFailureContextGTest = regexp.MustCompile(`^(tests/[^:/]*:\d+)`)
var testFailureContextPython = regexp.MustCompile(`File "[^"]*/([^/]+)", line (\d+)`)

func parseXUnit(n *Nanny, contents []byte) {
	results := new(XUnitProgram)
	if err := xml.Unmarshal(contents, results); err != nil {
		n.ReportCard.LogAndFailf("error parsing unit test results: %v", err)
		return
	}

	// form a report card
	fails := results.Failures + results.Disabled + results.Errors
	n.ReportCard.Note = fmt.Sprintf("Passed %d/%d tests in %v",
		results.Tests-fails, results.Tests, time.Since(n.Start))
	n.ReportCard.Passed = n.ReportCard.Passed && results.Tests > 0 && fails == 0

	// prepare a report for each test case
	for _, suite := range results.Suites {
		for _, testCase := range suite.Cases {
			name := testCase.Name
			if testCase.ClassName != "" {
				name = fmt.Sprintf("%s -> %s", testCase.ClassName, testCase.Name)
			}
			if (testCase.Status == "run" || testCase.Status == "") &&
				testCase.Failure == nil &&
				testCase.Error == nil &&
				testCase.Disabled == nil {
				n.ReportCard.AddPassedResult(name, "")
			} else {
				body := ""
				if testCase.Failure != nil {
					body = testCase.Failure.Body
				} else if testCase.Error != nil {
					body = testCase.Error.Body
				} else if testCase.Disabled != nil {
					body = testCase.Disabled.Body
				}

				// try to parse context
				ctx := ""
				if groups := testFailureContextGTest.FindStringSubmatch(body); len(groups) > 1 {
					ctx = groups[1]
				} else if groups := testFailureContextPython.FindStringSubmatch(body); len(groups) > 1 {
					ctx = groups[1] + ":" + groups[2]
				}
				n.ReportCard.AddFailedResult(name, body, ctx)
			}
		}
	}
}
