package main

import (
	"fmt"
	"log"
	"os"
	"sort"
	"strings"

	. "github.com/russross/codegrinder/rpc"
	"github.com/spf13/cobra"
)

func CommandProblem(cmd *cobra.Command, args []string) {
	client, conn, ctx, _, err := setup(cmd)
	if err != nil {
		log.Fatalf("failed to connect to gRPC server: %s", cleanError(err))
	}
	defer conn.Close()

	// make sure at least one search term was given
	if len(args) == 0 {
		log.Printf("you must specify search terms to find the problem set")
		log.Printf("  terms will match against the problem set name, note,")
		log.Printf("  and tags, or agains the same attributes of a problem")
		log.Printf("  in the problem set. All searchs are case-insensitive.")
		log.Fatalf("  e.g.: '%s problem cs2810 formula'", os.Args[0])
	}

	// search for matching problem sets
	searchTerms := args
	dumpMessage("GetProblemSets", true, &GetProblemSetsRequest{Search: searchTerms})
	problemSetsResp, err := client.GetProblemSets(ctx, &GetProblemSetsRequest{Search: searchTerms})
	if err != nil {
		log.Fatalf("failed to get problem sets: %s", cleanError(err))
	}
	dumpMessage("GetProblemSets", false, problemSetsResp)
	problemSets := problemSetsResp.ProblemSets
	if len(problemSets) == 0 {
		log.Fatalf("no problem sets found matching the terms you gave")
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
		dumpMessage("GetProblemSetProblems", true, &GetProblemSetProblemsRequest{ProblemSetId: ps.Id})
		pspsResp, err := client.GetProblemSetProblems(ctx, &GetProblemSetProblemsRequest{ProblemSetId: ps.Id})
		if err != nil {
			log.Fatalf("failed to get problem set problems: %s", cleanError(err))
		}
		dumpMessage("GetProblemSetProblems", false, pspsResp)
		psps := pspsResp.ProblemSetProblems
		for _, psp := range psps {
			// get the problem
			problem, present := problems[psp.ProblemId]
			if !present {
				dumpMessage("GetProblem", true, &GetProblemRequest{ProblemId: psp.ProblemId})
				problemResp, err := client.GetProblem(ctx, &GetProblemRequest{ProblemId: psp.ProblemId})
				if err != nil {
					log.Fatalf("failed to get problem: %s", cleanError(err))
				}
				dumpMessage("GetProblem", false, problemResp)
				problem = problemResp.Problem
				problems[psp.ProblemId] = problem
			}

			// get the steps
			steps, present := problemSteps[psp.ProblemId]
			if !present {
				dumpMessage("GetProblemSteps", true, &GetProblemStepsRequest{ProblemId: psp.ProblemId})
				stepsResp, err := client.GetProblemSteps(ctx, &GetProblemStepsRequest{ProblemId: psp.ProblemId})
				if err != nil {
					log.Fatalf("failed to get problem steps: %s", cleanError(err))
				}
				dumpMessage("GetProblemSteps", false, stepsResp)
				steps = stepsResp.ProblemSteps
				problemSteps[psp.ProblemId] = steps
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
		}

		// report the LTI URL
		fmt.Println()
		fmt.Printf("  → https://%s/lti/problem_sets/cli/%s\n", Config.Host, ps.Unique)
	}
}
