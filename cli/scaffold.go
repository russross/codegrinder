package main

import (
	"os"
	"fmt"
	"log"

	// . "github.com/russross/codegrinder/types"
	"github.com/spf13/cobra"
)

func CommandScaffold(cmd *cobra.Command, args []string) {
	if len(args) == 0 || len(args) > 1 {
		cmd.Help()
		os.Exit(1)
	}

	assignment_name := args[0]

	dirs := []string{"_starter", "doc", "tests"}
	files := []string{"doc/doc.md", "problem.cfg"}

	for i := range dirs {
		dirs[i] = fmt.Sprintf("%s/%s", assignment_name, dirs[i])
	}
	for i := range files {
		files[i] = fmt.Sprintf("%s/%s", assignment_name, files[i])
	}

	os.Mkdir(assignment_name, 0755)
	for i := range dirs {
		os.Mkdir(dirs[i], 0755)
	}
	for i := range files {
		os.Create(files[i])
	}

	cfg := fmt.Sprintf("%s/problem.cfg", assignment_name)
	fobj, err := os.OpenFile(cfg, os.O_WRONLY, 0644)
	if err != nil {
		log.Println("Error opening problem.cfg for writing: ", err)
		fobj.Close()
		os.Exit(1)
	}
	str := fmt.Sprintf("[problem]\ntype = \nunique = %s\nnote = \ntag = \n", assignment_name)
	_, err = fobj.WriteString(str)
	if err != nil {
		log.Println("error writing to problem.cfg: ", err)
		fobj.Close()
		os.Exit(1)
	}
	fobj.Close()
}
