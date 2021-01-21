.SUFFIXES:
.SUFFIXES: .o .c .check .out .xml .log

CFLAGS=-g -std=c99 -pthread -Wpedantic -Wall -Wextra -Werror
LIBS=$(shell pkg-config --libs check)

ALLCSOURCE=$(wildcard *.c)
TESTSOURCE=$(wildcard *.check)
TESTCSOURCE=$(TESTSOURCE:.check=.c)
TESTOBJECT=$(TESTSOURCE:.check=.o)
AOUTSOURCE=$(filter-out $(TESTCSOURCE), $(ALLCSOURCE))
AOUTOBJECT=$(AOUTSOURCE:.c=.o)
UNITSOURCE=$(filter-out main.c, $(filter-out $(TESTCSOURCE), $(ALLCSOURCE)))
UNITOBJECT=$(UNITSOURCE:.c=.o)

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

.c.o:
	gcc $(CFLAGS) $< -c -o $@

.check.c:
	checkmk $< > $@

a.out:	$(AOUTOBJECT)
	gcc $(CFLAGS) $(AOUTOBJECT) -o $@

unittest.out:	$(TESTOBJECT) $(UNITOBJECT)
	gcc $(CFLAGS) $(TESTOBJECT) $(UNITOBJECT) $(LIBS) -o $@

setup:
	# install build tools, unit test library, and valgrind
	sudo apt install -y build-essential make gdb valgrind check pkg-config

clean:
	rm -f $(AOUTOBJECT) $(LIBOBJECT) $(TESTOBJECT) $(TESTSOURCE:.check=.c) *.out *.xml *.log
