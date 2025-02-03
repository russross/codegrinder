.SUFFIXES:
.SUFFIXES: .o .s .si .out .xml .input .expected .actual

ASFLAGS=-g -Wall -Werror -target riscv64-unknown-elf -march=rv64im
LDFLAGS=-g -Wl,--discard-locals -Wall -Werror -target riscv64-unknown-elf -march=rv64im -nostdlib
AS=clang
LD=clang
AOUT=python3 lib/rv64sim -m run

ALLOBJECT=$(sort $(patsubst %.s,%.o,$(wildcard *.s)))
START=$(filter start.o, $(ALLOBJECT))
AOUTOBJECT=$(START) $(filter-out $(START), $(ALLOBJECT))

STEPPER_DELAY=0.01
STEPPER_WARMUPDELAY=0.1
STEPPER_POSTCRASHLINES=15
STEPPER_WRONGLINES=10
STEPPER_SUFFIX=input
STEPPER_INDIR=inputs
STEPPER_OUTDIR=inputs
STEPPER_CMD=$(AOUT)
export STEPPER_DELAY STEPPER_WARMUPDELAY STEPPER_POSTCRASHLINES STEPPER_WRONGLINES
export STEPPER_SUFFIX STEPPER_INDIR STEPPER_OUTDIR STEPPER_CMD

all:	step

grade:	a.out
	rm -f test_details.xml inputs/*.actual
	python3 lib/grader

run:	a.out
	$(AOUT)

step:	a.out
	python3 lib/stepper

trace:	a.out
	python3 lib/rv64sim -m trace

debug:	a.out
	python3 lib/rv64sim -m debug

.s.o:
	$(AS) $(ASFLAGS) -c $<

a.out:	$(AOUTOBJECT)
	$(LD) $(LDFLAGS) $^

setup:
	sudo apt install curl clang lld lldb icdiff make python3 qemu-user-binfmt

clean:
	rm -f *.o *.out *.xml core
