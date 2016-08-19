package main

import (
	"io"
	"log"

	. "github.com/russross/codegrinder/types"
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
		},
	}
}

var standardMLaout = `#!/bin/bash
set -e
ln -s tests/*.sml ./
rm -f test_detail.xml
poly < tests.sml
`

func standardMLUnittestGrade(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("standard ML unit test grade")

	// create an a.out file
	if err := n.PutFiles(map[string]string{"a.out": standardMLaout}); err != nil {
		n.ReportCard.LogAndFailf("error creating a.out: %v", err)
		return
	}

	// make it executable
	if err := n.ExecSimple([]string{"chmod", "755", "a.out"}, nil, false); err != nil {
		return
	}

	// run a.out and parse the output (in common with c++)
	gTestAOutCommon(n, files, nil)
}
