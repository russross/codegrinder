package main

import (
	"database/sql"
	"encoding/json"
	"flag"
	"io/ioutil"
	"log"
	"log/syslog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/fsouza/go-dockerclient"
	"github.com/go-martini/martini"
	"github.com/gorilla/websocket"
	_ "github.com/lib/pq"
	"github.com/martini-contrib/binding"
	"github.com/martini-contrib/render"
	"github.com/martini-contrib/sessions"
	"github.com/russross/meddler"
)

type Action struct {
	Type  string
	Files map[string]string
}

var loge, logi, logd *log.Logger
var Config struct {
	ToolName          string
	ToolID            string
	ToolDescription   string
	OAuthSharedSecret string
	PublicURL         string
	StaticDir         string
	SessionSecret     string
	PostgresHost      string
	PostgresPort      string
	PostgresUsername  string
	PostgresPassword  string
	PostgresDatabase  string
}

type TransactionClosed bool

var problemTypes = make(map[string]*ProblemTypeDefinition)

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

		// martini service to wrap handlers in transactions
		transaction := func(c martini.Context, w http.ResponseWriter) {
			// start a transaction
			tx, err := db.Begin()
			if err != nil {
				loge.Print(HTTPErrorf(w, http.StatusInternalServerError, "db error starting transaction: %v", err))
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
					loge.Print(HTTPErrorf(w, http.StatusInternalServerError, "db error committing transaction: %v", err))
					return
				}
			} else {
				// rollback
				logd.Printf("rolling back transaction")
				if err := tx.Rollback(); err != nil {
					loge.Print(HTTPErrorf(w, http.StatusInternalServerError, "db error rolling back transaction: %v", err))
					return
				}
			}
		}

		authenticationRequired := func(w http.ResponseWriter, session sessions.Session) {
			if userID := session.Get("user_id"); userID == nil {
				logi.Printf("authentication: no user_id found in session")
				return
				w.WriteHeader(http.StatusUnauthorized)
			}
		}

		// LTI
		r.Get("/lti/config.xml", GetConfigXML)
		r.Post("/lti/problems", binding.Bind(LTIRequest{}), checkOAuthSignature, transaction, LtiProblems)
		r.Post("/lti/problems/:unique", binding.Bind(LTIRequest{}), checkOAuthSignature, transaction, LtiProblem)

		// problem types
		r.Get("/api/v2/problemtypes", authenticationRequired, GetProblemTypes)
		r.Get("/api/v2/problemtypes/:name", authenticationRequired, GetProblemType)

		// problems
		r.Get("/api/v2/problems", authenticationRequired, transaction, GetProblems)
		r.Get("/api/v2/problems/:problem_id", authenticationRequired, transaction, GetProblem)

		// problem steps
		//r.Get("/api/v2/problems/:problem_id/steps", authenticationRequired, transaction, GetProblemSteps)
		//r.Get("/api/v2/problems/:problem_id/steps/:step_id", authenticationRequired, transaction, GetProblemSteps)

		// courses
		//r.Get("/api/v2/courses", authenticationRequired, transaction, GetCourses)
		//r.Get("/api/v2/courses/:course_id", authenticationRequired, transaction, GetCourse)

		// users
		//r.Get("/api/v2/users", authenticationRequired, transaction, GetUsers)
		//r.Get("/api/v2/users/:user_id", authenticationRequired, transaction, GetUser)

		// assignments
		//r.Get("/api/v2/users/:user_id/assignments", authenticationRequired, transaction, GetAssignments)
		//r.Get("/api/v2/users/:user_id/assignments/:assignment_id", authenticationRequired, transaction, GetAssignment)

		// commits
		//r.Get("/api/v2/users/:user_id/assignments/:assignment_id/commits", authenticationRequired, transaction, GetCommits)
		//r.Get("/api/v2/users/:user_id/assignments/:assignment_id/commits/:commit_id", authenticationRequired, transaction, GetCommit)
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

		// set up a web handler
		r.Get("/api/v2/sockets/python2unittest", func(w http.ResponseWriter, r *http.Request) {
			// set up websocket
			socket, err := websocket.Upgrade(w, r, nil, 1024, 1024)
			if err != nil {
				loge.Printf("websocket error: %v", err)
				http.Error(w, "websocket error", http.StatusBadRequest)
				return
			}
			loge.Printf("websocket upgraded")

			// get the first message
			var action Action
			if err := socket.ReadJSON(&action); err != nil {
				loge.Printf("error reading Action message: %v", err)
				socket.Close()
				return
			}
			loge.Printf("read request: type = %s", action.Type)

			// launch a nanny process
			n, err := NewNanny("codegrinder/python2", "foo")
			if err != nil {
				loge.Fatalf("error creating nanny")
			}

			// start a listener
			finished := make(chan struct{})
			go func() {
				for event := range n.Events {
					// feed events back to client
					if err := socket.WriteJSON(event); err != nil {
						loge.Printf("error writing event JSON: %v", err)
					}
				}
				finished <- struct{}{}
			}()

			// grade the problem
			rc := NewReportCard()
			python2UnittestGrade(n, rc, nil, nil, action.Files)
			dump(rc)

			// shutdown the nanny
			if err := n.Shutdown(); err != nil {
				logi.Printf("nanny shutdown error: %v", err)
			}

			// wait for listener to finish
			close(n.Events)
			<-finished

			socket.Close()
		})
	}
	m.RunOnAddr(":8080")
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
		loge = f(syslog.LOG_ERR, "[e] ", log.Lshortfile)
		logi = f(syslog.LOG_INFO, "[i] ", 0)
		logd = f(syslog.LOG_DEBUG, "[d] ", 0)
	} else {
		loge = log.New(os.Stderr, "[e] ", log.Ltime|log.Lmicroseconds|log.Lshortfile)
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
