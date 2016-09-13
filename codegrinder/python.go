package main

import (
	"fmt"
	"io"
	"log"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	. "github.com/russross/codegrinder/common"
)

const workingDir = "/home/student"

func init() {
	problemTypeHandlers["python27unittest"] = map[string]nannyHandler{
		"grade": nannyHandler(python27UnittestGrade),
		"run":   nannyHandler(python27Run),
		"debug": nannyHandler(python27Debug),
		"shell": nannyHandler(python27Shell),
	}
	problemTypeHandlers["python34unittest"] = map[string]nannyHandler{
		"grade": nannyHandler(python34UnittestGrade),
		"run":   nannyHandler(python34Run),
		"debug": nannyHandler(python34Debug),
		"shell": nannyHandler(python34Shell),
	}
}

func python27UnittestGrade(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("python 2.7 unit test grade")

	pythonUnittestGrade(n, args, options, files, stdin, "2.7")
}

func python34UnittestGrade(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("python 3.4 unit test grade")

	pythonUnittestGrade(n, args, options, files, stdin, "3.4")
}

func pythonUnittestGrade(n *Nanny, args, options []string, files map[string]string, stdin io.Reader, suffix string) {
	// launch the unit test runner (discard stdin)
	_, stderr, _, status, err := n.Exec(
		[]string{"python" + suffix, "-m", "unittest", "discover", "-vbs", "tests"},
		nil, false)
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
	n.ReportCard.Duration = time.Since(n.Start)

	// generate a top-level summary
	if n.ReportCard.Note == "" {
		n.ReportCard.Note = fmt.Sprintf("%d/%d tests passed in %v", len(n.ReportCard.Results)-len(failed), len(n.ReportCard.Results), n.ReportCard.Duration)
		if len(failed) == 0 && status != 0 {
			n.ReportCard.Note += fmt.Sprintf(", exit status %d", status)
		}
	}
}

func python27Run(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("python 2.7 run")

	exec, err := pythonGetExecArgs([]string{"python2.7", "-i"}, args, files)
	if err != nil {
		n.ReportCard.LogAndFailf("%v", err)
		return
	}

	// launch the student's code
	n.ExecSimple(exec, stdin, true)
}

func python34Run(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("python 3.4 run")

	exec, err := pythonGetExecArgs([]string{"python3.4", "-i"}, args, files)
	if err != nil {
		n.ReportCard.LogAndFailf("%v", err)
		return
	}

	// launch the student's code
	n.ExecSimple(exec, stdin, true)
}

func python27Debug(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("python 2.7 debug")

	exec, err := pythonGetExecArgs([]string{"pdb2.7"}, args, files)
	if err != nil {
		n.ReportCard.LogAndFailf("%v", err)
		return
	}

	// launch the student's code
	n.ExecSimple(exec, stdin, true)
}

func python34Debug(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("python 3.4 debug")

	exec, err := pythonGetExecArgs([]string{"pdb3.4"}, args, files)
	if err != nil {
		n.ReportCard.LogAndFailf("%v", err)
		return
	}

	// launch the student's code
	n.ExecSimple(exec, stdin, true)
}

func python27Shell(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("python 2.7 shell")

	n.ExecSimple([]string{"python2.7"}, stdin, true)
}

func python34Shell(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("python 3.4 shell")

	n.ExecSimple([]string{"python3.4"}, stdin, true)
}

func pythonGetExecArgs(exec, args []string, files map[string]string) ([]string, error) {
	// was it handed in?
	for _, elt := range args {
		parts := strings.SplitN(elt, "=", 2)
		if len(parts) != 2 || parts[0] != "SCRIPT" {
			continue
		}
		exec = append(exec, parts[1])
		return exec, nil
	}

	// fallback: scan for *.py files
	py := []string{}
	for path := range files {
		dir, file := filepath.Split(path)
		if dir == "" && filepath.Ext(file) == ".py" {
			py = append(py, path)
		}
	}

	// only one? run it
	if len(py) == 1 {
		exec = append(exec, py[0])
		return exec, nil
	}

	// cam we find one called main.py?
	for _, elt := range py {
		if elt == "main.py" {
			exec = append(exec, elt)
			return exec, nil
		}
	}

	// does exactly one have a function called main?
	gotmain := ""
	for _, elt := range py {
		file := files[elt]
		found, err := regexp.MatchString(`\bdef main\b`, file)
		if err != nil {
			return nil, fmt.Errorf("regexp error searching for 'def main' in file %s: %v", elt, err)
		}
		if !found {
			continue
		}

		if gotmain != "" {
			return nil, fmt.Errorf("unable to find script to run: multiple scripts with 'def main'")
		}
		gotmain = elt
	}
	if gotmain != "" {
		exec = append(exec, gotmain)
		return exec, nil
	}

	return nil, fmt.Errorf("unable to find script to run")
}
