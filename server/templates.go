package main

import (
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/go-martini/martini"
	"github.com/martini-contrib/render"
)

type FileResponse struct {
	Filename string `json:"filename"`
	Content  []byte `json:"content"`
}

func SendTemplate(w http.ResponseWriter, params martini.Params, render render.Render) {
	testType := params["test_type"]

	templateFile, err := getTemplate(testType)
	if err != nil {
		log.Println("Error in SendTemplate: ", err)
		render.JSON(http.StatusNotFound, map[string]string{"error": "File not found"})
		return
	}

	raw, err := ioutil.ReadFile(templateFile)
	if err != nil {
		log.Println("Error reading file: ", err)
		render.JSON(http.StatusNotFound, map[string]string{"error": "Can't read file"})
		return
	}

	render.JSON(http.StatusOK, FileResponse{
		Filename: filepath.Base(templateFile),
		Content:  raw,
	})
}

func getTemplate(testType string) (string, error) {
	testTemplates := map[string]string{
		"python3unittest": "python3unittest/test_template.py",
	}

	template := testTemplates[testType]
	templateFile := filepath.Join(root, "files", template)
	_, err := os.Stat(templateFile)
	if err != nil {
		log.Printf("Unable to locate %s for %s", templateFile, testType)
		return "", err
	}
	return templateFile, nil
}
