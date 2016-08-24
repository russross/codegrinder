package main

import (
	"fmt"
	"log"

	. "github.com/russross/codegrinder/common"
	"github.com/spf13/cobra"
)

func CommandList(cmd *cobra.Command, args []string) {
	mustLoadConfig(cmd)

	user := new(User)
	mustGetObject("/users/me", nil, user)
	assignments := []*Assignment{}
	mustGetObject(fmt.Sprintf("/users/%d/assignments", user.ID), nil, &assignments)
	if len(assignments) == 0 {
		log.Printf("no assignments found")
		log.Fatalf("you must start each assignment through Canvas before you can access it here")
	}

	var course *Course
	for _, asst := range assignments {
		if course == nil || asst.CourseID != course.ID {
			if course != nil {
				fmt.Println()
			}

			// fetch the course
			course = new(Course)
			mustGetObject(fmt.Sprintf("/courses/%d", asst.CourseID), nil, course)
			fmt.Println(course.Name)
			fmt.Println(dashes(len(course.Name)))
		}

		// fetch the problem
		problemSet := new(ProblemSet)
		mustGetObject(fmt.Sprintf("/problem_sets/%d", asst.ProblemSetID), nil, problemSet)
		fmt.Printf("%d: %s (%s/%s)\n", asst.ID, asst.CanvasTitle, course.Label, problemSet.Unique)
	}
}

func dashes(n int) string {
	s := ""
	for i := 0; i < n; i++ {
		s += "-"
	}
	return s
}
