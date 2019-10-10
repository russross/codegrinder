.SUFFIXES:
.SUFFIXES: .s .o .c .check .out .xml .log

ASFLAGS=-g --warn --fatal-warnings
CFLAGS=-g -std=c99 -pthread -Wpedantic -Wall -Wextra -Werror
LIBS=$(shell pkg-config --libs check)
LDFLAGS=--fatal-warnings

AOUTSOURCE=$(wildcard *.s)
AOUTOBJECT=$(AOUTSOURCE:.s=.o)
UNITSOURCE=$(filter-out start.s, $(AOUTSOURCE))
UNITOBJECT=$(UNITSOURCE:.s=.o)
LIBSOURCE=$(wildcard lib/*.s)
LIBOBJECT=$(LIBSOURCE:.s=.o)
TESTSOURCE=$(wildcard tests/*.check)
TESTOBJECT=$(TESTSOURCE:.check=.o)

all:	test

test:	unittest.out
	./unittest.out

grade:	unittest.out
	./unittest.out

valgrind:	unittest.out
	rm -f valgrind.log
	-valgrind --leak-check=full --track-fds=yes --log-file=valgrind.log ./unittest.out
	cat valgrind.log

run:	a.out
	./a.out

debug:	a.out $(HOME)/.gdbinit
	gdb ./a.out

$(HOME)/.gdbinit:
	echo set auto-load safe-path / > $(HOME)/.gdbinit

.s.o:
	as $(ASFLAGS) $< -o $@

.c.o:
	gcc $(CFLAGS) $< -c -o $@

.check.c:
	checkmk $< > $@

a.out:	$(AOUTOBJECT)
	ld $(LDFLAGS) $^

unittest.out:	$(TESTOBJECT) $(LIBOBJECT) $(UNITOBJECT)
	gcc $(CFLAGS) $(TESTOBJECT) $(LIBOBJECT) $(UNITOBJECT) $(LIBS) -o $@

setup:
	# install build tools, unit test library, and valgrind
	sudo apt-get install -y build-essential gdb valgrind check pkg-config

clean:
	rm -f $(AOUTOBJECT) $(LIBOBJECT) $(TESTOBJECT) $(TESTSOURCE:.check=.c) *.out *.xml *.log
