package main

import (
	"bytes"
	"crypto/tls"
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"html"
	"io/ioutil"
	"log"
	"net/http"
	"net/url"
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
)

// Config holds site-specific configuration data.
// Contains a mix of Daycare and main server parameters.
var Config struct {
	ToolName          string // LTI human readable name: "CodeGrinder"
	ToolID            string // LTI unique ID: "codegrinder"
	ToolDescription   string // LTI description: "Programming exercises with grading"
	OAuthSharedSecret string // LTI authentication shared secret. Must match that given to Canvas course: "asdf..."
	PublicURL         string // Base URL for the site: "https://your.host.goes.here"
	PublicWSURL       string // Base URL for websockets: "wss://your.host.goes.here"
	HTTPAddress       string // Address to bind on for HTTP connections: ":80"
	HTTPSAddress      string // Address to bind on for HTTPS connections: ":443"
	CertFile          string // Full path of TLS certificate file: "/etc/codegrinder/hostname.crt"
	KeyFile           string // Full path of TLS key file: "/etc/codegrinder/hostname.key"
	StaticDir         string // Full path of directory holding static files to serve: "/home/foo/codegrinder/client"
	SessionSecret     string // Random string used to sign cookie sessions: "asdf..."
	DaycareSecret     string // Random string used to sign daycare requests: "asdf..."
	PostgresHost      string // Host parameter for Postgres: "/var/run/postgresql"
	PostgresPort      string // Port parameter for Postgres: "5432"
	PostgresUsername  string // Username parameter for Postgres: "codegrinder"
	PostgresPassword  string // Password parameter for Postgres: "super$trong"
	PostgresDatabase  string // Database parameter for Postgres: "codegrinder"
}

var problemTypes = make(map[string]*ProblemType)

func main() {
	// parse command line
	var configFile string
	flag.StringVar(&configFile, "config", "config.json", "Name of the config file")
	var ta, daycare bool
	flag.BoolVar(&ta, "ta", true, "Serve the TA role")
	flag.BoolVar(&daycare, "daycare", true, "Serve the daycare role")
	flag.Parse()

	if !ta && !daycare {
		log.Fatalf("must run at least one role (ta/daycare)")
	}

	// load config
	if raw, err := ioutil.ReadFile(configFile); err != nil {
		log.Fatalf("failed to load config file %q: %v", configFile, err)
	} else if err := json.Unmarshal(raw, &Config); err != nil {
		log.Fatalf("failed to parse config file: %v", err)
	}

	// set up martini
	r := martini.NewRouter()
	m := martini.New()
	m.Use(martini.Logger())
	m.Use(martini.Recovery())
	m.Use(martini.Static(Config.StaticDir, martini.StaticOptions{SkipLogging: true}))
	m.MapTo(r, (*martini.Routes)(nil))
	m.Action(r.Handle)

	m.Use(render.Renderer(render.Options{IndentJSON: true}))

	store := sessions.NewCookieStore([]byte(Config.SessionSecret))
	m.Use(sessions.Sessions("codegrinder_session", store))

	// sessions expire June 30 and December 31
	go func() {
		for {
			now := time.Now()
			expires := time.Date(now.Year(), time.December, 31, 23, 59, 59, 0, time.Local)
			if expires.Sub(now).Hours() > 365/2*24 {
				expires = time.Date(now.Year(), time.June, 30, 23, 59, 59, 0, time.Local)
			}
			store.Options(sessions.Options{MaxAge: int(expires.Sub(now).Seconds())})
			time.Sleep(time.Minute)
		}
	}()

	// set up TA role
	if ta {
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
				loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
				return
			}

			// map the current user to the request context
			c.Map(user)
		}

		// 		// martini service: require logged in user to be an author or administrator (requires withCurrentUser)
		// 		authorOnly := func(w http.ResponseWriter, tx *sql.Tx, currentUser *User) {
		// 			if currentUser.Admin {
		// 				return
		// 			}
		// 			if !currentUser.Author {
		// 				loggedHTTPErrorf(w, http.StatusUnauthorized, "user %d (%s) is not an author", currentUser.ID, currentUser.Email)
		// 				return
		// 			}
		// 		}
		//
		// 		// martini service: require logged in user to be an instructor for a specific course or an administrator (requires withCurrentUser)
		// 		instructorForCourseOnly := func(courseFieldName string) func(w http.ResponseWriter, tx *sql.Tx, currentUser *User, params martini.Params) {
		// 			return func(w http.ResponseWriter, tx *sql.Tx, currentUser *User, params martini.Params) {
		// 				courseID, err := parseID(w, courseFieldName, params[courseFieldName])
		// 				if err != nil {
		// 					return
		// 				}
		// 				if currentUser.Admin {
		// 					return
		// 				}
		// 				courses, err := currentUser.getInstructorCourses(tx)
		// 				if err != nil {
		// 					loggedHTTPErrorf(w, http.StatusInternalServerError, "error checking user credentials: %v", err)
		// 					return
		// 				}
		// 				if !int64Contains(courses, courseID) {
		// 					loggedHTTPErrorf(w, http.StatusUnauthorized, "user %d (%s) is not an instructor for course %d", currentUser.ID, currentUser.Email, courseID)
		// 				}
		// 			}
		// 		}
		//
		// 		// martini service: require logged in user to be the requested user or an instructor for a course that user is in or an administrator (requires withCurrentUser)
		// 		instructorForUserOnly := func(userFieldName string) func(w http.ResponseWriter, tx *sql.Tx, currentUser *User, params martini.Params) {
		// 			return func(w http.ResponseWriter, tx *sql.Tx, currentUser *User, params martini.Params) {
		// 				userID, err := parseID(w, userFieldName, params[userFieldName])
		// 				if err != nil {
		// 					return
		// 				}
		// 				if currentUser.Admin {
		// 					return
		// 				}
		// 				if currentUser.ID == userID {
		// 					return
		// 				}
		// 				courses, err := currentUser.getInstructorCourses(tx)
		// 				if err != nil {
		// 					loggedHTTPErrorf(w, http.StatusInternalServerError, "error checking user credentials: %v", err)
		// 					return
		// 				}
		// 				if len(courses) == 0 {
		// 					loggedHTTPErrorf(w, http.StatusUnauthorized, "user %d (%s) is not an instructor for any course", currentUser.ID, currentUser.Email)
		// 					return
		// 				}
		//
		// 				courseList := ""
		// 				for _, elt := range courses {
		// 					if len(courseList) > 0 {
		// 						courseList += ","
		// 					}
		// 					courseList += strconv.FormatInt(elt, 10)
		// 				}
		//
		// 				var matches int64
		// 				if err := tx.QueryRow(`SELECT COUNT(1) FROM assignments WHERE user_id = $1 AND course_id in (`+courseList+`)`, userID).Scan(&matches); err != nil {
		// 					loggedHTTPErrorf(w, http.StatusInternalServerError, "db error: %v", err)
		// 					return
		// 				}
		// 				if matches == 0 {
		// 					loggedHTTPErrorf(w, http.StatusUnauthorized, "user %d (%s) is not an instructor for a course for user %d", currentUser.ID, currentUser.Email, userID)
		// 				}
		// 			}
		// 		}
		//
		// 		// martini service: require logged in user to be an administrator (requires withCurrentUser)
		// 		administratorOnly := func(w http.ResponseWriter, currentUser *User) {
		// 			if !currentUser.Admin {
		// 				loggedHTTPErrorf(w, http.StatusUnauthorized, "user %d (%s) is not an administrator", currentUser.ID, currentUser.Email)
		// 				return
		// 			}
		// 		}

		// LTI
		r.Get("/v2/lti/config.xml", GetConfigXML)
		r.Post("/v2/lti/problem_sets", binding.Bind(LTIRequest{}), checkOAuthSignature, withTx, LtiProblemSets)
		r.Post("/v2/lti/problem_sets/:unique", binding.Bind(LTIRequest{}), checkOAuthSignature, withTx, LtiProblemSet)

		// problem bundles--for problem creation only
		r.Post("/v2/problem_bundles/unconfirmed", auth, withTx, withCurrentUser, binding.Json(ProblemBundle{}), PostProblemBundleUnconfirmed)
		r.Post("/v2/problem_bundles/confirmed", auth, withTx, withCurrentUser, binding.Json(ProblemBundle{}), PostProblemBundleConfirmed)
		r.Put("/v2/problem_bundles/:problem_id", auth, withTx, withCurrentUser, binding.Json(ProblemBundle{}), PutProblemBundle)

		// problem set bundles--for problem set creation only
		r.Post("/v2/problem_set_bundles", auth, withTx, withCurrentUser, binding.Json(ProblemSetBundle{}), PostProblemSetBundle)

		// problem types
		r.Get("/v2/problemtypes", auth, GetProblemTypes)
		r.Get("/v2/problemtypes/:name", auth, GetProblemType)

		// problems
		r.Get("/v2/problems", auth, withTx, withCurrentUser, GetProblems)
		r.Get("/v2/problems/:problem_id", auth, withTx, GetProblem)
		r.Get("/v2/problems/:problem_id/steps", auth, withTx, GetProblemSteps)
		r.Get("/v2/problems/:problem_id/steps/:step", auth, withTx, GetProblemStep)
		r.Delete("/v2/problems/:problem_id", auth, withTx, withCurrentUser, DeleteProblem)

		// problem sets
		r.Get("/v2/problem_sets", auth, withTx, withCurrentUser, GetProblemSets)
		r.Get("/v2/problem_sets/:problem_set_id", auth, withTx, GetProblemSet)
		r.Get("/v2/problem_sets/:problem_set_id/problems", auth, withTx, GetProblemSetProblems)
		r.Delete("/v2/problem_sets/:problem_set_id", auth, withTx, withCurrentUser, DeleteProblemSet)

		// users
		r.Get("/v2/users", auth, withTx, withCurrentUser, GetUsers)
		r.Get("/v2/users/me", auth, withTx, withCurrentUser, GetUserMe)
		r.Get("/v2/users/me/cookie", auth, UserCookie)
		r.Get("/v2/users/:user_id", auth, withTx, withCurrentUser, GetUser)
		r.Get("/v2/courses/:course_id/users", auth, withTx, withCurrentUser, GetCourseUsers)
		r.Delete("/v2/users/:user_id", auth, withTx, withCurrentUser, DeleteUser)

		// courses
		r.Get("/v2/courses", auth, withTx, withCurrentUser, GetCourses)
		r.Get("/v2/courses/:course_id", auth, withTx, GetCourse)
		//r.Get("/v2/users/:user_id/courses", auth, withTx, withCurrentUser, GetUserCourses)
		r.Delete("/v2/courses/:course_id", auth, withTx, withCurrentUser, DeleteCourse)

		// assignments
		r.Get("/v2/users/:user_id/assignments", auth, withTx, withCurrentUser, GetUserAssignments)
		//r.Get("/v2/courses/:course_id/assignments", auth, withTx, withCurrentUser, GetCourseAssignments)
		//r.Get("/v2/courses/:course_id/users/:user_id/assignments", auth, withTx, withCurrentUser, GetCourseUserAssignments)
		r.Get("/v2/assignments/:assignment_id", auth, withTx, withCurrentUser, GetAssignment)
		r.Delete("/v2/assignments/:assignment_id", auth, withTx, withCurrentUser, DeleteAssignment)

		// commits
		//r.Get("/v2/assignments/:assignment_id/commits", auth, withTx, withCurrentUser, GetCommits)
		//r.Get("/v2/commits/:commit_id", auth, withTx, withCurrentUser, GetCommit)
		//r.Delete("/v2/commits/:commit_id", auth, withTx, withCurrentUser, DeleteCommit)
	}

	// set up daycare role
	if daycare {
		// attach to docker and try a ping
		var err error
		dockerClient, err = docker.NewVersionedClient("unix:///var/run/docker.sock", "1.18")
		if err != nil {
			log.Fatalf("NewVersionedClient: %v", err)
		}
		if err = dockerClient.Ping(); err != nil {
			log.Fatalf("Ping: %v", err)
		}

		r.Get("/v2/sockets/:problem_type/:action", SocketProblemTypeAction)
	}

	// start web server
	log.Printf("starting http -> https forwarder")
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
		log.Printf("redirecting http request from %s to %s", addr, u.String())
		http.Redirect(w, r, u.String(), http.StatusMovedPermanently)
	}))

	log.Printf("accepting https connections at %s", Config.HTTPSAddress)
	tls := &tls.Config{MinVersion: tls.VersionTLS10}
	server := &http.Server{Addr: Config.HTTPSAddress, Handler: m, TLSConfig: tls}
	if err := server.ListenAndServeTLS(Config.CertFile, Config.KeyFile); err != nil {
		log.Fatalf("ListenAndServeTLS: %v", err)
	}
}

func setupDB(host, port, user, password, database string) *sql.DB {
	log.Printf("connecting to database at host=%s port=%s", host, port)
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

func mustMarshal(elt interface{}) []byte {
	raw, err := json.Marshal(elt)
	if err != nil {
		log.Fatalf("json Marshal error for % #v", elt)
	}
	return raw
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

func dump(elt interface{}) {
	raw, err := json.MarshalIndent(elt, "", "    ")
	if err != nil {
		panic("JSON encoding error in dump: " + err.Error())
	}
	fmt.Printf("%s\n", raw)
}
