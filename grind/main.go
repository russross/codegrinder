package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/blang/semver"
	. "github.com/russross/codegrinder/common"
	"github.com/spf13/cobra"
)

const (
	perUserDotFile       = ".codegrinderrc"
	instructorFile       = ".codegrinderinstructor"
	perProblemSetDotFile = ".grind"
	urlPrefix            = "/v2"
)

var Config struct {
	Host      string `json:"host"`
	Cookie    string `json:"cookie"`
	apiReport bool
	apiDump   bool
}

type DotFileInfo struct {
	AssignmentID int64                   `json:"assignmentID"`
	Problems     map[string]*ProblemInfo `json:"problems"`
	Path         string                  `json:"-"`
}

type ProblemInfo struct {
	ID        int64           `json:"id"`
	Step      int64           `json:"step"`
	Whitelist map[string]bool `json:"whitelist"`
}

func main() {
	isInstructor := hasInstructorFile()
	log.SetFlags(log.Ltime)

	cmdGrind := &cobra.Command{
		Use:   "grind",
		Short: "Command-line interface to CodeGrinder",
		Long: "A command-line tool to access CodeGrinder\n" +
			"by Russ Ross <russ@russross.com>",
	}
	if isInstructor {
		cmdGrind.PersistentFlags().BoolVarP(&Config.apiReport, "api", "", false, "report all API requests")
		cmdGrind.PersistentFlags().BoolVarP(&Config.apiDump, "api-dump", "", false, "dump API request and response data")
	}

	cmdVersion := &cobra.Command{
		Use:   "version",
		Short: "print the version number of grind",
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Println("grind " + CurrentVersion.Version)
		},
	}
	cmdGrind.AddCommand(cmdVersion)

	cmdLogin := &cobra.Command{
		Use:   "login <hostname> <sessionkey>",
		Short: "login to codegrinder server",
		Long: fmt.Sprintf("To log in, click on an assignment in Canvas and follow the\n"+
			"instructions; <hostname> and <sessionkey> will be listed there.\n\n"+
			"You should normally only need to do this once per semester.", os.Args[0]),
		Run: CommandLogin,
	}
	cmdGrind.AddCommand(cmdLogin)

	cmdList := &cobra.Command{
		Use:   "list",
		Short: "list all of your active assignments",
		Run:   CommandList,
	}
	cmdGrind.AddCommand(cmdList)

	cmdGet := &cobra.Command{
		Use:   "get <assignment id>",
		Short: "download an assignment to work on it locally",
		Long: fmt.Sprintf("Give either the numeric ID (given at the start of each listing)\n"+
			"or the course/problem identifier (given in parentheses).\n\n"+
			"Use '%s list' to see a list of assignments available to you.\n\n"+
			"The assignment will be stored in a directory matching the\n"+
			"course/problem name.\n\n"+
			"   Example: '%s get 342'\n\n"+
			"   Example: '%s get CS-1400/cs1400-loops'\n\n"+
			"Note: you must load an assignment through Canvas before you can access it.", os.Args[0], os.Args[0], os.Args[0]),
		Run: CommandGet,
	}
	cmdGrind.AddCommand(cmdGet)

	cmdSave := &cobra.Command{
		Use:   "save",
		Short: "save your work to the server without additional action",
		Run:   CommandSave,
	}
	cmdGrind.AddCommand(cmdSave)

	cmdGrade := &cobra.Command{
		Use:   "grade",
		Short: "save your work and submit it for grading",
		Run:   CommandGrade,
	}
	cmdGrind.AddCommand(cmdGrade)

	cmdAction := &cobra.Command{
		Use:   "action <action name>",
		Short: "launch a problem-type specific action",
		Long: fmt.Sprintf("Give the name of the action to be performed.\n"+
			"Run this with no action to see a list of valid actions.\n"+
			"Your code will be uploaded and the action initiated on the server.\n"+
			"You can interact with the server if appropriate for the action\n\n"+
			"   Example: '%s action debug'\n\n"+
			"Note: this has the side effect of saving your code.", os.Args[0]),
		Run: CommandAction,
	}
	cmdGrind.AddCommand(cmdAction)

	/*
		cmdReset := &cobra.Command{
			Use:   "reset",
			Short: "go back to the beginning of the current step",
			Long: fmt.Sprintf("When run without arguments, this shows which files have\n"+
				"been changed. If you name one or more files, it will revert them\n"+
				"to their state at the beginning of the current step.\n"+
				"Note: this saves your code before doing anything else, and any\n"+
				"changes occur only in your local file system. Until you perform\n"+
				"another action that forces a save (save, grade, action),\n"+
				"you can restore your files by deleting the directory and running\n"+
				"'%s get' to re-download your assignment.\n\n"+
				"   Example: '%s reset file1 file2'", os.Args[0], os.Args[0]),
			Run: CommandReset,
		}
		cmdGrind.AddCommand(cmdReset)
	*/

	if isInstructor {
		cmdCreate := &cobra.Command{
			Use:   "create [filename]",
			Short: "create a new problem/problem set (authors only)",
			Long: fmt.Sprintf("To create a problem, run without arguments in a problem directory.\n\n"+
				"   Example: '%s create'\n\n"+
				"To create a problem set, give the name of the .cfg file.\n\n"+
				"   Example: '%s create cs1400-problem-set.cfg'\n\n"+
				"Note: a problem set is automatically created with the same unique ID\n"+
				"when a new problem is created\n", os.Args[0], os.Args[0]),
			Run: CommandCreate,
		}
		cmdCreate.Flags().BoolP("update", "u", false, "update an existing problem/problem set")
		cmdCreate.Flags().StringP("action", "a", "", "run interactive action for problem step")
		cmdGrind.AddCommand(cmdCreate)

		cmdStudent := &cobra.Command{
			Use:   "student <search terms>",
			Short: "download a student assignment (instructors only)",
			Run:   CommandStudent,
		}
		cmdStudent.Flags().StringP("email", "e", "", "search by student email")
		cmdStudent.Flags().StringP("name", "n", "", "search by student name")
		cmdStudent.Flags().StringP("problem", "p", "", "search by problem set name")
		cmdStudent.Flags().StringP("course", "c", "", "search by course name")
		cmdGrind.AddCommand(cmdStudent)

		cmdProblem := &cobra.Command{
			Use:   "problem <search terms>",
			Short: "find a problem set URL (authors only)",
			Run:   CommandProblem,
		}
		cmdGrind.AddCommand(cmdProblem)
	}

	cmdGrind.Execute()
}

type LoginSession struct {
	Cookie string
}

func CommandLogin(cmd *cobra.Command, args []string) {
	if len(args) != 2 {
		fmt.Printf("To log in, click on an assignment in Canvas and follow the\n"+
			"instructions given. You should run a command of the form:\n\n"+
			"%s login <hostname> <sessionkey>\n\n"+
			"where <hostname> and <sessionkey> are given in the instructions.\n\n"+
			"You should normally only need to do this once per semester.\n\n", os.Args[0])

		log.Fatalf("Usage: %s login <hostname> <sessionkey>", os.Args[0])
	}
	hostname, key := args[0], args[1]
	Config.Host = hostname

	params := make(url.Values)
	params.Add("key", key)
	session := new(LoginSession)
	mustGetObject("/users/session", params, session)

	// set up config
	Config.Cookie = session.Cookie

	// see if they need an upgrade
	checkVersion()

	// try it out by fetching a user record
	user := new(User)
	mustGetObject("/users/me", nil, user)

	// save config for later use
	mustWriteConfig()

	log.Printf("login successful; welcome %s", user.Name)
}

func mustGetObject(path string, params url.Values, download interface{}) {
	doRequest(path, params, "GET", nil, download, false)
}

func getObject(path string, params url.Values, download interface{}) bool {
	return doRequest(path, params, "GET", nil, download, true)
}

func mustPostObject(path string, params url.Values, upload interface{}, download interface{}) {
	doRequest(path, params, "POST", upload, download, false)
}

func mustPutObject(path string, params url.Values, upload interface{}, download interface{}) {
	doRequest(path, params, "PUT", upload, download, false)
}

func doRequest(path string, params url.Values, method string, upload interface{}, download interface{}, notfoundokay bool) bool {
	if !strings.HasPrefix(path, "/") {
		log.Panicf("doRequest path must start with /")
	}
	if method != "GET" && method != "POST" && method != "PUT" && method != "DELETE" {
		log.Panicf("doRequest only recognizes GET, POST, PUT, and DELETE methods")
	}
	url := fmt.Sprintf("https://%s%s%s", Config.Host, urlPrefix, path)
	req, err := http.NewRequest(method, url, nil)
	if err != nil {
		log.Fatalf("error creating http request: %v\n", err)
	}

	// add any parameters
	if params != nil && len(params) > 0 {
		req.URL.RawQuery = params.Encode()
	}

	if Config.apiReport {
		log.Printf("%s %s", method, req.URL)
	}

	// set the headers
	req.Header.Add("Cookie", Config.Cookie)
	if download != nil {
		req.Header.Add("Accept", "application/json")
		req.Header.Add("Accept-Encoding", "gzip")
	}

	// upload the payload if any
	if upload != nil && (method == "POST" || method == "PUT") {
		req.Header.Add("Content-Type", "application/json")
		req.Header.Add("Content-Encoding", "gzip")
		payload := new(bytes.Buffer)
		gw := gzip.NewWriter(payload)
		jw := json.NewEncoder(gw)
		if err := jw.Encode(upload); err != nil {
			log.Fatalf("doRequest: JSON error encoding object to upload: %v", err)
		}
		if err := gw.Close(); err != nil {
			log.Fatalf("doRequest: gzip error encoding object to upload: %v", err)
		}
		req.Body = ioutil.NopCloser(payload)

		if Config.apiDump {
			log.Printf("Request data: %s", payload)
		}
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Fatalf("error connecting to %s: %v", Config.Host, err)
	}
	defer resp.Body.Close()
	if notfoundokay && resp.StatusCode == http.StatusNotFound {
		return false
	}
	if resp.StatusCode != http.StatusOK {
		log.Printf("unexpected status from %s: %s", url, resp.Status)
		dumpBody(resp)
		log.Fatalf("giving up")
	}

	// parse the result if any
	if download != nil {
		body := resp.Body
		if resp.Header.Get("Content-Encoding") == "gzip" {
			gz, err := gzip.NewReader(body)
			if err != nil {
				log.Fatalf("failed to decompress gzip result: %v", err)
			}
			body = gz
			defer gz.Close()
		}
		decoder := json.NewDecoder(body)
		if err := decoder.Decode(download); err != nil {
			log.Fatalf("failed to parse result object from server: %v", err)
		}

		if Config.apiDump {
			raw, err := json.MarshalIndent(download, "", "    ")
			if err != nil {
				log.Fatalf("doRequest: JSON error encoding downloaded object: %v", err)
			}
			log.Printf("Response data: %s", raw)
		}

		return true
	}
	return false
}

func hasInstructorFile() bool {
	home := os.Getenv("HOME")
	if home == "" {
		home = os.Getenv("USERPROFILE")
	}
	if home == "" {
		log.Fatalf("Unable to locate home directory, giving up\n")
	}
	_, err := os.Stat(filepath.Join(home, instructorFile))
	return err == nil
}

func mustLoadConfig(cmd *cobra.Command) {
	home := os.Getenv("HOME")
	if home == "" {
		home = os.Getenv("USERPROFILE")
	}
	if home == "" {
		log.Fatalf("Unable to locate home directory, giving up\n")
	}
	configFile := filepath.Join(home, perUserDotFile)

	if raw, err := ioutil.ReadFile(configFile); err != nil {
		log.Fatalf("Unable to load config file; try running '%s login'\n", os.Args[0])
	} else if err := json.Unmarshal(raw, &Config); err != nil {
		log.Printf("failed to parse %s: %v", configFile, err)
		log.Fatalf("you may wish to try deleting the file and running '%s login' again\n", os.Args[0])
	}
	if Config.apiDump {
		Config.apiReport = true
	}

	checkVersion()
}

func mustWriteConfig() {
	home := os.Getenv("HOME")
	if home == "" {
		home = os.Getenv("USERPROFILE")
	}
	if home == "" {
		log.Fatalf("Unable to locate home directory, giving up\n")
	}
	configFile := filepath.Join(home, perUserDotFile)

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

func checkVersion() {
	server := new(Version)
	mustGetObject("/version", nil, server)
	grindCurrent := semver.MustParse(CurrentVersion.Version)
	grindRequired := semver.MustParse(server.GrindVersionRequired)
	if grindRequired.GT(grindCurrent) {
		log.Printf("this is grind version %s, but the server requires %s or higher", CurrentVersion.Version, server.GrindVersionRequired)
		log.Fatalf("  you must upgrade to continue")
	}
	grindRecommended := semver.MustParse(server.GrindVersionRecommended)
	if grindRecommended.GT(grindCurrent) {
		log.Printf("this is grind version %s, but the server recommends %s or higher", CurrentVersion.Version, server.GrindVersionRecommended)
		log.Printf("  please upgrade as soon as possible")
	}
}

func dumpBody(resp *http.Response) {
	if resp.Body == nil {
		return
	}

	if resp.Header.Get("Content-Encoding") == "gzip" {
		gz, err := gzip.NewReader(resp.Body)
		if err != nil {
			log.Fatalf("failed to decompress gzip result: %v", err)
		}
		defer gz.Close()
		io.Copy(os.Stderr, gz)
	} else {
		io.Copy(os.Stderr, resp.Body)
	}
}
