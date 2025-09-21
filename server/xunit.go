package main

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"regexp"
	"time"

	. "github.com/russross/codegrinder/types"
)

// =================================================================================
// XUnit XML Types
// =================================================================================

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
	Details string `xml:",chardata"`
}

type XUnitError struct {
	Message string `xml:"message,attr"`
	Type    string `xml:"type,attr"`
	Details string `xml:",chardata"`
}

type XUnitDisabled struct {
	Message string `xml:"message,attr"`
}

type XUnitSkipped struct {
	Message string `xml:"message,attr"`
}

// =================================================================================
// Check XML Types
// =================================================================================

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

// =================================================================================
// Regular Expressions for Context Extraction
// =================================================================================

var testFailureContextGTest = regexp.MustCompile(`^(tests/[^:/]*:\d+)`)
var testFailureContextPython = regexp.MustCompile(`File "[^"]*/([^/]+)", line (\d+)`)
var checkLineRE = regexp.MustCompile(`(PASS|FAIL|ERROR):\s*(.*)`)

// =================================================================================
// Parsing Functions
// =================================================================================

// parseXUnitResults parses XUnit XML output and populates a report card
func parseXUnitResults(reportCard *ReportCard, output io.Reader) {
	contents, err := io.ReadAll(output)
	if err != nil {
		reportCard.LogAndFailf("Error reading test output: %v", err)
		return
	}

	if len(contents) == 0 {
		reportCard.LogAndFailf("No unit test results found")
		return
	}

	results := new(XUnitProgram)
	if err := xml.Unmarshal(contents, results); err != nil {
		// try parsing as a list of testsuite into the outer container
		results.Suites = nil
		err := xml.Unmarshal(contents, &results.Suites)
		if err != nil {
			reportCard.LogAndFailf("error parsing unit test results: %v", err)
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
	reportCard.Note = fmt.Sprintf("Passed %d/%d tests", results.Tests-fails, results.Tests)
	reportCard.Passed = reportCard.Passed && results.Tests > 0 && fails == 0
	reportCard.Duration = time.Duration(results.Time * float64(time.Second))

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
				reportCard.AddPassedResult(name, "")
			} else {
				body := ""
				if testCase.Failure != nil {
					body = testCase.Failure.Details
				} else if testCase.Error != nil {
					body = testCase.Error.Details
				} else if testCase.Disabled != nil {
					body = "Test disabled"
				} else if testCase.Skipped != nil {
					body = "Test skipped"
				}

				// try to parse context
				ctx := ""
				if groups := testFailureContextGTest.FindStringSubmatch(body); len(groups) > 1 {
					ctx = groups[1]
				} else if groups := testFailureContextPython.FindStringSubmatch(body); len(groups) > 1 {
					ctx = groups[1] + ":" + groups[2]
				}
				reportCard.AddFailedResult(name, body, ctx)
			}
		}
	}
}

// parseCheckResults parses Check XML output and populates a report card
func parseCheckResults(reportCard *ReportCard, output io.Reader) {
	contents, err := io.ReadAll(output)
	if err != nil {
		reportCard.LogAndFailf("Error reading test output: %v", err)
		return
	}

	if len(contents) == 0 {
		reportCard.LogAndFailf("No unit test results found")
		return
	}

	results := new(CheckXMLProgram)
	if err := xml.Unmarshal(contents, results); err != nil {
		reportCard.LogAndFailf("error parsing unit test results: %v", err)
		return
	}

	successes, failures, errors := 0, 0, 0
	for _, suite := range results.Suites {
		for _, test := range suite.Tests {
			switch test.Result {
			case "success":
				successes++
				reportCard.AddPassedResult(test.ID, test.Message)
			case "failure":
				failures++
				reportCard.AddFailedResult(test.ID, test.Message, test.Function)
			case "error":
				errors++
				reportCard.AddFailedResult(test.ID, test.Message, test.Function)
			default:
				errors++
				reportCard.AddFailedResult(test.ID, test.Message, test.Function)
			}
		}
	}

	// form a report card
	reportCard.Passed = successes > 0 && failures == 0 && errors == 0
	if successes+failures+errors < 1 {
		reportCard.Note = "No test results found"
	} else {
		reportCard.Note = fmt.Sprintf("Passed %d/%d tests", successes, successes+failures+errors)
	}
	reportCard.Duration = time.Duration(results.Duration * float64(time.Second))
}

// parseCheckOutput parses simple check-style output (PASS:/FAIL:/ERROR: lines)
func parseCheckOutput(reportCard *ReportCard, output io.Reader) {
	contents, err := io.ReadAll(output)
	if err != nil {
		reportCard.LogAndFailf("Error reading test output: %v", err)
		return
	}

	reportCard.Passed = true
	for _, line := range bytes.Split(contents, []byte{'\n'}) {
		if m := checkLineRE.FindSubmatch(line); m != nil {
			switch string(m[1]) {
			case "PASS":
				reportCard.AddPassedResult(string(m[2]), "")
			case "FAIL":
				reportCard.Passed = false
				reportCard.AddFailedResult(string(m[2]), "", "")
			case "ERROR":
				reportCard.Passed = false
				reportCard.AddFailedResult(string(m[2]), "", "")
			}
		}
	}
}