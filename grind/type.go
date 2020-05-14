package main

import (
	"bytes"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"strings"

	. "github.com/russross/codegrinder/types"
	"github.com/spf13/cobra"
)

func CommandType(cmd *cobra.Command, args []string) {
	mustLoadConfig(cmd)

	switch len(args) {
	case 0:
		// display a list of problem types
		fmt.Println("Problem types:")
		problemTypes := []*ProblemType{}
		mustGetObject("/problem_types", nil, &problemTypes)
		if len(problemTypes) == 0 {
			log.Fatalf("no problem types found")
		}
		maxLen := 0
		for _, pt := range problemTypes {
			if len(pt.Name) > maxLen {
				maxLen = len(pt.Name)
			}
		}
		for _, pt := range problemTypes {
			var actions []string
			for action := range pt.Actions {
				actions = append(actions, action)
			}
			fmt.Printf("    %-*s  actions: %s\n", maxLen, pt.Name, strings.Join(actions, ", "))
		}

	case 1:
		// download and update files for a given problem type
		problemType := new(ProblemType)
		mustGetObject(fmt.Sprintf("/problem_types/%s", args[0]), nil, problemType)

		// check that the on-disk file matches the expected contents
		// and update as needed
		checkAndUpdate := func(name string, contents []byte) {
			path := filepath.Join(".", name)
			ondisk, err := ioutil.ReadFile(path)
			if err != nil && os.IsNotExist(err) {
				log.Printf("saving file %s", name)
				if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
					log.Fatalf("error creating directory %s: %v", filepath.Dir(path), err)
				}
				if err := ioutil.WriteFile(path, contents, 0644); err != nil {
					log.Fatalf("error saving %s: %v", name, err)
				}
			} else if err != nil {
				log.Fatalf("error reading %s: %v", name, err)
			} else if !bytes.Equal(ondisk, contents) {
				log.Printf("warning: file %s", name)
				log.Printf("   does not match the latest version")
				log.Printf("   replacing your file with the current version")
				if err := ioutil.WriteFile(path, contents, 0644); err != nil {
					log.Fatalf("error saving %s: %v", name, err)
				}
			}
		}

		// save each file
		for name, contents := range problemType.Files {
			checkAndUpdate(filepath.FromSlash(name), contents)
		}

	default:
		log.Printf("unexpected arguments: either")
		log.Printf("  1. supply a problem type to download files, or")
		log.Fatalf("  2. supply nothing to list problem types")
	}
}
