package main

import (
	"fmt"
	"log"

	"github.com/codegangsta/cli"
)

func CommandList(context *cli.Context) {
	mustLoadConfig()

	assignments := []*Assignment{}
	mustGetObject("/users/me/assignments", nil, &assignments)
	if len(assignments) == 0 {
		log.Printf("no assignments found")
		log.Fatalf("you must start each assignment through Canvas before viewing it here")
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
		problem := new(Problem)
		mustGetObject(fmt.Sprintf("/problems/%d", asst.ProblemID), nil, problem)
		fmt.Printf("%d: %s (%s/%s)\n", asst.ID, asst.CanvasTitle, course.Label, problem.Unique)
	}
}

func dashes(n int) string {
	s := ""
	for i := 0; i < n; i++ {
		s += "-"
	}
	return s
}
