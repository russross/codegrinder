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

var standardMLGradeAOut = `#!/bin/bash
set -e
ln -s tests/*.sml ./
rm -f test_detail.xml
poly < tests.sml
`

func standardMLUnittestGrade(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("standard ML unit test grade")

	// create an a.out file
	if err := n.PutFiles(map[string]string{"a.out": standardMLGradeAOut}, 0755); err != nil {
		n.ReportCard.LogAndFailf("error creating a.out: %v", err)
		return
	}

	// run a.out and parse the output (in common with c++)
	gTestAOutCommon(n, files, nil)
}

var standardMLRunAOut = `#!/bin/bash
set -e
echo ';' > /tmp/semi
cat *.sml /tmp/semi - | poly
`

func standardMLRun(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("standard ML run")

	// create an a.out file
	if err := n.PutFiles(map[string]string{"a.out": standardMLRunAOut}, 0755); err != nil {
		n.ReportCard.LogAndFailf("error creating a.out: %v", err)
		return
	}

	// run a.out
	n.ExecSimple([]string{"./a.out"}, stdin, true)
}

func standardMLShell(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("standard ML shell")

	n.ExecSimple([]string{"poly"}, stdin, true)
}
