.SUFFIXES:
.SUFFIXES: .o .c .s .check .out .xml .log

ASFLAGS=-g --warn --fatal-warnings
CFLAGS=-g -Os -std=c99 -pthread -Wpedantic -Wall -Wextra -Werror
CHECKLIBS=$(shell pkg-config --libs check)
LDFLAGS=--fatal-warnings
MACHINE=$(shell uname -m)

ALLOBJECT=$(sort \
	$(patsubst %.c,%.o,$(wildcard *.c)) \
	$(patsubst %.s,%.o,$(wildcard *.s)) \
	$(patsubst %.s,%.o,$(wildcard lib/*.s)) \
	$(patsubst %.check,%.o,$(wildcard *.check)))
CHECKC=$(patsubst %.check,%.c,$(wildcard *.check))
CCOUNT=$(words $(filter-out $(CHECKC), $(wildcard *.c)))
LIBOBJECT=$(patsubst %.s,%.o,$(wildcard lib/*.s))
AOUTOBJECT=$(filter-out $(CHECKC:.c=.o), $(filter-out $(LIBOBJECT), $(ALLOBJECT)))
UNITOBJECT=$(filter-out main.o start.o, $(ALLOBJECT))

all:	step

test:	a.out
	python3 lib/inout-runner.py input ./a.out

grade:	a.out
	rm -f test_detail.xml inputs/*.actual
	python3 lib/inout-runner.py input ./a.out

valgrind:	a.out
	rm -f valgrind.log
	-valgrind --leak-check=full --track-fds=yes --log-file=valgrind.log ./a.out
	cat valgrind.log

run:	a.out
	./a.out

step:	a.out
	python3 lib/inout-stepall.py input ./a.out

debug:	a.out $(HOME)/.gdbinit
	gdb ./a.out

$(HOME)/.gdbinit:
	echo set auto-load safe-path / > $(HOME)/.gdbinit

.s.o:
ifneq ($(MACHINE), aarch64)
	$(error this should only be run on the cs2810.cs.dixie.edu server)
endif
	as $(ASFLAGS) $< -o $@

.c.o:
	gcc $(CFLAGS) $< -c -o $@

.check.c:
	checkmk $< > $@

a.out:	$(AOUTOBJECT)
ifeq ($(CCOUNT), 0)
	ld $(LDFLAGS) $^
else
	gcc $(CFLAGS) $^ -o $@
endif

unittest.out:	$(UNITOBJECT)
	gcc $(CFLAGS) $^ $(CHECKLIBS) -o $@

setup:
	# install build tools, unit test library, and valgrind
	sudo apt install -y build-essential make gdb valgrind check pkg-config python3

clean:
	rm -f $(ALLOBJECT) $(CHECKC) *.out *.xml *.log
