.SUFFIXES:
.SUFFIXES: .o .c .out .xml .log

CFLAGS=-g -Os -std=c99 -Wpedantic -Wall -Wextra -Werror
AOUTOBJECT=$(patsubst %.c,%.o,$(wildcard *.c))

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

.c.o:
	gcc $(CFLAGS) $< -c -o $@

a.out:	$(AOUTOBJECT)
	gcc $(CFLAGS) $^ -o $@

setup:
	# install build tools, unit test library, and valgrind
	sudo apt install -y build-essential make gdb valgrind python3

clean:
	rm -f $(AOUTOBJECT) *.out *.xml *.log core
