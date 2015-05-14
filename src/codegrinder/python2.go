package main

import (
	"fmt"
	"io"
	"log"
	"path/filepath"
	"regexp"
	"strings"
)

const workingDir = "/home/student"

func python2UnittestGrade(n *Nanny, rc *ReportCard, args []string, options []string, files map[string]string) {
	// put the files in the container
	if err := n.PutFiles(files); err != nil {
		log.Fatalf("PutFiles error")
	}

	// launch the unit test runner
	_, stderr, _, status, err := n.ExecNonInteractive(
		[]string{"python", "-m", "unittest", "discover", "-vbs", "tests"})
	if err != nil {
		log.Fatalf("exec error")
	}

	// read the summary lines: one per test followed by a blank line
	summaryLine := regexp.MustCompile(`^((\w+) \(([\w\.]+)\.(\w+)\) \.\.\. (ok|FAIL|ERROR))\n$`)
	var failed []*ReportCardResult
	for {
		line, err := stderr.ReadString('\n')

		// note: an error here means the buffer does not end with newline, which makes us angry
		if err != nil {
			rc.LogAndFailf("Error reading test results: %v", err)
			break
		}

		// summaries end with a blank line
		if line == "\n" {
			if len(rc.Results) == 0 {
				continue
			}
			break
		}

		// start with some default values, then look for better values
		name := fmt.Sprintf("test #%d", len(rc.Results)+1)
		details := htmlEscapePara("error reading results")

		// parse a summary line
		groups := summaryLine.FindStringSubmatch(line)
		if len(groups) == 0 {
			if len(rc.Results) == 1 {
				// failed to parse the first line? something serious must be wrong
				rc.Failf("unable to run unit tests")
				rc.AddFailedResult(name, htmlEscapePara(stderr.String()), "")
			} else {
				// try to hobble along: previous tests seemed okay
				rc.Failf("bad result from test %d", len(rc.Results))
				rc.AddFailedResult(name, "<h1>Unexpected test result summary</h1>\n"+htmlEscapePara(strings.TrimSpace(line)), "")
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
			rc.AddPassedResult(name, details)
		} else {
			failed = append(failed, rc.AddFailedResult(name, details, context))
		}

	}
	if len(rc.Results) == 0 {
		rc.Failf("No unit test results found")
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
				log.Printf("EOF while reading failed test details")
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

	// check exit status code
	if status != 0 {
		rc.Passed = false
	}

	// generate a top-level summary
	if rc.Message == "" {
		rc.Message = fmt.Sprintf("%d/%d tests passed in %v", len(rc.Results)-len(failed), len(rc.Results), rc.Time)
	}
}
