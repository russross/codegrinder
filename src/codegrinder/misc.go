package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

func mustMarshal(elt interface{}) []byte {
	raw, err := json.Marshal(elt)
	if err != nil {
		loge.Fatalf("json Marshal error for % #v", elt)
	}
	return raw
}

func fixLineEndings(s string) string {
	s = strings.Replace(s, "\r\n", "\n", -1) + "\n"
	for strings.Contains(s, " \n") {
		s = strings.Replace(s, " \n", "\n", -1)
	}
	for strings.HasSuffix(s, "\n\n") {
		s = s[:len(s)-1]
	}
	if s == "\n" {
		s = ""
	}
	return s
}

func fixNewLines(s string) string {
	s = strings.Replace(s, "\r\n", "\n", -1) + "\n"
	for strings.HasSuffix(s, "\n\n") {
		s = s[:len(s)-1]
	}
	if s == "\n" {
		s = ""
	}
	return s
}

func HTTPErrorf(w http.ResponseWriter, status int, format string, params ...interface{}) error {
	msg := fmt.Sprintf(format, params...)
	http.Error(w, msg, status)
	return errors.New(msg)
}

func loggedErrorf(f string, params ...interface{}) error {
	loge.Printf(f, params...)
	return fmt.Errorf(f, params...)
}

func intContains(lst []int, n int) bool {
	for _, elt := range lst {
		if elt == n {
			return true
		}
	}
	return false
}
