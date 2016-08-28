package main

import (
	"io"
	"log"

	. "github.com/russross/codegrinder/common"
)

func init() {
	problemTypes["standardmlunittest"] = &ProblemType{
		Name:        "standardmlunittest",
		Image:       "codegrinder/standardml",
		MaxCPU:      10,
		MaxSession:  30 * 60,
		MaxTimeout:  5 * 60,
		MaxFD:       100,
		MaxFileSize: 10,
		MaxMemory:   128,
		MaxThreads:  20,
		Actions: map[string]*ProblemTypeAction{
			"grade": &ProblemTypeAction{
				Action:      "grade",
				Button:      "Grade",
				Message:     "Grading‥",
				Interactive: false,
				Handler:     nannyHandler(standardMLUnittestGrade),
			},
			"run": &ProblemTypeAction{
				Action:      "run",
				Button:      "Run",
				Message:     "Running %s‥",
				Interactive: true,
				Handler:     nannyHandler(standardMLRun),
			},
			"shell": &ProblemTypeAction{
				Action:      "shell",
				Button:      "Shell",
				Message:     "Running PolyML shell‥",
				Interactive: true,
				Handler:     nannyHandler(standardMLShell),
			},
		},
	}
}

var standardMLGradeScript = `#!/bin/bash
set -e
ln -s tests/*.sml ./
rm -f test_detail.xml
poly < tests.sml
`

func standardMLUnittestGrade(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("standard ML unit test grade")

	// create a script file
	if err := n.PutFiles(map[string]string{"runtests.sh": standardMLGradeScript}, 0755); err != nil {
		n.ReportCard.LogAndFailf("error creating runtests.sh: %v", err)
		return
	}

	// run script and parse XML output
	parseXUnit(n, []string{"./runtests.sh"}, nil, "test_detail.xml")
}

var standardMLRunScript = `#!/bin/bash
set -e
echo ';' > /tmp/semi
cat *.sml /tmp/semi - | poly
`

func standardMLRun(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("standard ML run")

	// create a driver script file
	if err := n.PutFiles(map[string]string{"runpoly.sh": standardMLRunScript}, 0755); err != nil {
		n.ReportCard.LogAndFailf("error creating a.out: %v", err)
		return
	}

	// run a.out
	n.ExecSimple([]string{"./runpoly.sh"}, stdin, true)
}

func standardMLShell(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("standard ML shell")

	n.ExecSimple([]string{"poly"}, stdin, true)
}
