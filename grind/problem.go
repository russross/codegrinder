package main

import (
	"fmt"
	"log"
	"net/url"
	"os"
	"sort"
	"strings"

	. "github.com/russross/codegrinder/common"
	"github.com/spf13/cobra"
)

func CommandProblem(cmd *cobra.Command, args []string) {
	mustLoadConfig(cmd)

	// make sure at least one search term was given
	if len(args) == 0 {
		log.Printf("you must specify search terms to find the problem set")
		log.Printf("  terms will match against the problem set name, note,")
		log.Printf("  and tags, or agains the same attributes of a problem")
		log.Printf("  in the problem set. All searchs are case-insensitive.")
		log.Fatalf("  e.g.: '%s problem cs2810 formula", os.Args[0])
	}

	// search for matching problem sets
	problemSets := []*ProblemSet{}
	params := make(url.Values)
	for _, term := range args {
		params.Add("search", term)
	}
	mustGetObject("/problem_sets", params, &problemSets)
	if len(problemSets) == 0 {
		log.Fatalf("no problem sets found matchin the terms you gave")
	}
	sort.Slice(problemSets, func(i, j int) bool {
		return strings.ToLower(problemSets[i].Unique) < strings.ToLower(problemSets[j].Unique)
	})

	problems := make(map[int64]*Problem)
	problemSteps := make(map[int64][]*ProblemStep)

	// print out the results
	for n, ps := range problemSets {
		if n > 0 {
			fmt.Println()
		}
		fmt.Println(ps.Note)

		// get the problems in this problem set
		psps := []*ProblemSetProblem{}
		mustGetObject(fmt.Sprintf("/problem_sets/%d/problems", ps.ID), nil, &psps)
		for _, psp := range psps {
			// get the problem
			problem, present := problems[psp.ProblemID]
			if !present {
				problem = new(Problem)
				mustGetObject(fmt.Sprintf("/problems/%d", psp.ProblemID), nil, problem)
				problems[psp.ProblemID] = problem
			}

			// get the steps
			steps, present := problemSteps[psp.ProblemID]
			if !present {
				steps = []*ProblemStep{}
				mustGetObject(fmt.Sprintf("/problems/%d/steps", psp.ProblemID), nil, &steps)
				problemSteps[psp.ProblemID] = steps
			}

			// report on the problem
			if psp.Weight == 1.0 {
				fmt.Printf("  * %s (%s)\n", problem.Note, problem.Unique)
			} else {
				fmt.Printf("  * %s (%s, weight %.2f)\n", problem.Note, problem.Unique, psp.Weight)
			}

			// print the steps
			for i, step := range steps {
				fmt.Printf("    %d. %s",
					i+1,
					strings.Replace(step.Note, "\n", "\n       ", -1))
				if step.Weight != 1.0 {
					fmt.Printf(" (weight %.2f)", step.Weight)
				}
				fmt.Println()
			}

			// report the LTI URL
			fmt.Println()
			fmt.Printf("  → https://%s%s/lti/problem_sets/%s\n", Config.Host, urlPrefix, ps.Unique)
		}
	}
}
