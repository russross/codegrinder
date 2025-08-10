.SUFFIXES:
.SUFFIXES: .o .opt.o .c .out .xml .input .transcript
.PHONY: all grade run step setup clean

CLANG_TIDY_CHECKS='-checks=bugprone-*,cert-*,clang-analyzer-*,readability-*,performance-*,-readability-magic-numbers,-readability-identifier-length,-readability-braces-around-statements'
DEBUG_CFLAGS=-g -Os -std=c2x -Wpedantic -Wall -Wextra -Werror -Wshadow -Wnull-dereference -Wunreachable-code -fsanitize=address -fsanitize=undefined
DEBUG_LDFLAGS=-g -fsanitize=address -fsanitize=undefined
OPT_CFLAGS=-g -Os -std=c2x -Wpedantic -Wall -Wextra -Werror -Wshadow -Wnull-dereference -Wunreachable-code
OPT_LDFLAGS=-g

DEBUG_SOURCES=$(filter-out %-opt.c, $(wildcard *.c))
OPT_SOURCES=$(filter-out %-test.c, $(wildcard *.c))
DEBUG_OBJECTS=$(DEBUG_SOURCES:.c=.o)
OPT_OBJECTS=$(OPT_SOURCES:.c=.opt.o)

STEPPER_CMD=./a.out
STEPPER_DIR=inputs
STEPPER_TIMEOUT=5
STEPPER_POSTERRORLINES=15
STEPPER_GRADE=false
export STEPPER_CMD STEPPER_DIR STEPPER_TIMEOUT STEPPER_POSTERRORLINES STEPPER_GRADE

all:	step

grade:	export STEPPER_GRADE := true
grade:	a.out
	@rm -f test_detail.xml
	python3 lib/stepper

run:	opt.out
	./opt.out

step:	a.out
	python3 lib/stepper

.c.o:
	clang-tidy -quiet -warnings-as-errors $(CLANG_TIDY_CHECKS) $< -- $(DEBUG_CFLAGS)
	clang $(DEBUG_CFLAGS) $< -c -o $@

.c.opt.o:
	clang $(OPT_CFLAGS) $< -c -o $@

a.out:	$(DEBUG_OBJECTS)
	clang $(DEBUG_LDFLAGS) $^ -o $@

opt.out: $(OPT_OBJECTS)
	clang $(OPT_LDFLAGS) $^ -o $@

setup:
	# install build tools
	sudo apt install -y curl clang lldb make python3

clean:
	rm -f core *.o *.opt.o *.out *.xml *.plist
