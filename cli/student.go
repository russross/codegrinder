package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"time"

	. "github.com/russross/codegrinder/rpc"
	"github.com/spf13/cobra"
)

func CommandStudent(cmd *cobra.Command, args []string) {
	client, conn, ctx, _, err := setup(cmd)
	if err != nil {
		log.Fatalf("failed to connect to gRPC server: %s", cleanError(err))
	}
	defer conn.Close()

	// parse parameters
	if len(args) == 0 {
		log.Printf("you must specify the assignment to download")
		log.Printf("   either give the student's assignment number")
		log.Printf("   or give search terms to find the assignment")
		log.Printf("   where terms search assignment name, course name,")
		log.Printf("   problem set name, problem set tags, user name, and user email")
		log.Fatalf("   e.g.: '%s student alice loops'", os.Args[0])
	}

	// special case: user gave us an assignment number
	if id, err := strconv.Atoi(args[0]); len(args) == 1 && err == nil && id > 0 {
		downloadStudentAssignment(int64(id), nil, client, ctx)
		return
	}

	// search for matching assignments
	searchTerms := args
	dumpMessage("GetAssignments", true, &GetAssignmentsRequest{Search: searchTerms})
	assignmentsResp, err := client.GetAssignments(ctx, &GetAssignmentsRequest{Search: searchTerms})
	if err != nil {
		log.Fatalf("failed to get assignments: %s", cleanError(err))
	}
	dumpMessage("GetAssignments", false, assignmentsResp)
	assignments := assignmentsResp.Assignments
	if len(assignments) == 0 {
		log.Fatalf("no assignments found matching the terms you gave")
	}
	sort.Slice(assignments, func(i, j int) bool {
		if assignments[i].UserId != assignments[j].UserId {
			return assignments[i].UserId < assignments[j].UserId
		}
		return assignments[i].UpdatedAt.AsTime().Before(assignments[j].UpdatedAt.AsTime())
	})

	// gather related objects and find max lengths for pretty printing
	users := make(map[int64]*User)
	courses := make(map[int64]*Course)
	longestID, longestName := 1, 1
	for _, asst := range assignments {
		if users[asst.UserId] == nil {
			dumpMessage("GetUser", true, &GetUserRequest{UserId: asst.UserId})
			userResp, err := client.GetUser(ctx, &GetUserRequest{UserId: asst.UserId})
			if err != nil {
				log.Fatalf("failed to get user: %s", cleanError(err))
			}
			dumpMessage("GetUser", false, userResp)
			users[asst.UserId] = userResp.User
		}
		if courses[asst.CourseId] == nil {
			dumpMessage("GetCourse", true, &GetCourseRequest{CourseId: asst.CourseId})
			courseResp, err := client.GetCourse(ctx, &GetCourseRequest{CourseId: asst.CourseId})
			if err != nil {
				log.Fatalf("failed to get course: %s", cleanError(err))
			}
			dumpMessage("GetCourse", false, courseResp)
			courses[asst.CourseId] = courseResp.Course
		}
		if n := len(strconv.FormatInt(asst.Id, 10)); n > longestID {
			longestID = n
		}
		if n := len(asst.CanvasTitle); n > longestName {
			longestName = n
		}
	}

	// print out the results in a table
	prevUserId := int64(0)
	for _, asst := range assignments {
		user := users[asst.UserId]
		if user.Id != prevUserId {
			if prevUserId != 0 {
				fmt.Println()
			}
			prevUserId = user.Id
			fmt.Printf("%s (%s)\n", user.Name, user.Email)
			fmt.Println(dashes(len(user.Name) + len(user.Email) + len(" ()")))
		}

		fmt.Printf("id:%-*d %-*s %3.0f%% (%s)  [%s]\n", longestID, asst.Id, longestName, asst.CanvasTitle, asst.Score*100.0, courses[asst.CourseId].Name, asst.UpdatedAt.AsTime().Format(time.RFC822))
	}
	fmt.Println()

	if len(users) == 1 {
		mostRecent := assignments[len(assignments)-1]
		downloadStudentAssignment(mostRecent.Id, mostRecent, client, ctx)
	} else {
		log.Printf("the search found assignments for more than one user")
		log.Printf("   either pick the correct assignment id from the list")
		log.Printf("   and run '%s student [id]'", os.Args[0])
		log.Printf("   or repeat the search with additional terms")
		log.Fatalf("   to narrow the results")
	}
}

func downloadStudentAssignment(id int64, assignment *Assignment, client CodeGrinderServiceClient, ctx context.Context) {

	// look it up by ID
	if assignment == nil {
		dumpMessage("GetAssignment", true, &GetAssignmentRequest{AssignmentId: id})
		assignmentResp, err := client.GetAssignment(ctx, &GetAssignmentRequest{AssignmentId: id})
		if err != nil {
			log.Fatalf("failed to get assignment: %s", cleanError(err))
		}
		dumpMessage("GetAssignment", false, assignmentResp)
		assignment = assignmentResp.Assignment
	}
	dumpMessage("GetUser", true, &GetUserRequest{UserId: assignment.UserId})
	userResp, err := client.GetUser(ctx, &GetUserRequest{UserId: assignment.UserId})
	if err != nil {
		log.Fatalf("failed to get user: %s", cleanError(err))
	}
	dumpMessage("GetUser", false, userResp)
	user := userResp.User
	fmt.Printf("[%s] asst %d @ %.0f%% '%s'\n", user.Name, assignment.Id, assignment.Score*100.0, assignment.CanvasTitle)

	rootDir := filepath.Join(os.TempDir(), fmt.Sprintf("grind-tmp.%d", os.Getpid()))
	if err := os.Mkdir(rootDir, 0700); err != nil {
		log.Fatalf("error creating temp directory %s: %v", rootDir, err)
	}
	defer func() {
		fmt.Printf("deleting %s\n", rootDir)
		os.RemoveAll(rootDir)
	}()
	changeTo := getAssignment(assignment, rootDir, rootDir, client, ctx)
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}
	fmt.Println("exit shell when finished")
	attr := &os.ProcAttr{
		Dir:   changeTo,
		Files: []*os.File{os.Stdin, os.Stdout, os.Stderr},
	}
	proc, err := os.StartProcess(shell, []string{shell}, attr)
	if err != nil {
		log.Fatalf("error launching shell: %s", cleanError(err))
	}
	if _, err := proc.Wait(); err != nil {
		log.Fatalf("error waiting for shell to terminate: %s", cleanError(err))
	}
}
