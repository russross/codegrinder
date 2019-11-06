.SUFFIXES:
.SUFFIXES: .s .o .out .xml .log

ASFLAGS=-g --warn --fatal-warnings
LDFLAGS=--fatal-warnings

AOUTSOURCE=$(wildcard *.s)
AOUTOBJECT=$(AOUTSOURCE:.s=.o)

all:	step

test:	a.out
	python3 bin/inout-runner.py ./a.out

grade:	a.out
	rm -f test_detail.xml inputs/*.actual
	python3 bin/inout-runner.py ./a.out

valgrind:	a.out
	rm -f valgrind.log
	-valgrind --leak-check=full --track-fds=yes --log-file=valgrind.log ./a.out
	cat valgrind.log

run:	a.out
	./a.out

step:	a.out
	python3 bin/inout-stepall.py ./a.out

debug:  a.out $(HOME)/.gdbinit
	gdb ./a.out

$(HOME)/.gdbinit:
	echo set auto-load safe-path / > $(HOME)/.gdbinit

.s.o:
	as $(ASFLAGS) $< -o $@

a.out:	$(AOUTOBJECT)
	ld $(LDFLAGS) $^

setup:
	# install build tools, python3, and valgrind
	sudo apt install -y build-essential make gdb valgrind python3

clean:
	rm -f $(AOUTOBJECT) *.out *.xml *.log
