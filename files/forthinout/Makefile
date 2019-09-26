.SUFFIXES:
.SUFFIXES: .fs .xml

FORTHSOURCE=$(wildcard *.fs)

# find the main source file
fs_count := $(shell ls | grep '\.fs$$' | wc -l)
main_forth_count := $(shell ls | grep '^main\.fs$$' | wc -l)
word_main_count := $(shell grep -l '^: main\b' $(FORTHSOURCE) | wc -l)

ifeq ($(forth_count), 1)
    FORTHMAIN := $(shell ls *.forth)
else ifeq ($(main_forth_count), 1)
    FORTHMAIN := main.forth
else ifeq ($(word_main_count), 1)
    FORTHMAIN := $(shell grep -l '^: main\b' $(FORTHSOURCE))
else
    FORTHMAIN := NO_MAIN_FORTH_FILE
endif

all:	step

test:
	python3 bin/inout-runner.py gforth $(FORTHMAIN)

grade:
	rm -f test_detail.xml
	python3 bin/inout-runner.py gforth $(FORTHMAIN)

run:
	gforth $(FORTHMAIN)

step:
	python3 bin/inout-stepall.py gforth $(FORTHMAIN)

shell:
	gforth

setup:
	sudo apt install -y gforth make python3

clean:
	rm -f test_detail.xml
