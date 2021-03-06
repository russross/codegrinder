package main

import (
	"fmt"
	"log"
	"os"
	"strconv"

	. "github.com/russross/codegrinder/types"
	"github.com/spf13/cobra"
)

func CommandList(cmd *cobra.Command, args []string) {
	mustLoadConfig(cmd)

	if len(args) != 0 {
		cmd.Help()
		os.Exit(1)
	}

	user := new(User)
	mustGetObject("/users/me", nil, user)
	assignments := []*Assignment{}
	mustGetObject(fmt.Sprintf("/users/%d/assignments", user.ID), nil, &assignments)
	//assignments = filterOutQuizzes(assignments)
	if len(assignments) == 0 {
		log.Printf("no assignments found")
		log.Fatalf("you must start each assignment through Canvas before you can access it here")
	}

	var course *Course

	// find the longest assignment ID, name
	longestID, longestName := 1, 1
	for _, asst := range assignments {
		if n := len(strconv.FormatInt(asst.ID, 10)); n > longestID {
			longestID = n
		}
		if n := len(asst.CanvasTitle); n > longestName {
			longestName = n
		}
	}
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

		if asst.ProblemSetID > 0 {
			// fetch the problem
			problemSet := new(ProblemSet)
			mustGetObject(fmt.Sprintf("/problem_sets/%d", asst.ProblemSetID), nil, problemSet)
			fmt.Printf("id:%-*d %-*s %3.0f%% (%s/%s)\n", longestID, asst.ID, longestName, asst.CanvasTitle, asst.Score*100.0, courseDirectory(course.Label), problemSet.Unique)
		} else if asst.Instructor {
			// fetch the quizzes (instructor)
			var quizzes []*Quiz
			mustGetObject(fmt.Sprintf("/assignments/%d/quizzes", asst.ID), nil, &quizzes)
			s := "zes"
			if len(quizzes) == 1 {
				s = ""
			}
			fmt.Printf("id:%-*d %-*s      (%d quiz%s)\n", longestID, asst.ID, longestName, asst.CanvasTitle, len(quizzes), s)
		} else {
			// report on the quizzes (student)
			fmt.Printf("id:%-*d %-*s %3.0f%%\n", longestID, asst.ID, longestName, asst.CanvasTitle, asst.Score*100.0)
		}
	}
}

func filterOutQuizzes(assignments []*Assignment) []*Assignment {
	out := []*Assignment{}
	for _, elt := range assignments {
		if elt.ProblemSetID > 0 {
			out = append(out, elt)
		}
	}
	return out
}

func dashes(n int) string {
	s := ""
	for i := 0; i < n; i++ {
		s += "-"
	}
	return s
}
