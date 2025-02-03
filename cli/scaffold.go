package main

import (
	"fmt"
	"log"
	"os"
	"strings"
	"text/template"

	"github.com/spf13/cobra"
)

type TemplateConfig struct {
	TestClassname  string
	ParamTypeHint  string
	ReturnTypeHint string
	FuncToTest     string
	ProblemType    string
	Filename       string
}

type FileResponse struct {
	Filename string `json:"filename"`
	Content  []byte `json:"content"`
}

func CommandScaffold(cmd *cobra.Command, args []string) {
	mustLoadConfig(cmd)

	if len(args) == 0 {
		cmd.Help()
		os.Exit(1)
	}

	if _, err := os.Stat(TestTmpl.Name); os.IsNotExist(err) {
		createProblemDir(args[0])
	}
}

func createProblemDir(assignment_name string) {
	name_parts := strings.Split(assignment_name, "-")
	name := name_parts[len(name_parts)-1]
	TestTmpl.ParsedName = name

	py_file := fmt.Sprintf("%s.py", name)
	starter_file := fmt.Sprintf("_starter/%s", py_file)
	test_file := fmt.Sprintf("tests/test_%s", py_file)
	dirs := []string{"_starter", "doc", "tests"}
	files := []string{"doc/doc.md", "problem.cfg", starter_file, test_file, py_file}

	for i := range dirs {
		dirs[i] = fmt.Sprintf("%s/%s", assignment_name, dirs[i])
	}
	for i := range files {
		files[i] = fmt.Sprintf("%s/%s", assignment_name, files[i])
	}

	os.Mkdir(assignment_name, 0755)
	for i := range dirs {
		os.Mkdir(dirs[i], 0755)
	}
	for i := range files {
		os.Create(files[i])
	}

	buildTemplate(assignment_name, test_file)

	problemCfg := fmt.Sprintf("%s/problem.cfg", assignment_name)
	fobj, err := os.OpenFile(problemCfg, os.O_WRONLY, 0644)
	if err != nil {
		log.Println("Error opening problem.cfg for writing: ", err)
		fobj.Close()
		os.Exit(1)
	}
	str := fmt.Sprintf("[problem]\ntype = %s\nunique = %s\nnote = \ntag = \n", TestTmpl.ProblemType, assignment_name)
	_, err = fobj.WriteString(str)
	if err != nil {
		log.Println("error writing to problem.cfg: ", err)
		fobj.Close()
		os.Exit(1)
	}
	fobj.Close()
}

func buildTemplate(dir string, test_name string) {
	templateName, err := getTemplateFile(TestTmpl.ProblemType)
	if err != nil {
		log.Println("Error getting template: ", err)
		return
	}
	classTemplateContent, _ := os.ReadFile(templateName)
	classTemplate, _ := template.New("class").Parse(string(classTemplateContent))

	test_file := fmt.Sprintf("%s/%s", dir, test_name)
	outputFile, err := os.Create(test_file)
	if err != nil {
		log.Println("Error with outputFile ", err)
		outputFile.Close()
		os.Exit(1)
	}
	defer outputFile.Close()

	classData := map[string]string{
		"FileName":       TestTmpl.ParsedName,
		"TestClassName":  TestTmpl.Name,
		"ParamTypeHint":  TestTmpl.ParamType,
		"ReturnTypeHint": TestTmpl.ReturnType,
		"FuncToTest":     TestTmpl.FuncToTest,
	}

	_ = classTemplate.Execute(outputFile, classData)
}

func getTemplateFile(problemType string) (string, error) {
	var response FileResponse
	path := fmt.Sprintf("/templates/%s", problemType)
	success := getObject(path, nil, &response)

	if !success {
		return "", fmt.Errorf("failed to retrieve template for %s", problemType)
	}

	err := os.WriteFile(response.Filename, response.Content, 0644)
	if err != nil {
		return "", fmt.Errorf("error saving file: %w", err)
	}

	return response.Filename, nil
}
