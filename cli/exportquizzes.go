package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	. "github.com/russross/codegrinder/types"
	"github.com/spf13/cobra"
)

func CommandExportQuizzes(cmd *cobra.Command, args []string) {
	mustLoadConfig(cmd)

	if len(args) == 0 {
		cmd.Help()
		os.Exit(1)
	} else if len(args) > 1 {
		log.Printf("you must specify the assignment with quizzes to export")
		log.Printf("   run '%s list' to see your assignments", os.Args[0])
		log.Printf("   you must give the assignment number (displayed on the left of the list)")
	}
	name := args[0]

	user := new(User)
	mustGetObject("/users/me", nil, user)

	var assignment *Assignment
	if id, err := strconv.Atoi(name); err == nil && id > 0 {
		// look it up by ID
		assignment = new(Assignment)
		mustGetObject(fmt.Sprintf("/assignments/%d", id), nil, assignment)
		if assignment.ProblemSetID > 0 {
			log.Fatalf("cannot download non-quiz assignments")
		}
	} else {
		log.Fatalf("you must specify the ID of the assignment with quizzes to export")
	}
	if assignment.UserID != user.ID {
		log.Fatalf("you do not have an assignment with number %d", assignment.ID)
	}

	// fetch the quizzes
	var quizzes []*Quiz
	mustGetObject(fmt.Sprintf("/assignments/%d/quizzes", assignment.ID), nil, &quizzes)
	if len(quizzes) == 0 {
		log.Fatalf("no quizzes found to export")
	}

	if len(quizzes) == 1 {
		log.Printf("found 1 quiz")
	} else {
		log.Printf("found %d quizzes", len(quizzes))
	}

	// get the course
	course := new(Course)
	mustGetObject(fmt.Sprintf("/courses/%d", assignment.CourseID), nil, course)

	basicCharsOnly := func(r rune) rune {
		if r >= 'a' && r <= 'z' ||
			r >= 'A' && r <= 'Z' ||
			r >= '0' && r <= '9' ||
			r == '_' || r == '-' || r == ':' {
			return r
		}
		return '_'
	}

	dirName := strings.Map(basicCharsOnly, fmt.Sprintf("%s--%s", course.Name, assignment.CanvasTitle))
	log.Printf("creating a directory for export: %s", dirName)
	if err := os.Mkdir(dirName, 0755); err != nil {
		log.Fatalf("creating directory %s: %v", dirName, err)
	}

	// export quizzes one at a time
	for _, quiz := range quizzes {
		note := quiz.Note
		if i := strings.Index(note, "\n"); i > 0 {
			note = note[:i]
		}
		quizPrefix := strings.Map(basicCharsOnly, fmt.Sprintf("%s--%s", quiz.CreatedAt.Format("2006-01-02T15:04"), note))
		quizPrefix = strings.ReplaceAll(quizPrefix, "__", "_")
		quizPrefix = strings.ReplaceAll(quizPrefix, "__", "_")
		if strings.HasSuffix(quizPrefix, "_") {
			quizPrefix = quizPrefix[:len(quizPrefix)-1]
		}
		log.Printf("exporting quiz created on %s as %s.json", quiz.CreatedAt.Format("2006-01-02T15:04"), quizPrefix)
		raw, err := json.MarshalIndent(quiz, "", "    ")
		if err != nil {
			log.Fatalf("json encoding quiz: %v", err)
		}
		raw = append(raw, '\n')
		if err := ioutil.WriteFile(filepath.Join(dirName, quizPrefix+".json"), raw, 0644); err != nil {
			log.Fatalf("writing quiz file: %v", err)
		}

		var questions []*Question
		mustGetObject(fmt.Sprintf("/quizzes/%d/questions", quiz.ID), nil, &questions)
		for _, question := range questions {
			note := question.Note
			if i := strings.Index(note, "\n"); i > 0 {
				note = note[:i]
			}
			questionName := strings.Map(basicCharsOnly, fmt.Sprintf("%s--%02d:%s", quizPrefix, question.Number, note))
			questionName = strings.ReplaceAll(questionName, "__", "_")
			questionName = strings.ReplaceAll(questionName, "__", "_")
			if strings.HasSuffix(questionName, "_") {
				questionName = questionName[:len(questionName)-1]
			}

			log.Printf("    writing question %s.json", questionName)
			raw, err := json.MarshalIndent(question, "", "    ")
			if err != nil {
				log.Fatalf("json encoding question: %v", err)
			}
			raw = append(raw, '\n')
			if err := ioutil.WriteFile(filepath.Join(dirName, questionName+".json"), raw, 0644); err != nil {
				log.Fatalf("writing question file: %v", err)
			}
		}
	}
}
