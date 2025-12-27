package main

import (
	"log"
	"os"
	"strconv"
	"strings"

	. "github.com/russross/codegrinder/rpc"
	"github.com/spf13/cobra"
)

func CommandGet(cmd *cobra.Command, args []string) {
	client, conn, ctx, user, err := setup(cmd)
	if err != nil {
		log.Fatalf("failed to connect to gRPC server: %v", err)
	}
	defer conn.Close()

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

	var assignment *Assignment
	if id, err := strconv.Atoi(name); err == nil && id > 0 {
		// look it up by ID
		dumpMessage("GetAssignment", true, &GetAssignmentRequest{AssignmentId: int64(id)})
		assignmentResp, err := client.GetAssignment(ctx, &GetAssignmentRequest{AssignmentId: int64(id)})
		if err != nil {
			log.Fatalf("failed to get assignment: %v", err)
		}
		dumpMessage("GetAssignment", false, assignmentResp)
		assignment = assignmentResp.Assignment
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
		searchTerms := []string{label, unique}
		dumpMessage("GetAssignments", true, &GetAssignmentsRequest{Search: searchTerms})
		assignmentsResp, err := client.GetAssignments(ctx, &GetAssignmentsRequest{Search: searchTerms})
		if err != nil {
			log.Fatalf("failed to get assignments: %v", err)
		}
		dumpMessage("GetAssignments", false, assignmentsResp)
		assignmentList := assignmentsResp.Assignments
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
	if assignment.UserId != user.Id {
		log.Fatalf("you do not have an assignment with number %d", assignment.Id)
	}
	getAssignment(assignment, rootDir, prettyRoot, client, ctx)
}
