.SUFFIXES:
.SUFFIXES: .o .opt.o .c .out .xml .input .transcript
.PHONY: all grade run step setup clean

CSTD=-std=c18
SAN=-fsanitize=address,undefined -fno-omit-frame-pointer
WARN=-Wall -Wextra -Wpedantic -Wshadow -Wpointer-arith -Wcast-qual -Wwrite-strings -Wvla -Wstrict-prototypes -Wold-style-definition -Wformat=2 -Wswitch-enum
CLANG_TIDY_CHECKS=clang-analyzer-*,-clang-analyzer-osx*,-clang-analyzer-cplusplus*,bugprone-assignment-in-if-condition,bugprone-sizeof-expression,bugprone-suspicious-memset-usage,bugprone-suspicious-string-compare,bugprone-unhandled-self-assignment,-clang-analyzer-security.insecureAPI.DeprecatedOrUnsafeBufferHandling,-clang-analyzer-security.insecureAPI.strcpy
DEBUG_CFLAGS=$(CSTD) -O0 -g $(WARN) -Werror $(SAN)
DEBUG_LDFLAGS=$(SAN)
OPT_CFLAGS=$(CSTD) -O3 -g $(WARN) -Werror
OPT_LDFLAGS=

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
	clang-tidy -quiet -warnings-as-errors='*' -checks=$(CLANG_TIDY_CHECKS) $< -- $(DEBUG_CFLAGS)
	clang $(DEBUG_CFLAGS) -c $< -o $@

.c.opt.o:
	clang $(OPT_CFLAGS) -c $< -o $@

a.out:	$(DEBUG_OBJECTS)
	clang $(DEBUG_LDFLAGS) $^ -o $@

opt.out: $(OPT_OBJECTS)
	clang $(OPT_LDFLAGS) $^ -o $@

clean:
	rm -f core *.o *.opt.o *.out *.xml *.plist
