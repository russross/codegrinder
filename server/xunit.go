package main

import (
	"encoding/xml"
	"fmt"
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
	Skipped  int           `xml:"skipped,attr"`
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
	Skipped   *XUnitSkipped  `xml:"skipped"`
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

type XUnitSkipped struct {
	Message string `xml:"message,attr"`
	Type    string `xml:"type,attr"`
	Body    string `xml:",chardata"`
}

func runAndParseXUnit(n *Nanny, cmd []string) {
	filename := "test_detail.xml"

	// run tests with XML output
	_, _, _, status, err := n.Exec(cmd, nil, false)
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
		n.ReportCard.LogAndFailf("Error getting unit test results")
		return
	}

	parseXUnit(n, xmlfiles[filename])
}

var testFailureContextGTest = regexp.MustCompile(`^(tests/[^:/]*:\d+)`)
var testFailureContextPython = regexp.MustCompile(`File "[^"]*/([^/]+)", line (\d+)`)

func parseXUnit(n *Nanny, contents []byte) {
	if len(contents) == 0 {
		n.ReportCard.LogAndFailf("No unit test results found")
		return
	}

	results := new(XUnitProgram)
	if err := xml.Unmarshal(contents, results); err != nil {
		// try parsing as a list of testsuite into the outer container
		results.Suites = nil
		err := xml.Unmarshal(contents, &results.Suites)
		if err != nil {
			n.ReportCard.LogAndFailf("error parsing unit test results: %v", err)
			return
		}
	}

	// build summary results
	results.Tests = 0
	results.Failures = 0
	results.Disabled = 0
	results.Skipped = 0
	results.Errors = 0
	results.Time = 0

	for _, elt := range results.Suites {
		results.Tests += elt.Tests
		results.Failures += elt.Failures
		results.Disabled += elt.Disabled
		results.Skipped += elt.Skipped
		results.Errors += elt.Errors
		results.Time += elt.Time
	}

	// form a report card
	fails := results.Failures + results.Disabled + results.Skipped + results.Errors
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
				testCase.Disabled == nil &&
				testCase.Skipped == nil {
				n.ReportCard.AddPassedResult(name, "")
			} else {
				body := ""
				if testCase.Failure != nil {
					body = testCase.Failure.Body
				} else if testCase.Error != nil {
					body = testCase.Error.Body
				} else if testCase.Disabled != nil {
					body = testCase.Disabled.Body
				} else if testCase.Skipped != nil {
					body = testCase.Skipped.Body
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

// check XML types
type CheckXMLProgram struct {
	XMLName   xml.Name         `xml:"testsuites"`
	NameSpace string           `xml:"xmlns,attr"`
	DateTime  string           `xml:"datetime"`
	Duration  float64          `xml:"duration"`
	Suites    []*CheckXMLSuite `xml:"suite"`
}

type CheckXMLSuite struct {
	Title string          `xml:"title"`
	Tests []*CheckXMLTest `xml:"test"`
}

type CheckXMLTest struct {
	Result      string  `xml:"result,attr"`
	Path        string  `xml:"path"`
	Function    string  `xml:"fn"`
	ID          string  `xml:"id"`
	Iteration   int     `xml:"iteration"`
	Duration    float64 `xml:"duration"`
	Description string  `xml:"description"`
	Message     string  `xml:"message"`
}

func runAndParseCheckXML(n *Nanny, cmd []string) {
	filename := "test_detail.xml"

	// run tests with XML output
	_, _, _, status, err := n.Exec(cmd, nil, false)
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
		n.ReportCard.LogAndFailf("Error getting unit test results")
		return
	}

	parseCheckXML(n, xmlfiles[filename])
}

func parseCheckXML(n *Nanny, contents []byte) {
	if len(contents) == 0 {
		n.ReportCard.LogAndFailf("No unit test results found")
		return
	}

	results := new(CheckXMLProgram)
	if err := xml.Unmarshal(contents, results); err != nil {
		n.ReportCard.LogAndFailf("error parsing unit test results: %v", err)
		return
	}

	successes, failures, errors := 0, 0, 0
	for _, suite := range results.Suites {
		for _, test := range suite.Tests {
			switch test.Result {
			case "success":
				successes++
				n.ReportCard.AddPassedResult(test.ID, test.Message)
			case "failure":
				failures++
				n.ReportCard.AddFailedResult(test.ID, test.Message, test.Function)
			case "error":
				errors++
				n.ReportCard.AddFailedResult(test.ID, test.Message, test.Function)
			default:
				errors++
				n.ReportCard.AddFailedResult(test.ID, test.Message, test.Function)
			}
		}
	}

	// form a report card
	n.ReportCard.Passed = successes > 0 && failures == 0 && errors == 0
	if successes+failures+errors < 1 {
		n.ReportCard.Note = fmt.Sprintf("No test results found in %v", time.Since(n.Start))
	} else {
		n.ReportCard.Note = fmt.Sprintf("Passed %d/%d tests in %v", successes, successes+failures+errors, time.Since(n.Start))
	}
}
