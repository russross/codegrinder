package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"regexp"

	"github.com/blang/semver"
	. "github.com/russross/codegrinder/rpc"
	"github.com/russross/codegrinder/types"
	"github.com/spf13/cobra"
	"google.golang.org/grpc"
)

const (
	perUserDotFile       = ".codegrinderrc"
	instructorFile       = ".codegrinderinstructor"
	perProblemSetDotFile = ".grind"
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
	ID   int64 `json:"id"`
	Step int64 `json:"step"`
}

func main() {
	isInstructor := hasInstructorFile()
	log.SetFlags(0)

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
			fmt.Println("grind " + types.CurrentVersion.Version)
		},
	}
	cmdGrind.AddCommand(cmdVersion)

	cmdLogin := &cobra.Command{
		Use:   "login <hostname> <sessionkey>",
		Short: "login to codegrinder server",
		Long: fmt.Sprintf("To log in, click on an assignment in Canvas and follow the\n" +
			"instructions; <hostname> and <sessionkey> will be listed there.\n\n" +
			"You should normally only need to do this once per semester."),
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
		Use:   "get <assignment id> [assignment root directory]",
		Short: "download an assignment to work on it locally",
		Long: fmt.Sprintf("Give either the numeric ID (given at the start of each listing)\n"+
			"or the course/problem identifier (given in parentheses).\n\n"+
			"Use '%s list' to see a list of assignments available to you.\n\n"+
			"The assignment will be stored in a directory hierarchy with the\n"+
			"assignment root directory (your home directory by default)\n"+
			"followed by a course directory, then the assignment directories.\n\n"+
			"   Example: '%s get 342'\n\n"+
			"   Example: '%s get CS-1400/cs1400-loops'\n\n"+
			"Note: you must load an assignment through Canvas before you can access it.", os.Args[0], os.Args[0], os.Args[0]),
		Run: CommandGet,
	}
	cmdGrind.AddCommand(cmdGet)

	cmdSync := &cobra.Command{
		Use:   "sync",
		Short: "save your work to the server and update local problem files",
		Run:   CommandSync,
	}
	cmdGrind.AddCommand(cmdSync)

	cmdGrade := &cobra.Command{
		Use:   "grade",
		Short: "save your work and submit it for grading",
		Run:   CommandGrade,
	}
	cmdGrind.AddCommand(cmdGrade)

	cmdAction := &cobra.Command{
		Use:   "action <action name>",
		Short: "save your work and run an action on the server",
		Long: fmt.Sprintf("Give the name of the action to be performed.\n"+
			"Run this with no action to see a list of valid actions.\n"+
			"Your code will be uploaded and the action initiated on the server.\n"+
			"You can interact with the server if appropriate for the action\n\n"+
			"   Example: '%s action debug'\n\n"+
			"Note: this has the side effect of saving your code.", os.Args[0]),
		Run: CommandAction,
	}
	if isInstructor {
		cmdAction.Flags().String("daycare", "", "specify a daycare server to connect to directly (instructor only)")
	}
	cmdGrind.AddCommand(cmdAction)

	cmdReset := &cobra.Command{
		Use:   "reset [file1] [file2] [...]",
		Short: "go back to the beginning of the current step for specified files",
		Long: fmt.Sprintf("This lets you start the current step from the beginning\n" +
			"by deleting any changes you have made.\n\n" +
			"Files you have modified will be listed, and if you provide\n" +
			"a list of files they will be reset to their start-of-step state."),
		Run: CommandReset,
	}
	cmdGrind.AddCommand(cmdReset)

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
		cmdGrind.AddCommand(cmdStudent)

		cmdSolve := &cobra.Command{
			Use:   "solve",
			Short: "save the solution for the current problem step (authors only)",
			Run:   CommandSolve,
		}
		cmdGrind.AddCommand(cmdSolve)

		cmdProblem := &cobra.Command{
			Use:   "problem <search terms>",
			Short: "find a problem set URL (authors only)",
			Run:   CommandProblem,
		}
		cmdGrind.AddCommand(cmdProblem)

		cmdType := &cobra.Command{
			Use:   "type [<problem type>]",
			Short: "download files (Makefile, etc.) for a problem type (authors only)",
			Run:   CommandType,
		}
		cmdType.Flags().BoolP("remove", "r", false, "remove problem type files")
		cmdType.Flags().BoolP("list", "l", false, "list known problem types and then quit")
		cmdGrind.AddCommand(cmdType)
	}

	cmdGrind.Execute()
}

type LoginSession struct {
	Cookie string `json:"cookie"`
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

	// Set up gRPC connection
	client, conn, ctx, err := newGRPCClient()
	if err != nil {
		log.Fatalf("failed to connect to server: %v", err)
	}
	defer conn.Close()

	// Trade the session key for a cookie
	dumpMessage("GetUserSession", true, &GetUserSessionRequest{Key: key})
	sessionResp, err := client.GetUserSession(ctx, &GetUserSessionRequest{Key: key})
	if err != nil {
		log.Fatalf("failed to login: %v", err)
	}
	dumpMessage("GetUserSession", false, sessionResp)
	Config.Cookie = sessionResp.Cookie

	// Reconnect with the new cookie
	client, conn, ctx, err = newGRPCClient()
	if err != nil {
		log.Fatalf("failed to reconnect to server: %v", err)
	}
	defer conn.Close()

	// see if they need an upgrade
	checkVersion(client, ctx)

	// try it out by fetching a user record
	dumpMessage("GetUserMe", true, &GetUserMeRequest{})
	userResp, err := client.GetUserMe(ctx, &GetUserMeRequest{})
	if err != nil {
		log.Fatalf("failed to fetch user: %v", err)
	}
	dumpMessage("GetUserMe", false, userResp)
	user := userResp.User

	// save config for later use
	mustWriteConfig()

	fmt.Printf("login successful; welcome %s\n", user.Name)
}

func courseDirectory(label string) string {
	re := regexp.MustCompile(`^([A-Za-z]+[- ]*\d+\w*)\b`)
	groups := re.FindStringSubmatch(label)
	if len(groups) == 2 {
		return groups[1]
	}
	return label
}

func hasInstructorFile() bool {
	home, err := os.UserHomeDir()
	if err != nil {
		log.Fatalf("unable to find home directory: %v", err)
	}
	_, err = os.Stat(filepath.Join(home, instructorFile))
	return err == nil
}

func setup(cmd *cobra.Command) (CodeGrinderServiceClient, *grpc.ClientConn, context.Context, error) {
	// Load config
	home, err := os.UserHomeDir()
	if err != nil {
		log.Fatalf("unable to find home directory: %v", err)
	}
	if home == "" {
		log.Fatalf("home directory is not set")
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

	// Now create connection
	client, conn, ctx, err := newGRPCClient()
	if err != nil {
		return nil, nil, nil, err
	}

	// Check version
	checkVersion(client, ctx)

	return client, conn, ctx, nil
}

func mustWriteConfig() {
	home, err := os.UserHomeDir()
	if err != nil {
		log.Fatalf("unable to find home directory: %v", err)
	}
	if home == "" {
		log.Fatalf("home directory is not setn")
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

func checkVersion(client CodeGrinderServiceClient, ctx context.Context) {
	dumpMessage("GetVersion", true, &GetVersionRequest{})
	resp, err := client.GetVersion(ctx, &GetVersionRequest{})
	if err != nil {
		log.Fatalf("failed to get version from server: %v", err)
	}
	dumpMessage("GetVersion", false, resp)

	server := &Version{
		Version:                  resp.Version.Version,
		GrindVersionRequired:     resp.Version.GrindVersionRequired,
		GrindVersionRecommended:  resp.Version.GrindVersionRecommended,
		ThonnyVersionRequired:    resp.Version.ThonnyVersionRequired,
		ThonnyVersionRecommended: resp.Version.ThonnyVersionRecommended,
	}

	grindCurrent := semver.MustParse(types.CurrentVersion.Version)
	grindRequired := semver.MustParse(server.GrindVersionRequired)
	if grindRequired.GT(grindCurrent) {
		log.Printf("this is grind version %s, but the server requires %s or higher", types.CurrentVersion.Version, server.GrindVersionRequired)
		log.Fatalf("  you must upgrade to continue")
	}
	grindRecommended := semver.MustParse(server.GrindVersionRecommended)
	if grindRecommended.GT(grindCurrent) {
		log.Printf("this is grind version %s, but the server recommends %s or higher", types.CurrentVersion.Version, server.GrindVersionRecommended)
		log.Printf("  please upgrade as soon as possible")
	}
}
