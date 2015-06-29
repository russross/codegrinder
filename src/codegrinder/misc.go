package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"runtime"
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

func loggedHTTPErrorf(w http.ResponseWriter, status int, format string, params ...interface{}) {
	msg := fmt.Sprintf(format, params...)
	loge.Print(logPrefix() + msg)
	http.Error(w, msg, status)
}

func loggedErrorf(f string, params ...interface{}) error {
	loge.Print(logPrefix() + fmt.Sprintf(f, params...))
	return fmt.Errorf(f, params...)
}

func logPrefix() string {
	prefix := ""
	if _, file, line, ok := runtime.Caller(2); ok {
		short := file
		for i := len(file) - 1; i > 0; i-- {
			if file[i] == '/' {
				short = file[i+1:]
				break
			}
		}
		file = short
		prefix = fmt.Sprintf("%s:%d: ", file, line)
	}
	return prefix
}

func intContains(lst []int, n int) bool {
	for _, elt := range lst {
		if elt == n {
			return true
		}
	}
	return false
}
