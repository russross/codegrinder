.SUFFIXES:
.SUFFIXES: .sml .out .xml

SMLSOURCE=$(wildcard *.sml)

# find the main source file
sml_count := $(shell ls | grep '\.sml$$' | wc -l)
main_sml_count := $(shell ls | grep '^main\.sml$$' | wc -l)
fun_main_count := $(shell grep -l '^fun main\b' $(SMLSOURCE) | wc -l)

ifeq ($(sml_count), 1)
    SMLMAIN := $(shell ls *.sml)
else ifeq ($(main_sml_count), 1)
    SMLMAIN := main.sml
else ifeq ($(fun_main_count), 1)
    SMLMAIN := $(shell grep -l '^fun main\b' $(SMLSOURCE))
else
    SMLMAIN := NO_MAIN_SML_FILE
endif

all:	step

test:	a.out
	python3 bin/inout-runner.py ./a.out

grade:	a.out
	rm -f test_detail.xml
	python3 bin/inout-runner.py ./a.out

run:	a.out
	rlwrap ./a.out

step:	a.out
	python3 bin/inout-stepall.py ./a.out

shell:
	rlwrap poly -H 16

a.out:	$(SMLSOURCE)
	polyc $(SMLMAIN)

setup:
	sudo apt install -y polyml rlwrap make python3
	sudo cp -P /usr/lib/x86_64-linux-gnu/libpolyml.so.9 /usr/lib/x86_64-linux-gnu/libpolyml.so

clean:
	rm -f test_detail.xml a.out inputs/*.actual
