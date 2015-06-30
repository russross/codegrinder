package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/codegangsta/cli"
)

const (
	defaultHost  = "dorking.cs.dixie.edu"
	cookiePrefix = "codegrinder_session="
	rcFile       = ".codegrinderrc"
)

var Config struct {
	Cookie string
	Host   string
}

func main() {
	log.SetFlags(log.Ltime)
	app := cli.NewApp()
	app.Name = "grind"
	app.Usage = "command-line interface to codegrinder"
	app.Version = "0.0.1"
	app.Authors = []cli.Author{
		{Name: "Russ Ross", Email: "russ@russross.com"},
	}
	app.Commands = []cli.Command{
		{
			Name:   "init",
			Usage:  "connect to codegrinder server",
			Action: CommandInit,
		},
		{
			Name:   "list",
			Usage:  "list all of your active assignments",
			Action: CommandList,
		},
		{
			Name:   "get",
			Usage:  "download an assignment to work on it locally",
			Action: CommandGet,
		},
		{
			Name:   "save",
			Usage:  "save your work to the server without additional action",
			Action: CommandSave,
		},
		{
			Name:   "create",
			Usage:  "create a new problem (instructors only)",
			Action: CommandCreate,
			Flags: []cli.Flag{
				cli.BoolFlag{Name: "update", Usage: "update an existing problem"},
			},
		},
	}
	app.Run(os.Args)
}

func CommandInit(context *cli.Context) {
	fmt.Println(
		`Please follow these steps:

1.  Use Canvas to load a CodeGrinder window

2.  Open a new tab in your browser and copy this URL into the address bar:

    https://` + defaultHost + `/api/v2/users/me/cookie

3.  The browser will display something of the form:

    ` + cookiePrefix + `...

4.  Copy that entire string to the clipboard and paste it below.

Paste here: `)

	var cookie string
	n, err := fmt.Scanln(&cookie)
	if err != nil {
		log.Fatalf("error encountered while reading the cookie you pasted: %v\n", err)
	}
	if n != 1 {
		log.Fatalf("failed to read the cookie you pasted; please try again\n")
	}
	if !strings.HasPrefix(cookie, cookiePrefix) {
		log.Fatalf("the cookie must start with %s; perhaps you copied the wrong thing?\n", cookiePrefix)
	}

	// set up config
	Config.Cookie = cookie
	Config.Host = defaultHost

	// try it out by fetching a user record
	user := new(User)
	mustGetObject("/users/me", nil, user)

	// save config for later use
	mustWriteConfig()

	log.Printf("cookie verified and saved: welcome %s", user.Name)
}

func mustGetObject(path string, params map[string]string, download interface{}) {
	doRequest(path, params, Config.Cookie, "GET", nil, download, false)
}

func getObject(path string, params map[string]string, download interface{}) bool {
	return doRequest(path, params, Config.Cookie, "GET", nil, download, true)
}

func mustPostObject(path string, params map[string]string, upload interface{}, download interface{}) {
	doRequest(path, params, Config.Cookie, "POST", upload, download, false)
}

func mustPutObject(path string, params map[string]string, upload interface{}, download interface{}) {
	doRequest(path, params, Config.Cookie, "PUT", upload, download, false)
}

func doRequest(path string, params map[string]string, cookie string, method string, upload interface{}, download interface{}, notfoundokay bool) bool {
	if !strings.HasPrefix(path, "/") {
		log.Panicf("doRequest path must start with /")
	}
	if method != "GET" && method != "POST" && method != "PUT" && method != "DELETE" {
		log.Panicf("doRequest only recognizes GET, POST, PUT, and DELETE methods")
	}
	req, err := http.NewRequest(method, fmt.Sprintf("https://%s/api/v2%s", Config.Host, path), nil)
	if err != nil {
		log.Fatalf("error creating http request: %v\n", err)
	}

	// add any parameters
	if params != nil && len(params) > 0 {
		values := req.URL.Query()
		for key, value := range params {
			values.Add(key, value)
		}
		req.URL.RawQuery = values.Encode()
	}

	// set the headers
	req.Header["Accept"] = []string{"application/json"}
	req.Header["Cookie"] = []string{cookie}

	// upload the payload if any
	if upload != nil && (method == "POST" || method == "PUT") {
		req.Header["Content-Type"] = []string{"application/json"}
		payload, err := json.MarshalIndent(upload, "", "    ")
		if err != nil {
			log.Fatalf("mustPostObject: JSON error encoding object to upload: %v", err)
		}
		req.Body = ioutil.NopCloser(bytes.NewReader(payload))
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Fatalf("error connecting to %s: %v\n", Config.Host, err)
	}
	defer resp.Body.Close()
	if notfoundokay && resp.StatusCode == http.StatusNotFound {
		return false
	}
	if resp.StatusCode != http.StatusOK {
		log.Printf("unexpected status from %s: %s\n", Config.Host, resp.Status)
		io.Copy(os.Stderr, resp.Body)
		log.Fatalf("giving up")
	}

	// parse the result if any
	if download != nil {
		decoder := json.NewDecoder(resp.Body)
		if err := decoder.Decode(download); err != nil {
			log.Fatalf("failed to parse result object from server: %v\n", err)
		}
		return true
	}
	return false
}

func mustLoadConfig() {
	home := os.Getenv("HOME")
	if home == "" {
		home = os.Getenv("USERPROFILE")
	}
	if home == "" {
		log.Fatalf("Unable to locate home directory, giving up\n")
	}
	configFile := filepath.Join(home, rcFile)

	if raw, err := ioutil.ReadFile(configFile); err != nil {
		log.Fatalf("Unable to load config file; try running \"grind init\"\n")
	} else {
		if err := json.Unmarshal(raw, &Config); err != nil {
			log.Printf("failed to parse %s: %v", configFile, err)
			log.Fatalf("you may wish to try deleting the file and running \"grind init\" again\n")
		}
	}
}

func mustWriteConfig() {
	home := os.Getenv("HOME")
	if home == "" {
		home = os.Getenv("USERPROFILE")
	}
	if home == "" {
		log.Fatalf("Unable to locate home directory, giving up\n")
	}
	configFile := filepath.Join(home, rcFile)

	raw, err := json.MarshalIndent(&Config, "", "    ")
	if err != nil {
		log.Fatalf("JSON error encoding cookie file: %v", err)
	}
	raw = append(raw, '\n')

	if err = ioutil.WriteFile(configFile, raw, 0644); err != nil {
		log.Fatalf("error writing %s: %v", configFile, err)
	}
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}
