package main

import (
	"fmt"
	"io"
	"log"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const workingDir = "/home/student"

func init() {
	problemTypes["python2unittest"] = &ProblemTypeDefinition{
		Image:       "codegrinder/python2",
		MaxCPU:      10,
		MaxFD:       10,
		MaxFileSize: 10,
		MaxMemory:   32,
		MaxThreads:  20,
		Actions: map[string]*ProblemTypeAction{
			"grade": &ProblemTypeAction{
				Action:  "grade",
				Button:  "Grade",
				Message: "Grading‥",
				Class:   "btn-grade",
				handler: nannyHandler(python2UnittestGrade),
			},
			"": &ProblemTypeAction{
				Action: "",
				Button: "Save",
				Class:  "btn-save",
			},
			"interactive": &ProblemTypeAction{
				Action:  "interactive",
				Button:  "Run",
				Message: "Running %s‥",
				Class:   "btn-run",
				//handler: autoHandler(python27Interactive),
			},
			"debug": &ProblemTypeAction{
				Action:  "debug",
				Button:  "Debug",
				Message: "Running debugger on %s‥",
				Class:   "btn-debug",
				//handler: autoHandler(python27Debug),
			},
			"adhoc": &ProblemTypeAction{
				Action:  "adhoc",
				Button:  "Shell",
				Message: "Running Python shell‥",
				Class:   "btn-shell",
				//handler: autoHandler(python27Adhoc),
			},
			"stylecheck": &ProblemTypeAction{
				Action:  "stylecheck",
				Button:  "Check style",
				Message: "Checking for pep8 style problems‥",
				//handler: autoHandler(python27StyleCheck),
			},
			"stylefix": &ProblemTypeAction{
				Action:  "stylefix",
				Button:  "Fix style",
				Message: "Auto-correcting pep8 style problems‥",
				//handler: autoHandler(python27StyleFix),
			},
			"confirm": &ProblemTypeAction{
				Action:  "confirm",
				handler: nannyHandler(python2UnittestGrade),
			},
		},
	}
	problemTypes["python27inout"] = &ProblemTypeDefinition{
		Image:       "codegrinder/python2",
		MaxCPU:      10,
		MaxFD:       10,
		MaxFileSize: 10,
		MaxMemory:   32,
		MaxThreads:  20,
		Actions: map[string]*ProblemTypeAction{
			"grade": &ProblemTypeAction{
				Action:  "grade",
				Button:  "Grade",
				Message: "Grading‥",
				Class:   "btn-grade",
				//handler: autoHandler(python27InOutGrade),
			},
			"": &ProblemTypeAction{
				Action: "",
				Button: "Save",
				Class:  "btn-save",
			},
			"interactive": &ProblemTypeAction{
				Action:  "interactive",
				Button:  "Run",
				Message: "Running %s‥",
				Class:   "btn-run",
				//handler: autoHandler(python27Interactive),
			},
			"debug": &ProblemTypeAction{
				Action:  "debug",
				Button:  "Debug",
				Message: "Running debugger on %s‥",
				Class:   "btn-debug",
				//handler: autoHandler(python27Debug),
			},
			"adhoc": &ProblemTypeAction{
				Action:  "adhoc",
				Button:  "Shell",
				Message: "Running Python shell‥",
				Class:   "btn-shell",
				//handler: autoHandler(python27Adhoc),
			},
			"stylecheck": &ProblemTypeAction{
				Action:  "stylecheck",
				Button:  "Check style",
				Message: "Checking for pep8 style problems‥",
				//handler: autoHandler(python27StyleCheck),
			},
			"stylefix": &ProblemTypeAction{
				Action:  "stylefix",
				Button:  "Fix style",
				Message: "Auto-correcting pep8 style problems‥",
				//handler: autoHandler(python27StyleFix),
			},
			"_setup": &ProblemTypeAction{
				Action: "_setup",
				//handler: autoHandler(python27InOutSetup),
			},
		},
	}
}

func python2UnittestGrade(n *Nanny, args []string, options []string, files map[string]string) {
	log.Printf("python2UnittestGrade")

	// put the files in the container
	if err := n.PutFiles(files); err != nil {
		n.ReportCard.LogAndFailf("PutFiles error: %v", err)
		return
	}

	// launch the unit test runner
	_, stderr, _, status, err := n.ExecNonInteractive(
		[]string{"python", "-m", "unittest", "discover", "-vbs", "tests"})
	if err != nil {
		n.ReportCard.LogAndFailf("exec error: %v", err)
		return
	}

	// check exit status code
	if status != 0 {
		n.ReportCard.Passed = false
	}

	// read the summary lines: one per test followed by a blank line
	summaryLine := regexp.MustCompile(`^((\w+) \(([\w\.]+)\.(\w+)\) \.\.\. (ok|FAIL|ERROR))\n$`)
	var failed []*ReportCardResult
	for {
		line, err := stderr.ReadString('\n')

		// note: an error here means the buffer does not end with newline, which makes us angry
		if err != nil {
			n.ReportCard.LogAndFailf("Error reading test results: %v", err)
			break
		}

		// summaries end with a blank line
		if line == "\n" {
			if len(n.ReportCard.Results) == 0 {
				continue
			}
			break
		}

		// start with some default values, then look for better values
		name := fmt.Sprintf("test #%d", len(n.ReportCard.Results)+1)
		details := htmlEscapePara("error reading results")

		// parse a summary line
		groups := summaryLine.FindStringSubmatch(line)
		if len(groups) == 0 {
			if len(n.ReportCard.Results) == 1 {
				// failed to parse the first line? something serious must be wrong
				n.ReportCard.Failf("unable to run unit tests")
				n.ReportCard.AddFailedResult(name, htmlEscapePara(stderr.String()), "")
			} else {
				// try to hobble along: previous tests seemed okay
				n.ReportCard.Failf("bad result from test %d", len(n.ReportCard.Results))
				n.ReportCard.AddFailedResult(name, "<h1>Unexpected test result summary</h1>\n"+htmlEscapePara(strings.TrimSpace(line)), "")
			}
			break
		}

		// extract the result
		summary, test, file, _, result := groups[1], groups[2], groups[3], groups[4], groups[5]
		name = test
		details = htmlEscapePara(summary)
		context := ""
		if result != "ERROR" {
			context = "tests/" + file + ".py"
		}
		if result == "ok" {
			n.ReportCard.AddPassedResult(name, details)
		} else {
			failed = append(failed, n.ReportCard.AddFailedResult(name, details, context))
		}

	}
	if len(n.ReportCard.Results) == 0 {
		n.ReportCard.Failf("No unit test results found")
	}

	// gather details for failed tests
	contextLine := regexp.MustCompile(`^ +File "(.*)", line (\d+)(?:, in \w+)?\n$`)
	for _, elt := range failed {
		// read a chunk of lines surrounded by blank lines
		var lines []string
		for {
			line, err := stderr.ReadString('\n')
			if err == io.EOF {
				elt.Details = htmlEscapePara("End-of-file while reading failed test details")
				log.Printf("End-of-file while reading failed test details")
				break
			}
			if err != nil {
				elt.Details = "<h1>Error reading failed test results</h1>\n" + htmlEscapePara(err.Error())
				log.Printf("Error reading failed test results: %v", err)
			}
			if line == "\n" {
				if len(lines) == 0 {
					continue
				}
				break
			}

			// strip newline
			lines = append(lines, line[:len(line)-1])

			// parse out context if available
			groups := contextLine.FindStringSubmatch(line)
			if len(groups) == 0 {
				continue
			}

			// get file and line number of reported error
			filename, linenumber := groups[1], groups[2]
			if filepath.IsAbs(filename) {
				// unit tests get absolute paths, but parse errors get simple file names
				path, err := filepath.Rel(workingDir, filename)
				if err != nil {
					log.Printf("Error getting relative path for unit test %q: %v", filename, err)
					continue
				}
				filename = path
			}
			elt.Context = filename + ":" + linenumber
		}
		elt.Details = htmlEscapePre(strings.Join(lines, "\n"))
	}
	n.ReportCard.Time = time.Since(n.Start)

	// generate a top-level summary
	if n.ReportCard.Message == "" {
		n.ReportCard.Message = fmt.Sprintf("%d/%d tests passed in %v", len(n.ReportCard.Results)-len(failed), len(n.ReportCard.Results), n.ReportCard.Time)
		if len(failed) == 0 && status != 0 {
			n.ReportCard.Message += fmt.Sprintf(", exit status %d", status)
		}
	}
}
