package main

import (
	"fmt"
	"log"
	"os"
	"strconv"

	. "github.com/russross/codegrinder/rpc"
	"github.com/spf13/cobra"
)

func CommandList(cmd *cobra.Command, args []string) {
	client, conn, ctx, _, err := setup(cmd)
	if err != nil {
		log.Fatalf("failed to connect to gRPC server: %v", err)
	}
	defer conn.Close()

	if len(args) != 0 {
		cmd.Help()
		os.Exit(1)
	}

	// Call ListProblems
	dumpMessage("ListProblems", true, &ListProblemsRequest{})
	resp, err := client.ListProblems(ctx, &ListProblemsRequest{})
	if err != nil {
		log.Fatalf("failed to get list from gRPC: %v", err)
	}
	dumpMessage("ListProblems", false, resp)

	// Reconstruct the data
	assignments := resp.Assignments
	courses := resp.Courses
	problemSets := resp.ProblemSets

	if len(assignments) == 0 {
		log.Printf("no assignments found")
		log.Fatalf("you must start each assignment through Canvas before you can access it here")
	}

	// Create maps for quick lookup
	courseMap := make(map[int64]*Course)
	for _, c := range courses {
		courseMap[c.Id] = c
	}
	problemSetMap := make(map[int64]*ProblemSet)
	for _, ps := range problemSets {
		problemSetMap[ps.Id] = ps
	}

	var course *Course

	// find the longest assignment ID, name
	longestID, longestName := 1, 1
	for _, asst := range assignments {
		if n := len(strconv.FormatInt(asst.Id, 10)); n > longestID {
			longestID = n
		}
		if n := len(asst.CanvasTitle); n > longestName {
			longestName = n
		}
	}
	for _, asst := range assignments {
		if course == nil || asst.CourseId != course.Id {
			if course != nil {
				fmt.Println()
			}

			// get the course
			course = courseMap[asst.CourseId]
			fmt.Println(course.Name)
			fmt.Println(dashes(len(course.Name)))
		}

		// get the problem set
		problemSet := problemSetMap[asst.ProblemSetId]
		fmt.Printf("id:%-*d %-*s %3.0f%% (%s/%s)\n", longestID, asst.Id, longestName, asst.CanvasTitle, asst.Score*100.0, courseDirectory(course.Label), problemSet.Unique)
	}
}

func dashes(n int) string {
	s := ""
	for i := 0; i < n; i++ {
		s += "-"
	}
	return s
}
