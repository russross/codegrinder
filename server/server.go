package main

import (
	"bytes"
	"compress/gzip"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/tls"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"expvar"
	"flag"
	"fmt"
	"io/ioutil"
	"log"
	"math/rand"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-martini/martini"
	"github.com/martini-contrib/binding"
	mgzip "github.com/martini-contrib/gzip"
	"github.com/martini-contrib/render"
	_ "github.com/mattn/go-sqlite3"
	. "github.com/russross/codegrinder/types"
	"github.com/russross/meddler"
	"golang.org/x/crypto/acme"
	"golang.org/x/crypto/acme/autocert"
)

// Config holds site-specific configuration data.
// Contains a mix of Daycare and main server parameters.
var Config struct {
	// required parameters
	Hostname      string `json:"hostname"`      // Hostname for the site: "your.host.goes.here"
	DaycareSecret string `json:"daycareSecret"` // Random string used to sign daycare requests: `head -c 32 /dev/urandom | base64`
	AcmeEmail     string `json:"acmeEmail"`     // Email address to register TLS certificates: "foo@bar.com"
	AcmeURL       string `json:"acmeURL"`       // URL of ACME certificate provider. If omitted, use letsencrypt

	// ta-only required parameters
	LTISecret     string `json:"ltiSecret"`     // LTI authentication shared secret. Must match that given to Canvas course: `head -c 32 /dev/urandom | base64`
	SessionSecret string `json:"sessionSecret"` // Random string used to sign cookie sessions: `head -c 32 /dev/urandom | base64`

	// daycare-only required parameters
	TAHostname   string   `json:"taHostname"`   // Hostname for the TA: "your.host.goes.here". Defaults to Hostname
	Capacity     int      `json:"capacity"`     // Relative capacity of this daycare for containers: 1
	ProblemTypes []string `json:"problemTypes"` // List of problem types this daycare host supports: [ "python3unittest", "gotest", ... ]

	// ta-only parameters where the default is usually sufficient
	ToolName        string      `json:"toolName"`        // LTI human readable name: default "CodeGrinder"
	ToolID          string      `json:"toolID"`          // LTI unique ID: default "codegrinder"
	ToolDescription string      `json:"toolDescription"` // LTI description: default "Programming exercises with grading"
	AcmeCache       string      `json:"acmeDir"`         // Full path of Acme cache file: default "$CODEGRINDERROOT/acme"
	SQLite3Path     string      `json:"sqlite3Path"`     // path to the sqlite database file: default "$CODEGRINDERROOT/db/codegrinder.db"
	SessionsExpire  []time.Time `json:"sessionsExpire"`  // times/dates when sessions should expire (year is ignored)
}
var root string

const daycareRegistrationInterval = 10 * time.Second

func main() {
	log.SetFlags(log.Lshortfile)

	root = os.Getenv("CODEGRINDERROOT")
	if root == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			log.Fatalf("CODEGRINDERROOT is not set, and cannot find user's home directory")
		}
		root = filepath.Join(home, "codegrinder")
	}
	log.Printf("CODEGRINDERROOT set to %s", root)

	// parse command line
	var ta, daycare bool
	flag.BoolVar(&ta, "ta", false, "Serve the TA role")
	flag.BoolVar(&daycare, "daycare", false, "Serve the daycare role")
	flag.Parse()

	if !ta && !daycare {
		log.Fatalf("must run at least one role (ta/daycare)")
	}

	// set config defaults
	Config.ToolName = "CodeGrinder"
	Config.ToolID = "codegrinder"
	Config.ToolDescription = "Programming exercises with grading"
	Config.AcmeCache = filepath.Join(root, "acme")
	Config.SQLite3Path = filepath.Join(root, "db", "codegrinder.db")
	Config.SessionsExpire = []time.Time{
		time.Date(2020, 1, 1, 0, 0, 0, 0, time.Local),
		time.Date(2020, 7, 1, 0, 0, 0, 0, time.Local),
	}

	// load config file
	configFile := filepath.Join(root, "config.json")
	if raw, err := ioutil.ReadFile(configFile); err != nil {
		log.Fatalf("failed to load config file %q: %v", configFile, err)
	} else if err := json.Unmarshal(raw, &Config); err != nil {
		log.Fatalf("failed to parse config file: %v", err)
	}
	Config.SessionSecret = unBase64(Config.SessionSecret)
	Config.DaycareSecret = unBase64(Config.DaycareSecret)

	if Config.Hostname == "" {
		log.Fatalf("cannot run with no hostname in the config file")
	}
	if Config.DaycareSecret == "" {
		log.Fatalf("cannot run with no daycareSecret in the config file")
	}
	// Config.AcmeEmail is optional

	// set up martini
	r := martini.NewRouter()
	m := martini.New()
	m.Logger(log.New(os.Stderr, "", log.Lshortfile))
	//m.Use(martini.Logger())
	m.Use(martini.Recovery())
	m.MapTo(r, (*martini.Routes)(nil))
	m.Action(r.Handle)

	counter := func(w http.ResponseWriter, r *http.Request, c martini.Context) {
		start := time.Now()
		c.Next()
		now := time.Now()
		seconds := now.Sub(start).Seconds()
		hits++
		hitsCounter.Add(1)
		if seconds > slowest {
			slowest = seconds
			slowestCounter.Set(seconds)
			slowestTimeCounter.Set(now.Format(time.RFC1123))
			slowestPathCounter.Set(r.URL.Path)
		}
		totalSeconds += seconds
		totalSecondsCounter.Add(seconds)
		averageSecondsCounter.Set(totalSeconds / float64(hits))
		rw := w.(martini.ResponseWriter)
		if rw.Status() >= 400 {
			errorsCounter.Add(1)
		}
		goroutineCounter.Set(int64(runtime.NumGoroutine()))
	}

	// set up daycare role
	// note: this must come before TA role to avoid gzip handler for daycare requests
	if daycare {
		// initialize random number generator
		rand.Seed(time.Now().UnixNano())

		// make sure relevant fields included in config file
		if Config.TAHostname == "" {
			Config.TAHostname = Config.Hostname
		}
		if len(Config.ProblemTypes) == 0 {
			log.Fatalf("cannot run Daycare role with no problemTypes in the config file")
		}
		if Config.Capacity <= 0 {
			log.Fatalf("Daycare capacity must be greater than zero")
		}

		// attach to docker via the API and try a ping
		dockerTransport = &http.Client{
			Transport: &http.Transport{
				Dial: func(_, _ string) (net.Conn, error) {
					return net.Dial("unix", dockerPath)
				},
			},
		}
		if err := getObject("/_ping", nil, nil); err != nil {
			log.Printf("Ping: %v", err)
		}

		r.Get("/v2/sockets/:problem_type/:action", SocketProblemTypeAction)

		// register with the TA periodically
		go func() {
			if ta {
				// it we are also the TA, give the server a chance to start listening
				time.Sleep(2 * time.Second)
			}
			status := ""
			client := &http.Client{Timeout: time.Second * 5}

			for {
				start := time.Now()
				reg := DaycareRegistration{
					Hostname:     Config.Hostname,
					ProblemTypes: Config.ProblemTypes,
					Capacity:     Config.Capacity,
					Time:         time.Now(),
					Version:      CurrentVersion.Version,
				}
				reg.Signature = reg.ComputeSignature(Config.DaycareSecret)
				raw, err := json.MarshalIndent(&reg, "", "    ")
				if err != nil {
					log.Fatalf("encoding daycare registration: %v", err)
				}
				url := fmt.Sprintf("https://%s/v2/daycare_registrations", Config.TAHostname)

				body := ioutil.NopCloser(bytes.NewReader(raw))
				req, err := http.NewRequest("POST", url, body)
				if err != nil {
					log.Fatalf("forming http request for daycare registration: %v", err)
				}
				req.Header.Add("Content-Type", "application/json")
				res, err := client.Do(req)
				if err != nil {
					if status != "failed" {
						log.Printf("error connecting to register daycare: %v", err)
						log.Printf("attempt took %v", time.Since(start))
					}
					status = "failed"
				} else {
					body, err := ioutil.ReadAll(res.Body)
					if err != nil {
						body = []byte(fmt.Sprintf("error reading response body: %v", err))
					}
					res.Body.Close()
					if res.StatusCode == http.StatusOK {
						if status != "succeeded" {
							log.Printf("registered with %s", url)
							log.Printf("attempt took %v", time.Since(start))
						}
						status = "succeeded"
					} else {
						if status != "failed" {
							log.Printf("unexpected status from %s: %v", url, res.Status)
							for _, line := range bytes.Split(body, []byte("\n")) {
								if len(line) > 0 {
									log.Printf("--> %s", line)
								}
							}
						}
						status = "failed"
					}
				}
				time.Sleep(daycareRegistrationInterval)
			}
		}()
	}

	// set up TA role
	if ta {
		// make sure relevant secrets are included in config file
		if Config.LTISecret == "" {
			log.Fatalf("cannot run TA role with no ltiSecret in the config file")
		}
		if Config.SessionSecret == "" {
			log.Fatalf("cannot run TA role with no sessionSecret in the config file")
		}
		if Config.SQLite3Path == "" {
			log.Fatalf("cannot run TA role with no sqlite3Path in the config file")
		}

		m.Use(mgzip.All())
		m.Use(martini.Static(filepath.Join(root, "www"), martini.StaticOptions{SkipLogging: true}))
		m.Use(render.Renderer(render.Options{IndentJSON: false}))

		// set up the database
		db := setupDB(Config.SQLite3Path)
		var dbMutex sync.Mutex

		// martini service: wrap handler in a transaction
		withTx := func(c martini.Context, r *http.Request, w http.ResponseWriter) {
			// start a transaction
			dbMutex.Lock()
			defer dbMutex.Unlock()

			start := time.Now()
			defer func() {
				elapsed := time.Since(start)
				if elapsed > 500*time.Millisecond {
					switch {
					case elapsed < time.Second:
						elapsed -= elapsed % time.Millisecond
					case elapsed < 10*time.Second:
						elapsed -= elapsed % (10 * time.Millisecond)
					default:
						elapsed -= elapsed % (100 * time.Millisecond)
					}
					log.Printf("transaction took %v, req was %s", elapsed, r.RequestURI)
				}
			}()
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
				//log.Printf("rolling back transaction")
				if err := tx.Rollback(); err != nil {
					loggedHTTPErrorf(w, http.StatusInternalServerError, "db error rolling back transaction: %v", err)
					return
				}
			}
		}

		// martini service: to require an active logged-in session
		auth := func(w http.ResponseWriter, r *http.Request) {
			_, err := GetSession(r)
			if err != nil {
				loggedHTTPErrorf(w, http.StatusUnauthorized, "authentication failed: try logging in again")
				log.Printf("%v", err)
				return
			}
		}

		// martini service: include the current logged-in user (requires withTx)
		withCurrentUser := func(c martini.Context, w http.ResponseWriter, r *http.Request, tx *sql.Tx) {
			session, err := GetSession(r)
			if err != nil {
				loggedHTTPErrorf(w, http.StatusUnauthorized, "authentication failed: try logging in again")
				log.Printf("%v", err)
				return
			}

			// load the user record
			userID := session.UserID
			user := new(User)
			if err := meddler.Load(tx, "users", user, userID); err != nil {
				session.Delete(w)

				if err == sql.ErrNoRows {
					loggedHTTPErrorf(w, http.StatusUnauthorized, "user %d not found", userID)
					return
				}
				loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
				return
			}

			// map the current user to the request context
			c.Map(user)
		}

		// martini service: require logged in user to be an administrator (requires withCurrentUser)
		administratorOnly := func(w http.ResponseWriter, currentUser *User) {
			if !currentUser.Admin {
				loggedHTTPErrorf(w, http.StatusUnauthorized, "user %d (%s) is not an administrator", currentUser.ID, currentUser.Email)
				return
			}
		}

		// martini service: require logged in user to be an author or administrator (requires withCurrentUser)
		authorOnly := func(w http.ResponseWriter, tx *sql.Tx, currentUser *User) {
			if currentUser.Admin {
				return
			}
			if !currentUser.Author {
				loggedHTTPErrorf(w, http.StatusUnauthorized, "user %d (%s) is not an author", currentUser.ID, currentUser.Name)
				return
			}
		}

		// martini middleware: decompress incoming requests
		gunzip := func(c martini.Context, w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Content-Encoding") != "gzip" {
				return
			}

			r.Header.Del("Content-Encoding")
			body := r.Body
			var err error
			r.Body, err = gzip.NewReader(body)
			defer body.Close()
			if err != nil {
				loggedHTTPErrorf(w, http.StatusBadRequest, "gzip error in request: %v", err)
				return
			}
			c.Next()
		}

		// version
		r.Get("/v2/version", counter, func(w http.ResponseWriter, render render.Render) {
			render.JSON(http.StatusOK, &CurrentVersion)
		})

		// daycare registration
		r.Get("/v2/daycare_registrations",
			func(w http.ResponseWriter, render render.Render) {
				daycareRegistrations.Expire()
				render.JSON(http.StatusOK, daycareRegistrations.daycares)
			})
		r.Post("/v2/daycare_registrations", gunzip, binding.Json(DaycareRegistration{}),
			func(w http.ResponseWriter, reg DaycareRegistration) {
				daycareRegistrations.Expire()
				if err := daycareRegistrations.Insert(&reg); err != nil {
					loggedHTTPErrorf(w, http.StatusBadRequest, "bad daycare registration: %v", err)
					return
				}
			})

		// stats
		r.Get("/v2/stats", withTx, withCurrentUser, authorOnly, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			fmt.Fprintf(w, "{\n")
			first := true
			expvar.Do(func(kv expvar.KeyValue) {
				if !first {
					fmt.Fprintf(w, ",\n")
				}
				first = false
				fmt.Fprintf(w, "%q: %s", kv.Key, kv.Value)
			})
			fmt.Fprintf(w, "\n}\n")
		})

		// LTI
		r.Get("/v2/lti/config.xml", counter, GetConfigXML)
		//r.Post("/v2/lti/problem_sets", counter, gunzip, binding.Bind(LTIRequest{}), checkOAuthSignature, withTx, LtiProblemSets)
		r.Post("/v2/lti/problem_sets/:ui/:unique", counter, gunzip, binding.Bind(LTIRequest{}), checkOAuthSignature, withTx, LtiProblemSet)
		r.Post("/v2/lti/quizzes", counter, gunzip, binding.Bind(LTIRequest{}), checkOAuthSignature, withTx, LtiQuizzes)

		// problem bundles--for problem creation only
		r.Post("/v2/problem_bundles/unconfirmed", counter, withTx, withCurrentUser, authorOnly, gunzip, binding.Json(ProblemBundle{}), PostProblemBundleUnconfirmed)
		r.Post("/v2/problem_bundles/confirmed", counter, withTx, withCurrentUser, authorOnly, gunzip, binding.Json(ProblemBundle{}), PostProblemBundleConfirmed)
		r.Put("/v2/problem_bundles/:problem_id", counter, withTx, withCurrentUser, authorOnly, gunzip, binding.Json(ProblemBundle{}), PutProblemBundle)

		// problem set bundles--for problem set creation only
		r.Post("/v2/problem_set_bundles", counter, withTx, withCurrentUser, authorOnly, gunzip, binding.Json(ProblemSetBundle{}), PostProblemSetBundle)
		r.Put("/v2/problem_set_bundles/:problem_set_id", counter, withTx, withCurrentUser, authorOnly, gunzip, binding.Json(ProblemSetBundle{}), PutProblemSetBundle)

		// problem types
		r.Get("/v2/problem_types", counter, auth, withTx, GetProblemTypes)
		r.Get("/v2/problem_types/:name", counter, auth, withTx, GetProblemType)

		// problems
		r.Get("/v2/problems", counter, withTx, withCurrentUser, GetProblems)
		r.Get("/v2/problems/:problem_id", counter, withTx, withCurrentUser, GetProblem)
		r.Get("/v2/problems/:problem_id/steps", counter, withTx, withCurrentUser, GetProblemSteps)
		r.Get("/v2/problems/:problem_id/steps/:step", counter, withTx, withCurrentUser, GetProblemStep)
		r.Delete("/v2/problems/:problem_id", counter, withTx, withCurrentUser, administratorOnly, DeleteProblem)

		// problem sets
		r.Get("/v2/problem_sets", counter, withTx, withCurrentUser, GetProblemSets)
		r.Get("/v2/problem_sets/:problem_set_id", counter, withTx, withCurrentUser, GetProblemSet)
		r.Get("/v2/problem_sets/:problem_set_id/problems", counter, withTx, withCurrentUser, GetProblemSetProblems)
		r.Delete("/v2/problem_sets/:problem_set_id", counter, withTx, withCurrentUser, administratorOnly, DeleteProblemSet)

		// courses
		r.Get("/v2/courses", counter, withTx, withCurrentUser, GetCourses)
		r.Get("/v2/courses/:course_id", counter, withTx, withCurrentUser, GetCourse)
		r.Delete("/v2/courses/:course_id", counter, withTx, withCurrentUser, administratorOnly, DeleteCourse)

		// users
		r.Get("/v2/users", counter, withTx, withCurrentUser, GetUsers)
		r.Get("/v2/users/me", counter, withTx, withCurrentUser, GetUserMe)
		r.Get("/v2/users/session", counter, GetUserSession)
		r.Get("/v2/users/:user_id", counter, withTx, withCurrentUser, GetUser)
		r.Get("/v2/courses/:course_id/users", counter, withTx, withCurrentUser, GetCourseUsers)
		r.Delete("/v2/users/:user_id", counter, withTx, withCurrentUser, administratorOnly, DeleteUser)

		// assignments
		r.Get("/v2/users/:user_id/assignments", counter, withTx, withCurrentUser, GetUserAssignments)
		r.Get("/v2/courses/:course_id/users/:user_id/assignments", counter, withTx, withCurrentUser, GetCourseUserAssignments)
		r.Get("/v2/assignments", counter, withTx, withCurrentUser, GetAssignments)
		r.Get("/v2/assignments/:assignment_id", counter, withTx, withCurrentUser, GetAssignment)
		r.Delete("/v2/assignments/:assignment_id", counter, withTx, withCurrentUser, administratorOnly, DeleteAssignment)

		// commits
		r.Get("/v2/assignments/:assignment_id/problems/:problem_id/commits/last", counter, withTx, withCurrentUser, GetAssignmentProblemCommitLast)
		r.Get("/v2/assignments/:assignment_id/problems/:problem_id/steps/:step/commits/last", counter, withTx, withCurrentUser, GetAssignmentProblemStepCommitLast)
		r.Delete("/v2/commits/:commit_id", counter, withTx, withCurrentUser, administratorOnly, DeleteCommit)

		// commit bundles
		r.Post("/v2/commit_bundles/unsigned", counter, withTx, withCurrentUser, gunzip, binding.Json(CommitBundle{}), PostCommitBundlesUnsigned)
		r.Post("/v2/commit_bundles/signed", counter, withTx, withCurrentUser, gunzip, binding.Json(CommitBundle{}), PostCommitBundlesSigned)

		// quizzes
		r.Get("/v2/assignments/:assignment_id/quizzes", counter, withTx, withCurrentUser, GetAssignmentQuizzes)
		r.Get("/v2/quizzes/:quiz_id", counter, withTx, withCurrentUser, GetQuiz)
		r.Patch("/v2/quizzes/:quiz_id", counter, withTx, withCurrentUser, gunzip, binding.Json(QuizPatch{}), PatchQuiz)
		r.Post("/v2/quizzes", counter, withTx, withCurrentUser, gunzip, binding.Json(Quiz{}), PostQuiz)
		r.Delete("/v2/quizzes/:quiz_id", counter, withTx, withCurrentUser, DeleteQuiz)

		// questions
		r.Get("/v2/quizzes/:quiz_id/questions", counter, withTx, withCurrentUser, GetQuizQuestions)
		r.Get("/v2/assignments/:assignment_id/questions/open", counter, withTx, withCurrentUser, GetAssignmentQuestionsOpen)
		//r.Get("/v2/assignments/:assignment_id/questions/mock", counter, withTx, withCurrentUser, MockGetAssignmentQuestionsOpen)
		r.Get("/v2/questions/:question_id", counter, withTx, withCurrentUser, GetQuestion)
		r.Patch("/v2/questions/:question_id", counter, withTx, withCurrentUser, gunzip, binding.Json(QuestionPatch{}), PatchQuestion)
		r.Post("/v2/questions", counter, withTx, withCurrentUser, gunzip, binding.Json(Question{}), PostQuestion)
		r.Delete("/v2/questions/:question_id", counter, withTx, withCurrentUser, DeleteQuestion)

		// responses
		r.Get("/v2/questions/:question_id/responses", counter, withTx, withCurrentUser, GetQuestionResponses)
		r.Post("/v2/responses", counter, withTx, withCurrentUser, gunzip, binding.Json(Response{}), PostResponse)
	}

	// set up automatic TLS certificates
	var acmeClient *acme.Client
	if Config.AcmeURL != "" {
		acmeClient = &acme.Client{DirectoryURL: Config.AcmeURL}
	}
	lem := autocert.Manager{
		Prompt:     autocert.AcceptTOS,
		Cache:      autocert.DirCache(Config.AcmeCache),
		HostPolicy: autocert.HostWhitelist(Config.Hostname),
		Email:      Config.AcmeEmail,
		Client:     acmeClient,
	}

	// set up the https server
	log.Printf("accepting https connections")
	server := &http.Server{
		Addr:    ":https",
		Handler: m,
		TLSConfig: &tls.Config{
			PreferServerCipherSuites: true,
			MinVersion:               tls.VersionTLS12,
			GetCertificate:           lem.GetCertificate,
		},
	}

	// set up the http server
	// it is necessary for ACME challenges
	// it forwards other requests to https, but only if the host name was correct
	forwarder := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// get the address of the client
		addr := r.Header.Get("X-Real-IP")
		if addr == "" {
			addr = r.Header.Get("X-Forwarded-For")
			if addr == "" {
				addr = r.RemoteAddr
			}
		}

		// make sure the request is for the right host name
		if Config.Hostname != r.Host {
			http.Error(w, "http request to invalid host", http.StatusBadRequest)
			return
		}
		var u url.URL = *r.URL
		u.Scheme = "https"
		u.Host = Config.Hostname
		log.Printf("redirecting http request from %s to %s", addr, u.String())
		w.Header().Set("Connection", "close")
		http.Redirect(w, r, u.String(), http.StatusFound)
	})

	// start both servers
	go func() {
		if err := http.ListenAndServe(":http", lem.HTTPHandler(forwarder)); err != nil {
			log.Fatalf("ListenAndServe: %v", err)
		}
	}()
	if err := server.ListenAndServeTLS("", ""); err != nil {
		log.Fatalf("ListenAndServeTLS: %v", err)
	}
}

func setupDB(path string) *sql.DB {
	meddler.Default = meddler.SQLite

	options :=
		"?" + "mode=rw" +
			"&" + "_busy_timeout=10000" +
			"&" + "_cache_size=-20000" +
			"&" + "_foreign_keys=ON" +
			"&" + "_journal_mode=DELETE" +
			"&" + "_synchronous=NORMAL" +
			"&" + "_temp_store=MEMORY"
	db, err := sql.Open("sqlite3", path+options)
	if err != nil {
		log.Fatalf("error opening database: %v", err)
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
	where += fmt.Sprintf(" %s = ?", label)
	return where, args
}

func addWhereLike(where string, args []interface{}, label string, value string) (string, []interface{}) {
	if where == "" {
		where = " WHERE"
	} else {
		where += " AND"
	}
	args = append(args, "%"+strings.ToLower(value)+"%")

	// sqlite is set to use case insensitive LIKEs
	where += fmt.Sprintf(" %s LIKE ?", label)
	return where, args
}

func loggedHTTPDBNotFoundError(w http.ResponseWriter, err error) {
	msg := "not found"
	status := http.StatusNotFound
	if err != sql.ErrNoRows {
		msg = fmt.Sprintf("db error: %v", err)
		status = http.StatusInternalServerError
	}
	//log.Print(logPrefix(), msg)
	http.Error(w, msg, status)
}

func loggedHTTPErrorf(w http.ResponseWriter, status int, format string, params ...interface{}) error {
	msg := fmt.Sprintf(format, params...)
	log.Print(logPrefix() + msg)
	http.Error(w, msg, status)
	return fmt.Errorf("%s", msg)
}

func loggedErrorf(f string, params ...interface{}) error {
	log.Print(logPrefix() + fmt.Sprintf(f, params...))
	return fmt.Errorf(f, params...)
}

func parseID(w http.ResponseWriter, name, s string) (int64, error) {
	id, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0, loggedHTTPErrorf(w, http.StatusBadRequest, "error parsing %s from URL: %v", name, err)
	}
	if id < 1 {
		return 0, loggedHTTPErrorf(w, http.StatusBadRequest, "invalid ID in URL: %s must be 1 or greater", name)
	}

	return id, nil
}

func logPrefix() string {
	prefix := ""
	if _, file, line, ok := runtime.Caller(2); ok {
		if slash := strings.LastIndex(file, "/"); slash >= 0 {
			file = file[slash+1:]
		}
		prefix = fmt.Sprintf("%s:%d: ", file, line)
	}
	return prefix
}

func mustMarshal(elt interface{}) []byte {
	raw, err := json.Marshal(elt)
	if err != nil {
		log.Fatalf("json Marshal error for % #v", elt)
	}
	return raw
}

func dump(elt interface{}) {
	fmt.Printf("%s\n", mustMarshal(elt))
}

func unBase64(s string) string {
	if raw, err := base64.StdEncoding.DecodeString(s); err == nil {
		return string(raw)
	}
	return s
}

type daycares struct {
	sync.Mutex
	daycares map[string]*DaycareRegistration
}

var daycareRegistrations daycares

func init() {
	daycareRegistrations.daycares = make(map[string]*DaycareRegistration)
}

func (m *daycares) Expire() {
	m.Lock()
	defer m.Unlock()

	for host, elt := range m.daycares {
		if time.Since(elt.Time) > 2*daycareRegistrationInterval {
			log.Printf("daycare registration for %s has expired", host)
			delete(m.daycares, host)
		}
	}
}

func (m *daycares) Insert(reg *DaycareRegistration) error {
	m.Lock()
	defer m.Unlock()

	// check the signature
	sig := reg.ComputeSignature(Config.DaycareSecret)
	if sig != reg.Signature {
		return fmt.Errorf("signature mismatch: computed %s but found %s", sig, reg.Signature)
	}
	if reg.Version != CurrentVersion.Version {
		return fmt.Errorf("version mismatch: daycare is %s, but ta is %s", reg.Version, CurrentVersion.Version)
	}
	drift := time.Since(reg.Time)
	if drift < 0 {
		drift = -drift
	}
	if drift > time.Minute {
		return fmt.Errorf("time drift is too great")
	}

	// clean it up a bit
	sort.Strings(reg.ProblemTypes)
	reg.Time = time.Now()
	reg.Version = ""
	reg.Signature = ""
	if m.daycares[reg.Hostname] == nil {
		log.Printf("daycare registration for %s added", reg.Hostname)
	}
	m.daycares[reg.Hostname] = reg

	return nil
}

func (m *daycares) Assign(problemTypes map[string]bool) (string, error) {
	m.Lock()
	defer m.Unlock()

	// gather the total weights of all of the eligible daycare hosts
	totalWeight := 0
	for _, elt := range m.daycares {
		// does this daycare support all required problem types?
		supported := true
		for problemType := range problemTypes {
			n := sort.SearchStrings(elt.ProblemTypes, problemType)
			if n >= len(elt.ProblemTypes) || elt.ProblemTypes[n] != problemType {
				supported = false
				break
			}
		}
		if supported {
			totalWeight += elt.Capacity
		}
	}
	if totalWeight == 0 {
		return "", fmt.Errorf("no eligible daycare found")
	}

	// pick a random point in pool of weights
	point := rand.Intn(totalWeight)
	skippedWeight := 0
	for host, elt := range m.daycares {
		supported := true
		for problemType := range problemTypes {
			n := sort.SearchStrings(elt.ProblemTypes, problemType)
			if n >= len(elt.ProblemTypes) || elt.ProblemTypes[n] != problemType {
				supported = false
				break
			}
		}
		if supported {
			skippedWeight += elt.Capacity
		}
		if point < skippedWeight {
			return host, nil
		}
	}
	return "", fmt.Errorf("failed to find daycare, please report this error")
}

type DaycareRegistration struct {
	Hostname     string    `json:"hostname"`
	ProblemTypes []string  `json:"problemTypes"`
	Capacity     int       `json:"capacity"`
	Time         time.Time `json:"time"`
	Version      string    `json:"version,omitempty"`
	Signature    string    `json:"signature,omitempty"`
}

func (reg *DaycareRegistration) ComputeSignature(secret string) string {
	v := make(url.Values)

	// gather all relevant fields
	v.Add("hostname", reg.Hostname)
	sort.Strings(reg.ProblemTypes)
	for n, elt := range reg.ProblemTypes {
		v.Add(fmt.Sprintf("problemType-%d", n), elt)
	}
	v.Add("capacity", strconv.Itoa(reg.Capacity))
	v.Add("time", reg.Time.Round(time.Second).UTC().Format(time.RFC3339))
	v.Add("version", reg.Version)

	// compute signature
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(encode(v))
	sum := mac.Sum(nil)
	sig := base64.StdEncoding.EncodeToString(sum)
	return sig
}

var (
	hits                  int
	hitsCounter           = expvar.NewInt("hits")
	slowest               float64
	slowestCounter        = expvar.NewFloat("slowestSeconds")
	slowestPathCounter    = expvar.NewString("slowestPath")
	slowestTimeCounter    = expvar.NewString("slowestTime")
	totalSeconds          float64
	totalSecondsCounter   = expvar.NewFloat("totalSeconds")
	averageSecondsCounter = expvar.NewFloat("averageSeconds")
	errorsCounter         = expvar.NewInt("errors")
	goroutineCounter      = expvar.NewInt("goroutines")
)
