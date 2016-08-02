package main

import (
	"bytes"
	"crypto/tls"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"html"
	"io/ioutil"
	"log"
	"net/http"
	"net/url"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/fsouza/go-dockerclient"
	"github.com/go-martini/martini"
	_ "github.com/lib/pq"
	"github.com/martini-contrib/binding"
	"github.com/martini-contrib/render"
	"github.com/martini-contrib/sessions"
	. "github.com/russross/codegrinder/types"
	"github.com/russross/meddler"
	"github.com/sergi/go-diff/diffmatchpatch"
	"rsc.io/letsencrypt"
)

// Config holds site-specific configuration data.
// Contains a mix of Daycare and main server parameters.
var Config struct {
	Hostname         string // Hostname for the site: "your.host.goes.here"
	LetsEncryptEmail string // Email address to register TLS certificates: "foo@bar.com"
	LTISecret        string // LTI authentication shared secret. Must match that given to Canvas course: "asdf..."
	SessionSecret    string // Random string used to sign cookie sessions: "asdf..."
	DaycareSecret    string // Random string used to sign daycare requests: "asdf..."
	StaticDir        string // Full path of directory holding static files to serve: "/home/foo/codegrinder/client"

	ToolName         string // LTI human readable name: "CodeGrinder"
	ToolID           string // LTI unique ID: "codegrinder"
	ToolDescription  string // LTI description: "Programming exercises with grading"
	LetsEncryptCache string // Full path of LetsEncrypt cache file: "/etc/codegrinder/letsencrypt.cache"
	PostgresHost     string // Host parameter for Postgres: "/var/run/postgresql"
	PostgresPort     string // Port parameter for Postgres: "5432"
	PostgresUsername string // Username parameter for Postgres: "codegrinder"
	PostgresPassword string // Password parameter for Postgres: "super$trong"
	PostgresDatabase string // Database parameter for Postgres: "codegrinder"
}

var problemTypes = make(map[string]*ProblemType)

func main() {
	// parse command line
	var configFile string
	flag.StringVar(&configFile, "config", "/etc/codegrinder/config.json", "Path to the config file")
	var ta, daycare bool
	flag.BoolVar(&ta, "ta", true, "Serve the TA role")
	flag.BoolVar(&daycare, "daycare", true, "Serve the daycare role")
	flag.Parse()

	if !ta && !daycare {
		log.Fatalf("must run at least one role (ta/daycare)")
	}

	// set config defaults
	Config.ToolName = "CodeGrinder"
	Config.ToolID = "codegrinder"
	Config.ToolDescription = "Programming exercises with grading"
	Config.LetsEncryptCache = "/etc/codegrinder/letsencrypt.cache"
	Config.PostgresHost = "/var/run/postgresql"
	Config.PostgresPort = ""
	Config.PostgresUsername = os.Getenv("USER")
	Config.PostgresPassword = ""
	Config.PostgresDatabase = os.Getenv("USER")

	// load config file
	if raw, err := ioutil.ReadFile(configFile); err != nil {
		log.Fatalf("failed to load config file %q: %v", configFile, err)
	} else if err := json.Unmarshal(raw, &Config); err != nil {
		log.Fatalf("failed to parse config file: %v", err)
	}
	Config.SessionSecret = unBase64(Config.SessionSecret)
	Config.DaycareSecret = unBase64(Config.DaycareSecret)

	// set up martini
	r := martini.NewRouter()
	m := martini.New()
	m.Logger(log.New(os.Stderr, "", log.LstdFlags))
	m.Use(martini.Logger())
	m.Use(martini.Recovery())
	m.Use(martini.Static(Config.StaticDir, martini.StaticOptions{SkipLogging: true}))
	m.MapTo(r, (*martini.Routes)(nil))
	m.Action(r.Handle)

	m.Use(render.Renderer(render.Options{IndentJSON: true}))

	store := sessions.NewCookieStore([]byte(Config.SessionSecret))
	m.Use(sessions.Sessions(CookieName, store))

	// sessions expire June 30 and December 31
	go func() {
		for {
			now := time.Now()

			// expire at the end of the calendar year
			expires := time.Date(now.Year(), time.December, 31, 23, 59, 59, 0, time.Local)

			if expires.Sub(now).Hours() < 14*24 {
				// are we within 2 weeks of the end of the year? probably prepping for spring,
				// so expire next June 30 instead
				expires = time.Date(now.Year()+1, time.June, 30, 23, 59, 59, 0, time.Local)
			} else if expires.Sub(now).Hours() > (365/2+14)*24 {
				// is it still more than 2 weeks before June 30? probably in spring semester,
				// so expire this June 30 instead
				expires = time.Date(now.Year(), time.June, 30, 23, 59, 59, 0, time.Local)
			}
			store.Options(sessions.Options{Path: "/", Secure: true, MaxAge: int(expires.Sub(now).Seconds())})
			time.Sleep(11 * time.Minute)
		}
	}()

	// set up TA role
	if ta {
		// make sure relevant secrets are included in config file
		if Config.LTISecret == "" {
			log.Fatalf("cannot run TA role with no LTISecret in the config file")
		}
		if Config.SessionSecret == "" {
			log.Fatalf("cannot run TA role with no SessionSecret in the config file")
		}
		if Config.DaycareSecret == "" {
			log.Fatalf("cannot run with no DaycareSecret in the config file")
		}

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
				log.Printf("rolling back transaction")
				if err := tx.Rollback(); err != nil {
					loggedHTTPErrorf(w, http.StatusInternalServerError, "db error rolling back transaction: %v", err)
					return
				}
			}
		}

		// martini service: to require an active logged-in session
		auth := func(w http.ResponseWriter, session sessions.Session) {
			if userID := session.Get("id"); userID == nil {
				loggedHTTPErrorf(w, http.StatusUnauthorized, "authentication: no user ID found in session")
				return
			}
		}

		// martini service: include the current logged-in user (requires withTx and auth)
		withCurrentUser := func(c martini.Context, w http.ResponseWriter, tx *sql.Tx, session sessions.Session) {
			rawID := session.Get("id")
			if rawID == nil {
				loggedHTTPErrorf(w, http.StatusInternalServerError, "cannot find user ID in session")
				return
			}
			userID, ok := rawID.(int64)
			if !ok {
				session.Clear()
				loggedHTTPErrorf(w, http.StatusInternalServerError, "error extracting user ID from session")
				return
			}

			// load the user record
			user := new(User)
			if err := meddler.Load(tx, "users", user, userID); err != nil {
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

		// version
		r.Get("/v2/version", func(w http.ResponseWriter, render render.Render) {
			render.JSON(http.StatusOK, &CurrentVersion)
		})

		// LTI
		r.Get("/v2/lti/config.xml", GetConfigXML)
		r.Post("/v2/lti/problem_sets", binding.Bind(LTIRequest{}), checkOAuthSignature, withTx, LtiProblemSets)
		r.Post("/v2/lti/problem_sets/:unique", binding.Bind(LTIRequest{}), checkOAuthSignature, withTx, LtiProblemSet)

		// problem bundles--for problem creation only
		r.Post("/v2/problem_bundles/unconfirmed", auth, withTx, withCurrentUser, authorOnly, binding.Json(ProblemBundle{}), PostProblemBundleUnconfirmed)
		r.Post("/v2/problem_bundles/confirmed", auth, withTx, withCurrentUser, authorOnly, binding.Json(ProblemBundle{}), PostProblemBundleConfirmed)
		r.Put("/v2/problem_bundles/:problem_id", auth, withTx, withCurrentUser, authorOnly, binding.Json(ProblemBundle{}), PutProblemBundle)

		// problem set bundles--for problem set creation only
		r.Post("/v2/problem_set_bundles", auth, withTx, withCurrentUser, authorOnly, binding.Json(ProblemSetBundle{}), PostProblemSetBundle)

		// problem types
		r.Get("/v2/problem_types", auth, GetProblemTypes)
		r.Get("/v2/problem_types/:name", auth, GetProblemType)

		// problems
		r.Get("/v2/problems", auth, withTx, withCurrentUser, GetProblems)
		r.Get("/v2/problems/:problem_id", auth, withTx, withCurrentUser, GetProblem)
		r.Get("/v2/problems/:problem_id/steps", auth, withTx, withCurrentUser, GetProblemSteps)
		r.Get("/v2/problems/:problem_id/steps/:step", auth, withTx, withCurrentUser, GetProblemStep)
		r.Delete("/v2/problems/:problem_id", auth, withTx, withCurrentUser, administratorOnly, DeleteProblem)

		// problem sets
		r.Get("/v2/problem_sets", auth, withTx, withCurrentUser, GetProblemSets)
		r.Get("/v2/problem_sets/:problem_set_id", auth, withTx, withCurrentUser, GetProblemSet)
		r.Get("/v2/problem_sets/:problem_set_id/problems", auth, withTx, withCurrentUser, GetProblemSetProblems)
		r.Delete("/v2/problem_sets/:problem_set_id", auth, withTx, withCurrentUser, administratorOnly, DeleteProblemSet)

		// courses
		r.Get("/v2/courses", auth, withTx, withCurrentUser, GetCourses)
		r.Get("/v2/courses/:course_id", auth, withTx, withCurrentUser, GetCourse)
		r.Delete("/v2/courses/:course_id", auth, withTx, withCurrentUser, administratorOnly, DeleteCourse)

		// users
		r.Get("/v2/users", auth, withTx, withCurrentUser, GetUsers)
		r.Get("/v2/users/me", auth, withTx, withCurrentUser, GetUserMe)
		r.Get("/v2/users/me/cookie", auth, GetUserMeCookie)
		r.Get("/v2/users/:user_id", auth, withTx, withCurrentUser, GetUser)
		r.Get("/v2/courses/:course_id/users", auth, withTx, withCurrentUser, GetCourseUsers)
		r.Delete("/v2/users/:user_id", auth, withTx, withCurrentUser, administratorOnly, DeleteUser)

		// assignments
		r.Get("/v2/users/:user_id/assignments", auth, withTx, withCurrentUser, GetUserAssignments)
		r.Get("/v2/courses/:course_id/users/:user_id/assignments", auth, withTx, withCurrentUser, GetCourseUserAssignments)
		r.Get("/v2/assignments/:assignment_id", auth, withTx, withCurrentUser, GetAssignment)
		r.Delete("/v2/assignments/:assignment_id", auth, withTx, withCurrentUser, administratorOnly, DeleteAssignment)

		// commits
		r.Get("/v2/assignments/:assignment_id/problems/:problem_id/commits/last", auth, withTx, withCurrentUser, GetAssignmentProblemCommitLast)
		r.Get("/v2/assignments/:assignment_id/problems/:problem_id/steps/:step/commits/last", auth, withTx, withCurrentUser, GetAssignmentProblemStepCommitLast)
		r.Delete("/v2/commits/:commit_id", auth, withTx, withCurrentUser, administratorOnly, DeleteCommit)

		// commit bundles
		r.Post("/v2/commit_bundles/unsigned", auth, withTx, withCurrentUser, binding.Json(CommitBundle{}), PostCommitBundlesUnsigned)
		r.Post("/v2/commit_bundles/signed", auth, withTx, withCurrentUser, binding.Json(CommitBundle{}), PostCommitBundlesSigned)
	}

	// set up daycare role
	if daycare {
		// make sure relevant secrets are included in config file
		if Config.DaycareSecret == "" {
			log.Fatalf("cannot run with no DaycareSecret in the config file")
		}

		// attach to docker and try a ping
		var err error
		dockerClient, err = docker.NewVersionedClient("unix:///var/run/docker.sock", "1.24")
		if err != nil {
			log.Fatalf("NewVersionedClient: %v", err)
		}
		if err = dockerClient.Ping(); err != nil {
			log.Fatalf("Ping: %v", err)
		}

		r.Get("/v2/sockets/:problem_type/:action", SocketProblemTypeAction)
	}

	// start redirecting http calls to https
	log.Printf("starting http -> https forwarder")
	go http.ListenAndServe(":http", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
			loggedHTTPErrorf(w, http.StatusNotFound, "http request to invalid host: %s", r.Host)
			return
		}
		var u url.URL = *r.URL
		u.Scheme = "https"
		u.Host = Config.Hostname
		log.Printf("redirecting http request from %s to %s", addr, u.String())
		http.Redirect(w, r, u.String(), http.StatusMovedPermanently)
	}))

	// set up letsencrypt
	lem := letsencrypt.Manager{}
	if err := lem.CacheFile(Config.LetsEncryptCache); err != nil {
		log.Fatalf("Setting up LetsEncrypt: %v", err)
	}
	lem.SetHosts([]string{Config.Hostname})
	if !lem.Registered() {
		log.Printf("registering with letsencrypt")
		if err := lem.Register(Config.LetsEncryptEmail, nil); err != nil {
			log.Fatalf("Registering with LetsEncrypt: %v", err)
		}
	}

	// start the https server
	log.Printf("accepting https connections")
	server := &http.Server{
		Addr:    ":https",
		Handler: m,
		TLSConfig: &tls.Config{
			MinVersion:     tls.VersionTLS10,
			GetCertificate: lem.GetCertificate,
		},
	}
	if err := server.ListenAndServeTLS("", ""); err != nil {
		log.Fatalf("ListenAndServeTLS: %v", err)
	}
}

func setupDB(host, port, user, password, database string) *sql.DB {
	if port == "" {
		log.Printf("connecting to database at %s", host)
	} else {
		log.Printf("connecting to database at %s:%s", host, port)
	}
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
		log.Printf("error opening database: %v", err)
		time.Sleep(delay)
		log.Fatalf("slept for %v", delay)
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

func loggedHTTPDBNotFoundError(w http.ResponseWriter, err error) {
	msg := "not found"
	status := http.StatusNotFound
	if err != sql.ErrNoRows {
		msg = fmt.Sprintf("db error: %v", err)
		status = http.StatusInternalServerError
	}
	log.Print(logPrefix(), msg)
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
		return 0, loggedHTTPErrorf(w, http.StatusBadRequest, "invalid ID in URL: %s must be 1 or greater", name, err)
	}

	return id, nil
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

func int64Contains(lst []int64, n int64) bool {
	for _, elt := range lst {
		if elt == n {
			return true
		}
	}
	return false
}

func htmlEscapePre(txt string) string {
	if len(txt) > MaxDetailsLen {
		txt = txt[:MaxDetailsLen] + "\n\n[TRUNCATED]"
	}
	if strings.HasSuffix(txt, "\n") {
		txt = txt[:len(txt)-1]
	}
	escaped := html.EscapeString(txt)
	pre := "<pre>" + escaped + "</pre>"
	return pre
}

func htmlEscapeUl(txt string) string {
	if len(txt) > MaxDetailsLen {
		txt = txt[:MaxDetailsLen] + "\n\n[TRUNCATED]"
	}
	if strings.HasSuffix(txt, "\n") {
		txt = txt[:len(txt)-1]
	}
	var buf bytes.Buffer
	buf.WriteString("<ul>\n")
	lines := strings.Split(txt, "\n")
	for _, line := range lines {
		buf.WriteString("<li>")
		buf.WriteString(html.EscapeString(line))
		buf.WriteString("</li>\n")
	}
	buf.WriteString("</ul>\n")
	return buf.String()
}

func htmlEscapePara(txt string) string {
	if len(txt) > MaxDetailsLen {
		txt = txt[:MaxDetailsLen] + "\n\n[TRUNCATED]"
	}
	if strings.HasSuffix(txt, "\n") {
		txt = txt[:len(txt)-1]
	}
	var buf bytes.Buffer
	lines := strings.Split(txt, "\n")
	for _, line := range lines {
		buf.WriteString("<p>")
		buf.WriteString(html.EscapeString(line))
		buf.WriteString("</p>\n")
	}
	return buf.String()
}

func writeDiffHTML(out *bytes.Buffer, from, to, header string) {
	dmp := diffmatchpatch.New()
	diff := dmp.DiffMain(from, to, true)
	diff = dmp.DiffCleanupSemantic(diff)

	out.WriteString("<h1>" + html.EscapeString(header) + "</h1>\n<pre>")

	// write the diff
	for _, chunk := range diff {
		txt := html.EscapeString(chunk.Text)
		txt = strings.Replace(txt, "\n", "↩\n", -1)
		switch chunk.Type {
		case diffmatchpatch.DiffInsert:
			out.WriteString(`<ins style="background:#e6ffe6;">`)
			out.WriteString(txt)
			out.WriteString(`</ins>`)
		case diffmatchpatch.DiffDelete:
			out.WriteString(`<del style="background:#ffe6e6;">`)
			out.WriteString(txt)
			out.WriteString(`</del>`)
		case diffmatchpatch.DiffEqual:
			out.WriteString(`<span>`)
			out.WriteString(txt)
			out.WriteString(`</span>`)
		}
	}
	if out.Len() > MaxDetailsLen {
		out.Truncate(MaxDetailsLen)
		out.WriteString("\n\n[TRUNCATED]")
	}
	out.WriteString("</pre>")
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
