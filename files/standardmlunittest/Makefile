.SUFFIXES:
.SUFFIXES: .sml .out .xml

SMLSOURCE=$(wildcard *.sml)
TESTSOURCE=$(wildcard tests/*.sml)

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

all:	test

test:	a.out
	./a.out

grade:	a.out
	rm -f test_detail.xml
	./a.out

run:
	rlwrap poly -H 16 --use $(SMLMAIN)

shell:
	rlwrap poly -H 16

a.out:	$(SMLSOURCE) $(TESTSOURCE)
	polyc tests/tests.sml

setup:
	sudo apt install -y polyml rlwrap make
	sudo cp -P /usr/lib/x86_64-linux-gnu/libpolyml.so.9 /usr/lib/x86_64-linux-gnu/libpolyml.so

clean:
	rm -f test_detail.xml a.out
