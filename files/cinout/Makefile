.SUFFIXES:
.SUFFIXES: .o .c .out .xml .log .input .expected .actual

CFLAGS=-g -Og -std=c17 -Wpedantic -Wall -Wextra -Werror
AOUTOBJECT=$(patsubst %.c,%.o,$(wildcard *.c))
STEPPER_DELAY=0.01
STEPPER_WARMUPDELAY=0.1
STEPPER_POSTCRASHLINES=15
STEPPER_WRONGLINES=10
STEPPER_SUFFIX=input
STEPPER_INDIR=inputs
STEPPER_OUTDIR=inputs
STEPPER_CMD=./a.out
export STEPPER_DELAY STEPPER_WARMUPDELAY STEPPER_POSTCRASHLINES STEPPER_WRONGLINES
export STEPPER_SUFFIX STEPPER_INDIR STEPPER_OUTDIR STEPPER_CMD

all:	step

grade:	a.out
	rm -f test_detail.xml inputs/*.actual
	python3 lib/grader

valgrind:	a.out
	rm -f valgrind.log
	-valgrind --leak-check=full --track-fds=yes --log-file=valgrind.log ./a.out
	cat valgrind.log

run:	a.out
	./a.out

step:	a.out
	python3 lib/stepper

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
	sudo apt install -y build-essential curl gdb icdiff make python3 valgrind

clean:
	rm -f $(AOUTOBJECT) *.out *.xml *.log core
