.SUFFIXES:
.SUFFIXES: .sml .out .xml

SMLSOURCE=$(wildcard *.sml)
TESTSOURCE=$(wildcard tests/*.sml)

# Debian and Ubuntu are both missing a symlink for libpolyml.so
# attempt to detect and fix this automatically
libactual := $(shell find /usr/lib -type f -name libpolyml.so.*)
libexpected := $(shell find /usr/lib -type f -name libpolyml.so.* | sed 's/\.so.*/.so/')
libcount := $(shell find /usr/lib -type f -name libpolyml.so.* | wc -l | tr -d ' ')

# find the main source file
sml_count := $(shell ls | grep '\.sml$$' | wc -l | tr -d ' ')
main_sml_count := $(shell ls | grep '^main\.sml$$' | wc -l | tr -d ' ')
fun_main_count := $(shell grep -l '^fun main\b' $(SMLSOURCE) | wc -l | tr -d ' ')

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

a.out:	$(SMLSOURCE) $(TESTSOURCE) $(libexpected)
	polyc tests/tests.sml

$(libexpected):	$(libactual)
ifeq ($(libcount), 1)
	sudo ln -rsf $(libactual) $(libexpected)
endif

setup:
	sudo apt install -y polyml rlwrap make

clean:
	rm -f test_detail.xml a.out
