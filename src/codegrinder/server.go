package main

import (
	"crypto/tls"
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"io/ioutil"
	"log"
	"log/syslog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/fsouza/go-dockerclient"
	"github.com/go-martini/martini"
	_ "github.com/lib/pq"
	"github.com/martini-contrib/binding"
	"github.com/martini-contrib/render"
	"github.com/martini-contrib/sessions"
	"github.com/russross/meddler"
)

// Config holds site-specific configuration data.
// Contains a mix of Daycare and main server parameters.
var Config struct {
	ToolName            string   // LTI human readable name: "CodeGrinder"
	ToolID              string   // LTI unique ID: "codegrinder"
	ToolDescription     string   // LTI description: "Programming exercises with grading"
	OAuthSharedSecret   string   // LTI authentication shared secret. Must match that given to Canvas course: "asdf..."
	PublicURL           string   // Base URL for the site: "https://your.host.goes.here"
	PublicWSURL         string   // Base URL for websockets: "wss://your.host.goes.here"
	HTTPAddress         string   // Address to bind on for HTTP connections: ":80"
	HTTPSAddress        string   // Address to bind on for HTTPS connections: ":443"
	CertFile            string   // Full path of TLS certificate file: "/etc/codegrinder/hostname.crt"
	KeyFile             string   // Full path of TLS key file: "/etc/codegrinder/hostname.key"
	StaticDir           string   // Full path of directory holding static files to serve: "/home/foo/codegrinder/client"
	SessionSecret       string   // Random string used to sign cookie sessions: "asdf..."
	DaycareSecret       string   // Random string used to sign daycare requests: "asdf..."
	PostgresHost        string   // Host parameter for Postgres: "/var/run/postgresql"
	PostgresPort        string   // Port parameter for Postgres: "5432"
	PostgresUsername    string   // Username parameter for Postgres: "codegrinder"
	PostgresPassword    string   // Password parameter for Postgres: "super$trong"
	PostgresDatabase    string   // Database parameter for Postgres: "codegrinder"
	AdministratorEmails []string // list of email addresses of administrators: [ "foo@bar.com", "baz@goo.edu" ]
}

var problemTypes = make(map[string]*ProblemTypeDefinition)
var loge, logi, logd *log.Logger

func main() {
	// parse command line
	var configFile string
	flag.StringVar(&configFile, "config", "config.json", "Name of the config file")
	var secretary, daycare bool
	flag.BoolVar(&secretary, "secretary", true, "Serve the secretary role")
	flag.BoolVar(&daycare, "daycare", true, "Serve the daycare role")
	var useSyslog bool
	flag.BoolVar(&useSyslog, "usesyslog", false, "Send logs to syslog")
	flag.Parse()

	if !secretary && !daycare {
		log.Fatalf("must run at least one role (secretary/daycare)")
	}

	// load config
	if raw, err := ioutil.ReadFile(configFile); err != nil {
		log.Fatalf("failed to load config file %q: %v", configFile, err)
	} else {
		if err := json.Unmarshal(raw, &Config); err != nil {
			log.Fatalf("failed to parse config file: %v", err)
		}
	}

	// set up logging
	setupLogging("codegrinder", useSyslog)

	// set up martini
	r := martini.NewRouter()
	m := martini.New()
	m.Use(martini.Logger())
	m.Use(martini.Recovery())
	m.Use(martini.Static(Config.StaticDir, martini.StaticOptions{SkipLogging: true}))
	m.MapTo(r, (*martini.Routes)(nil))
	m.Action(r.Handle)

	m.Map(logi)
	m.Use(render.Renderer(render.Options{IndentJSON: true}))
	m.Use(sessions.Sessions("codegrinder_session", sessions.NewCookieStore([]byte(Config.SessionSecret))))

	// set up secretary role
	if secretary {
		// set up the database
		db := setupDB(Config.PostgresHost, Config.PostgresPort, Config.PostgresUsername, Config.PostgresPassword, Config.PostgresDatabase)

		// martini service: wrap handler in a transaction
		withTx := func(c martini.Context, w http.ResponseWriter) {
			// start a transaction
			tx, err := db.Begin()
			if err != nil {
				loggedHTTPErrorf(w, http.StatusInternalServerError, "db error starting transaction: %v", err)
				return
			}

			// pass it on to the main handler
			c.Map(tx)
			c.Next()

			// was it a successful result?
			rw := w.(martini.ResponseWriter)
			if rw.Status() < http.StatusBadRequest {
				// commit the transaction
				if err := tx.Commit(); err != nil {
					loggedHTTPErrorf(w, http.StatusInternalServerError, "db error committing transaction: %v", err)
					return
				}
			} else {
				// rollback
				logd.Printf("rolling back transaction")
				if err := tx.Rollback(); err != nil {
					loggedHTTPErrorf(w, http.StatusInternalServerError, "db error rolling back transaction: %v", err)
					return
				}
			}
		}

		// martini service: to require an active logged-in session
		auth := func(w http.ResponseWriter, session sessions.Session) {
			if userID := session.Get("user_id"); userID == nil {
				loggedHTTPErrorf(w, http.StatusUnauthorized, "authentication: no user_id found in session")
				return
			}
		}

		// martini service: include the current logged-in user (requires withTx and auth)
		withCurrentUser := func(c martini.Context, w http.ResponseWriter, tx *sql.Tx, session sessions.Session) {
			rawID := session.Get("user_id")
			if rawID == nil {
				loggedHTTPErrorf(w, http.StatusInternalServerError, "cannot find user ID in session")
				return
			}
			userID, ok := rawID.(int)
			if !ok {
				session.Clear()
				loggedHTTPErrorf(w, http.StatusInternalServerError, "error extracting user ID from session")
				return
			}

			// load the user record
			user := new(User)
			if err := meddler.Load(tx, "users", user, int64(userID)); err != nil {
				if err == sql.ErrNoRows {
					loggedHTTPErrorf(w, http.StatusUnauthorized, "user %d not found", userID)
					return
				}
				loggedHTTPErrorf(w, http.StatusInternalServerError, "db error loading user")
				return
			}

			// map the current user to the request context
			c.Map(user)
		}

		// martini service: require logged in user to be an instructor or administrator (requires withCurrentUser)
		instructorOnly := func(w http.ResponseWriter, tx *sql.Tx, currentUser *User) {
			if currentUser.isAdministrator() {
				return
			}
			if instructor, err := currentUser.isInstructor(tx); err != nil {
				loggedHTTPErrorf(w, http.StatusInternalServerError, "db error checking if user %d (%s) is an instructor: %v", currentUser.ID, currentUser.Email, err)
				return
			} else if !instructor {
				loggedHTTPErrorf(w, http.StatusUnauthorized, "user %d (%s) is not an instructor", currentUser.ID, currentUser.Email)
				return
			}
		}

		// martini service: require logged in user to be an administrator (requires withCurrentUser)
		administratorOnly := func(w http.ResponseWriter, currentUser *User) {
			if !currentUser.isAdministrator() {
				loggedHTTPErrorf(w, http.StatusUnauthorized, "user %d (%s) is not an administrator", currentUser.ID, currentUser.Email)
				return
			}
		}

		// LTI
		r.Get("/lti/config.xml", GetConfigXML)
		r.Post("/lti/problems", binding.Bind(LTIRequest{}), checkOAuthSignature, withTx, LtiProblems)
		r.Post("/lti/problems/:unique", binding.Bind(LTIRequest{}), checkOAuthSignature, withTx, LtiProblem)

		// problem types
		r.Get("/api/v2/problemtypes", auth, GetProblemTypes)
		r.Get("/api/v2/problemtypes/:name", auth, GetProblemType)

		// problems
		r.Get("/api/v2/problems", auth, withTx, withCurrentUser, instructorOnly, GetProblems)
		r.Get("/api/v2/problems/:problem_id", auth, withTx, GetProblem)
		r.Post("/api/v2/problems", auth, withTx, withCurrentUser, instructorOnly, binding.Json(Problem{}), PostProblem)
		r.Post("/api/v2/problems/unconfirmed", auth, withTx, withCurrentUser, instructorOnly, binding.Json(Problem{}), PostProblemUnconfirmed)
		r.Put("/api/v2/problems/:problem_id", auth, withTx, withCurrentUser, instructorOnly, binding.Json(Problem{}), PutProblem)
		r.Delete("/api/v2/problems/:problem_id", auth, withTx, withCurrentUser, administratorOnly, DeleteProblem)

		// courses
		r.Get("/api/v2/courses", auth, withTx, GetCourses)
		r.Get("/api/v2/courses/:course_id", auth, withTx, GetCourse)
		r.Delete("/api/v2/courses/:course_id", auth, withTx, withCurrentUser, administratorOnly, DeleteCourse)

		// users
		r.Get("/api/v2/users", auth, withTx, withCurrentUser, instructorOnly, GetUsers)
		r.Get("/api/v2/users/me", auth, withTx, withCurrentUser, GetUserMe)
		r.Get("/api/v2/users/:user_id", auth, withTx, withCurrentUser, instructorOnly, GetUser)
		r.Get("/api/v2/courses/:course_id/users", auth, withTx, withCurrentUser, instructorOnly, GetCourseUsers)
		r.Delete("/api/v2/users/:user_id", auth, withTx, withCurrentUser, administratorOnly, DeleteUser)
		r.Get("/api/v2/users/me/cookie", auth, func(w http.ResponseWriter, r *http.Request) {
			cookie := r.Header.Get("Cookie")
			for _, field := range strings.Fields(cookie) {
				if strings.HasPrefix(field, "codegrinder_session=") {
					fmt.Fprintf(w, "%s", field)
				}
			}
		})

		// assignments
		r.Get("/api/v2/users/me/assignments", auth, withTx, withCurrentUser, GetMeAssignments)
		r.Get("/api/v2/users/me/assignments/:assignment_id", auth, withTx, withCurrentUser, GetMeAssignment)
		r.Get("/api/v2/users/:user_id/assignments", auth, withTx, withCurrentUser, instructorOnly, GetUserAssignments)
		r.Get("/api/v2/users/:user_id/assignments/:assignment_id", auth, withTx, withCurrentUser, instructorOnly, GetUserAssignment)
		r.Delete("/api/v2/users/:user_id/assignments/:assignment_id", auth, withTx, withCurrentUser, administratorOnly, DeleteUserAssignment)

		// commits
		r.Get("/api/v2/users/me/assignments/:assignment_id/commits", auth, withTx, withCurrentUser, GetUserMeAssignmentCommits)
		r.Get("/api/v2/users/me/assignments/:assignment_id/commits/last", auth, withTx, withCurrentUser, GetUserMeAssignmentCommitLast)
		r.Get("/api/v2/users/me/assignments/:assignment_id/commits/:commit_id", auth, withTx, withCurrentUser, GetUserMeAssignmentCommit)
		r.Get("/api/v2/users/:user_id/assignments/:assignment_id/commits", auth, withTx, withCurrentUser, instructorOnly, GetUserAssignmentCommits)
		r.Get("/api/v2/users/:user_id/assignments/:assignment_id/commits/last", auth, withTx, withCurrentUser, instructorOnly, GetUserAssignmentCommitLast)
		r.Get("/api/v2/users/:user_id/assignments/:assignment_id/commits/:commit_id", auth, withTx, withCurrentUser, instructorOnly, GetUserAssignmentCommit)
		r.Post("/api/v2/users/me/assignments/:assignment_id/commits", auth, withTx, withCurrentUser, binding.Json(Commit{}), PostUserAssignmentCommit)
		r.Delete("/api/v2/users/:user_id/assignments/:assignment_id/commits", auth, withTx, withCurrentUser, administratorOnly, DeleteUserAssignmentCommits)
		r.Delete("/api/v2/users/:user_id/assignments/:assignment_id/commits/:commit_id", auth, withTx, withCurrentUser, administratorOnly, DeleteUserAssignmentCommit)
	}

	// set up daycare role
	if daycare {
		// attach to docker and try a ping
		var err error
		dockerClient, err = docker.NewVersionedClient("unix:///var/run/docker.sock", "1.18")
		if err != nil {
			loge.Fatalf("NewVersionedClient: %v", err)
		}
		if err = dockerClient.Ping(); err != nil {
			loge.Fatalf("Ping: %v", err)
		}

		// arguments are passed as query arguments named "arg"
		r.Get("/api/v2/sockets/:problem_type/:action", SocketProblemTypeAction)
	}

	// start web server
	logi.Printf("starting http -> https forwarder")
	go http.ListenAndServe(Config.HTTPAddress, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// get the address of the client
		addr := r.Header.Get("X-Real-IP")
		if addr == "" {
			addr = r.Header.Get("X-Forwarded-For")
			if addr == "" {
				addr = r.RemoteAddr
			}
		}

		// make sure the request is for the right host name
		u, err := url.Parse(Config.PublicURL)
		if err != nil {
			loggedHTTPErrorf(w, http.StatusInternalServerError, "error parsing config.PublicURL: %v", err)
			return
		}
		if u.Host != r.Host {
			loggedHTTPErrorf(w, http.StatusNotFound, "http request to invalid host: %s", r.Host)
			return
		}
		u.Path = r.URL.Path
		logi.Printf("redirecting http request from %s to %s", addr, u.String())
		http.Redirect(w, r, u.String(), http.StatusMovedPermanently)
	}))

	logi.Printf("accepting https connections at %s", Config.HTTPSAddress)
	tls := &tls.Config{MinVersion: tls.VersionTLS10}
	server := &http.Server{Addr: Config.HTTPSAddress, Handler: m, TLSConfig: tls}
	if err := server.ListenAndServeTLS(Config.CertFile, Config.KeyFile); err != nil {
		loge.Fatalf("ListenAndServeTLS: %v", err)
	}
}

func setupLogging(tag string, useSyslog bool) {
	if useSyslog {
		f := func(priority syslog.Priority, prefix string, flags int) *log.Logger {
			s, err := syslog.New(priority, tag)
			if err != nil {
				loge.Fatalf("error setting up logger: %v", err)
			}
			return log.New(s, prefix, flags)
		}
		loge = log.New(os.Stderr, "[e] ", 0)
		loge = f(syslog.LOG_ERR, "[e] ", 0)
		logi = f(syslog.LOG_INFO, "[i] ", 0)
		logd = f(syslog.LOG_DEBUG, "[d] ", 0)
	} else {
		loge = log.New(os.Stderr, "[e] ", log.Ltime|log.Lmicroseconds)
		logi = log.New(os.Stderr, "[i] ", log.Ltime|log.Lmicroseconds)
		logd = log.New(os.Stderr, "[d] ", log.Ltime|log.Lmicroseconds)
	}
}

func setupDB(host, port, user, password, database string) *sql.DB {
	logi.Printf("connecting to database at host=%s port=%s", host, port)
	meddler.Default = meddler.PostgreSQL
	parts := []string{"sslmode=disable"}
	if host != "" {
		parts = append(parts, "host="+host)
	}
	if port != "" {
		parts = append(parts, "port="+port)
	}
	if database != "" {
		parts = append(parts, "dbname="+database)
	}
	if user != "" {
		parts = append(parts, "user="+user)
	}
	if password != "" {
		parts = append(parts, "password="+password)
	}

	pg := strings.Join(parts, " ")
	db, err := sql.Open("postgres", pg)
	if err != nil {
		delay := 5 * time.Second
		loge.Printf("error opening database: %v", err)
		time.Sleep(delay)
		loge.Fatalf("slept for %v", delay)
	}
	return db
}

func addWhereEq(where string, args []interface{}, label string, value interface{}) (string, []interface{}) {
	if where == "" {
		where = " WHERE"
	} else {
		where += " AND"
	}
	args = append(args, value)
	where += fmt.Sprintf(" %s = $%d", label, len(args))
	return where, args
}

func addWhereLike(where string, args []interface{}, label string, value string) (string, []interface{}) {
	if where == "" {
		where = " WHERE"
	} else {
		where += " AND"
	}
	args = append(args, "%"+strings.ToLower(value)+"%")
	where += fmt.Sprintf(" lower(%s) LIKE $%d", label, len(args))
	return where, args
}
