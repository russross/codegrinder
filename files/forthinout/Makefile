.SUFFIXES:
.SUFFIXES: .fs .xml

FORTHSOURCE := $(wildcard *.fs)

# find the main source file
fs_count := $(shell ls | grep '\.fs$$' | wc -l | tr -d ' ')
main_fs_count := $(shell ls | grep '^main\.fs$$' | wc -l | tr -d ' ')
word_main_count := $(shell grep -l '^: main\b' $(FORTHSOURCE) | wc -l | tr -d ' ')

ifeq ($(fs_count), 1)
    FORTHMAIN := $(shell ls *.fs)
else ifeq ($(main_fs_count), 1)
    FORTHMAIN := main.fs
else ifeq ($(word_main_count), 1)
    FORTHMAIN := $(shell grep -l '^: main\b' $(FORTHSOURCE))
else
    FORTHMAIN := NO_MAIN_FORTH_FILE
endif

all:	step

test:
	python3 bin/inout-runner.py gforth $(FORTHMAIN) -e main -e bye

grade:
	rm -f test_detail.xml inputs/*.actual
	python3 bin/inout-runner.py gforth $(FORTHMAIN) -e main -e bye

run:
	gforth $(FORTHMAIN) -e main

step:
	python3 bin/inout-stepall.py gforth $(FORTHMAIN) -e main -e bye

shell:
	gforth

setup:
	sudo apt install -y gforth icdiff make python3

clean:
	rm -f test_detail.xml inputs/*.actual
