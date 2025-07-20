package main

import (
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"time"

	. "github.com/russross/codegrinder/types"
	"github.com/spf13/cobra"
)

func CommandStudent(cmd *cobra.Command, args []string) {
	mustLoadConfig(cmd)

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
		downloadStudentAssignment(int64(id), nil)
		return
	}

	// search for matching assignments
	assignments := []*Assignment{}
	params := make(url.Values)
	for _, term := range args {
		params.Add("search", term)
	}
	mustGetObject("/assignments", params, &assignments)
	if len(assignments) == 0 {
		log.Fatalf("no assignments found matching the terms you gave")
	}
	sort.Slice(assignments, func(i, j int) bool {
		if assignments[i].UserID != assignments[j].UserID {
			return assignments[i].UserID < assignments[j].UserID
		}
		return assignments[i].UpdatedAt.Before(assignments[j].UpdatedAt)
	})

	// gather related objects and find max lengths for pretty printing
	users := make(map[int64]*User)
	courses := make(map[int64]*Course)
	longestID, longestName := 1, 1
	for _, asst := range assignments {
		if users[asst.UserID] == nil {
			users[asst.UserID] = new(User)
			mustGetObject(fmt.Sprintf("/users/%d", asst.UserID), nil, users[asst.UserID])
		}
		if courses[asst.CourseID] == nil {
			courses[asst.CourseID] = new(Course)
			mustGetObject(fmt.Sprintf("/courses/%d", asst.CourseID), nil, courses[asst.CourseID])
		}
		if n := len(strconv.FormatInt(asst.ID, 10)); n > longestID {
			longestID = n
		}
		if n := len(asst.CanvasTitle); n > longestName {
			longestName = n
		}
	}

	// print out the results in a table
	prevUserID := int64(0)
	for _, asst := range assignments {
		user := users[asst.UserID]
		if user.ID != prevUserID {
			if prevUserID != 0 {
				fmt.Println()
			}
			prevUserID = user.ID
			fmt.Printf("%s (%s)\n", user.Name, user.Email)
			fmt.Println(dashes(len(user.Name) + len(user.Email) + len(" ()")))
		}

		fmt.Printf("id:%-*d %-*s %3.0f%% (%s)  [%s]\n", longestID, asst.ID, longestName, asst.CanvasTitle, asst.Score*100.0, courses[asst.CourseID].Name, asst.UpdatedAt.Format(time.RFC822))
	}
	fmt.Println()

	if len(users) == 1 {
		mostRecent := assignments[len(assignments)-1]
		downloadStudentAssignment(mostRecent.ID, mostRecent)
	} else {
		log.Printf("the search found assignments for more than one user")
		log.Printf("   either pick the correct assignment id from the list")
		log.Printf("   and run '%s student [id]'", os.Args[0])
		log.Printf("   or repeat the search with additional terms")
		log.Fatalf("   to narrow the results")
	}
}

func downloadStudentAssignment(id int64, assignment *Assignment) {
	// look it up by ID
	if assignment == nil {
		assignment = new(Assignment)
		mustGetObject(fmt.Sprintf("/assignments/%d", id), nil, assignment)
	}
	user := new(User)
	mustGetObject(fmt.Sprintf("/users/%d", assignment.UserID), nil, user)
	fmt.Printf("[%s] asst %d @ %.0f%% '%s'\n", user.Name, assignment.ID, assignment.Score*100.0, assignment.CanvasTitle)

	rootDir := filepath.Join(os.TempDir(), fmt.Sprintf("grind-tmp.%d", os.Getpid()))
	if err := os.Mkdir(rootDir, 0700); err != nil {
		log.Fatalf("error creating temp directory %s: %v", rootDir, err)
	}
	defer func() {
		fmt.Printf("deleting %s\n", rootDir)
		os.RemoveAll(rootDir)
	}()
	changeTo := getAssignment(assignment, rootDir, rootDir)
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
		log.Fatalf("error launching shell: %v", err)
	}
	if _, err := proc.Wait(); err != nil {
		log.Fatalf("error waiting for shell to terminate: %v", err)
	}
}
