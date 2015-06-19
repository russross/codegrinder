package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/codegangsta/cli"
	"github.com/russross/gcfg"
)

const ProblemConfigName string = "problem.cfg"

func CommandCreate(context *cli.Context) {
	// find the directory
	d := context.Args().First()
	if d == "" {
		d = "."
	}
	if context.Args().First() != "" {
		cli.ShowSubcommandHelp(context)
		return
	}
	dir, err := filepath.Abs(d)
	if err != nil {
		log.Fatalf("error finding directory %q: %v", d, err)
	}

	// find the problem.cfg file
	for {
		path := filepath.Join(dir, ProblemConfigName)
		if _, err := os.Stat(path); err != nil {
			if err == os.ErrNotExist {
				// try moving up a directory
				old := dir
				dir = filepath.Dir(dir)
				if dir == old {
					log.Fatalf("unable to find %s in %s or an ancestor directory", ProblemConfigName, d)
				}
				fmt.Printf("could not find %s in %s, trying %s", ProblemConfigName, old, dir)
			}

			log.Fatalf("error searching for %s in %s: %v", ProblemConfigName, dir, err)
		}
		break
	}

	// parse problem.cfg
	cfg := struct {
		Problem struct {
			Type   string
			Name   string
			Unique string
			Desc   string
			Tag    []string
			Option []string
		}
		Step map[string]*struct {
			Name   string
			Weight float64
		}
	}{}

	configPath := filepath.Join(dir, ProblemConfigName)
	fmt.Printf("reading %s\n", configPath)
	err = gcfg.ReadFileInto(&cfg, configPath)
	if err != nil {
		log.Fatalf("failed to parse %s: %v", configPath, err)
	}

	// create problem object
	problem := &Problem{
		Name:        cfg.Problem.Name,
		Unique:      cfg.Problem.Unique,
		Description: cfg.Problem.Desc,
		ProblemType: cfg.Problem.Type,
		Tags:        cfg.Problem.Tag,
		Options:     cfg.Problem.Option,
	}

	// import steps
	for i := 1; cfg.Step[strconv.Itoa(i)] != nil; i++ {
		s := cfg.Step[strconv.Itoa(i)]
		step := &ProblemStep{
			Name:        s.Name,
			ScoreWeight: s.Weight,
			Files:       make(map[string]string),
		}

		// read files
		stepdir := filepath.Join(dir, strconv.Itoa(i))
		err := filepath.Walk(stepdir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				log.Fatalf("walk error for %s: %v", path, err)
			}
			if info.IsDir() {
				return nil
			}

			// TODO: filter out junk files, *~, *.bak, etc.
			if strings.HasPrefix(path, ".") {
				return nil
			}

			contents, err := ioutil.ReadFile(path)
			if err != nil {
				log.Fatalf("error reading %s: %v", path, err)
			}
			fmt.Printf("loaded %s with %d bytes\n", path, len(contents))
			step.Files[path] = string(contents)
			return nil
		})
		if err != nil {
			log.Fatalf("walk error for %s: %v", stepdir, err)
		}

		problem.Steps = append(problem.Steps, step)
	}

	if len(problem.Steps) != len(cfg.Step) {
		log.Fatalf("expected to find %d steps, but only found %d", len(cfg.Step), len(problem.Steps))
	}

	fmt.Printf("problem so far:\n")
	raw, err := json.MarshalIndent(problem, "", "    ")
	if err != nil {
		log.Fatalf("JSON encoding error: %v", err)
	}
	fmt.Printf("%s\n", raw)
}
