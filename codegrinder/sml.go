package main

import (
	"io"
	"log"
)

func init() {
	problemTypeHandlers["standardmlunittest"] = map[string]nannyHandler{
		"grade": nannyHandler(standardMLUnittestGrade),
		"run":   nannyHandler(standardMLRun),
		"shell": nannyHandler(standardMLShell),
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
	if err := n.PutFiles(map[string]string{"runtests.sh": standardMLGradeScript}, 0777); err != nil {
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
	if err := n.PutFiles(map[string]string{"runpoly.sh": standardMLRunScript}, 0777); err != nil {
		n.ReportCard.LogAndFailf("error creating a.out: %v", err)
		return
	}

	// run a.out
	n.ExecSimple([]string{"ledit", "./runpoly.sh"}, stdin, true)
}

func standardMLShell(n *Nanny, args, options []string, files map[string]string, stdin io.Reader) {
	log.Printf("standard ML shell")

	n.ExecSimple([]string{"ledit", "poly"}, stdin, true)
}
