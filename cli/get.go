package main

import (
	"fmt"
	"log"
	"net/url"
	"os"
	"strconv"
	"strings"

	. "github.com/russross/codegrinder/types"
	"github.com/spf13/cobra"
)

func CommandGet(cmd *cobra.Command, args []string) {
	mustLoadConfig(cmd)

	rootDir, err := os.UserHomeDir()
	if err != nil {
		log.Fatalf("unable to find home directory: %v", err)
	}
	prettyRoot := "~"

	if len(args) == 0 {
		cmd.Help()
		os.Exit(1)
	} else if len(args) > 2 {
		log.Printf("you must specify the assignment to download")
		log.Printf("   run '%s list' to see your assignments", os.Args[0])
		log.Printf("   you must give the assignment number (displayed on the left of the list)")
		log.Fatalf("   or a name in the form COURSE/problem-set-id (displayed in parentheses)")
	}
	name := args[0]
	if len(args) == 2 {
		rootDir = args[1]
		prettyRoot = rootDir
	}

	user := new(User)
	mustGetObject("/users/me", nil, user)

	var assignment *Assignment
	if id, err := strconv.Atoi(name); err == nil && id > 0 {
		// look it up by ID
		assignment = new(Assignment)
		mustGetObject(fmt.Sprintf("/assignments/%d", id), nil, assignment)
	} else {
		// parse the course label and the problem unique id
		parts := strings.Split(name, "/")
		if len(parts) != 2 {
			log.Printf("unknown assignment identifier")
			log.Printf("   run '%s get [id]'", os.Args[0])
			log.Printf("   or  '%s get [course/problem-id]'", os.Args[0])
			log.Fatalf("   [id] and [course/problem-id] can be found using '%s list'", os.Args[0])
		}
		label, unique := parts[0], parts[1]

		// find the assignment
		assignmentList := []*Assignment{}
		params := make(url.Values)
		params.Add("course_lti_label", label)
		params.Add("problem_unique", unique)
		mustGetObject(fmt.Sprintf("/users/%d/assignments", user.ID), params, &assignmentList)
		if len(assignmentList) == 0 {
			log.Printf("no matching assignment found")
			log.Printf("   run '%s get [id]'", os.Args[0])
			log.Printf("   or  '%s get [course/problem-id]'", os.Args[0])
			log.Fatalf("   [id] and [course/problem-id] can be found using '%s list'", os.Args[0])
		} else if len(assignmentList) != 1 {
			log.Printf("found more than one matching assignment")
			log.Printf("   run '%s get [id]' instead", os.Args[0])
			log.Fatalf("   [id] can be found using '%s list'", os.Args[0])
		}
		assignment = assignmentList[0]
	}
	if assignment.UserID != user.ID {
		log.Fatalf("you do not have an assignment with number %d", assignment.ID)
	}
	getAssignment(assignment, rootDir, prettyRoot)
}
