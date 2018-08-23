package main

import (
	"io"
	"log"
)

func init() {
	problemTypeHandlers["nand2tetris"] = map[string]nannyHandler{
		"grade": nannyHandler(nand2tetrisGrade),
		"test":  nannyHandler(nand2tetrisTest),
	}
}

func nand2tetrisGrade(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("nand2tetris grade")
	runAndParseXUnit(n, []string{"make", "grade"}, nil, "test_detail.xml")
}

func nand2tetrisTest(n *Nanny, args, options []string, files map[string][]byte, stdin io.Reader) {
	log.Printf("nand2tetris test")
	n.ExecSimple([]string{"make", "test"}, stdin, true)
}
