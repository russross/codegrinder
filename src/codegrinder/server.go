package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io/ioutil"
	"log"
	"log/syslog"
	"net/http"
	"os"

	"github.com/go-martini/martini"
	"github.com/gorilla/websocket"
)

type Action struct {
	Type  string
	Files map[string]string
}

var loge, logi log.Logger
var Config struct {
	ToolName          string
	ToolID            string
	ToolDescription   string
	OAuthSharedSecret string
	PublicURL         string
	StaticDir         string
	SessionSecret     string
}

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
	setupLogging(useSyslog)

	// set up martini
	r := martini.NewRouter()
	m := martini.New()
	m.Use(martini.Logger())
	m.Use(martini.Recovery())
	m.Use(martini.Static(Config.StaticDir, martini.StaticOptions{SkipLogging: true}))
	m.MapTo(r, (*martini.Routes)(nil))
	m.Action(r.Handle)

	m.Map(logi)
	m.Use(render.Rederer(render.Options{IndentJSON: true}))
	m.Use(sessions.Sessions("codegrinder_session", sessions.NewCookieStore([]byte(Config.SessionSecret))))

	// set up secretary role
	if secretary {
		// LTI
		r.Get("/lti/config.xml", GetConfigXML)
		r.Post("/lti/problems", binding.Bind(LTIRequest{}), checkOAuthSignature, transaction, LtiProblems)
		r.Post("/lti/problems/:unique", binding.Bind(LTIRequest{}), checkOAuthSignature, transaction, LtiProblem)

		// problem types
		r.Get("/api/v2/problemtypes", AuthenticationRequired, transaction, GetProblemTypes)
		r.Get("/api/v2/problemtypes/:name", AuthenticationRequired, transaction, GetProblemType)

		// problems
		r.Get("/api/v2/problems", AuthenticationRequired, transaction, GetProblems)
		r.Get("/api/v2/problems/:id", AuthenticationRequired, transaction, GetProblem)

		// problem steps

		// users

		// courses

		// assignments

		// commits
	}

	// set up daycare role
	if daycare {
	}

	// attach and try a ping
	var err error
	dockerClient, err = docker.NewVersionedClient("unix:///var/run/docker.sock", "1.18")
	if err != nil {
		log.Fatalf("NewVersionedClient: %v", err)
	}
	if err = dockerClient.Ping(); err != nil {
		log.Fatalf("Ping: %v", err)
	}

	// set up a web handler
	m := martini.Classic()
	m.Get("/python2unittest", func(w http.ResponseWriter, r *http.Request) {
		// set up websocket
		socket, err := websocket.Upgrade(w, r, nil, 1024, 1024)
		if err != nil {
			log.Printf("websocket error: %v", err)
			http.Error(w, "websocket error", http.StatusBadRequest)
			return
		}
		log.Printf("websocket upgraded")

		// get the first message
		var action Action
		if err := socket.ReadJSON(&action); err != nil {
			log.Printf("error reading Action message: %v", err)
			socket.Close()
			return
		}
		log.Printf("read request: type = %s", action.Type)

		// launch a nanny process
		n, err := NewNanny("codegrinder/python2", "foo")
		if err != nil {
			log.Fatalf("error creating nanny")
		}

		// start a listener
		finished := make(chan struct{})
		go func() {
			for event := range n.Events {
				// feed events back to client
				if err := socket.WriteJSON(event); err != nil {
					log.Printf("error writing event JSON: %v", err)
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
			log.Printf("nanny shutdown error: %v", err)
		}

		// wait for listener to finish
		close(n.Events)
		<-finished

		socket.Close()
	})
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
		loge = f(syslog.LOG_ERR, "[e] ", log.Lshortfile, log.Lshortfile)
		lowi = f(syslog.LOG_INFO, "[i] ", 0)
	} else {
		loge = log.New(os.Stderr, "[e] ", log.Ltime|log.Lmicroseconds|log.Lshortfile)
		logi = log.New(os.Stderr, "[i] ", log.Ltime|log.Lmicroseconds)
	}
}

func HTTPErrorf(w http.ResponseWriter, status http.Status, format string, params ...interface{}) error {
	msg := fmt.Sprintf(format, params...)
	http.Error(w, msg, status)
	return error.New(msg)
}
