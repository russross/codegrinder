.SUFFIXES:
.SUFFIXES: .o .s .si .out .xml .input .expected .actual

ASFLAGS=-g --warn --fatal-warnings -march=rv64im
LDFLAGS=--fatal-warnings
ifneq ("$(shell which riscv64-linux-gnu-as)", "")
	PREFIX=riscv64-linux-gnu-
else ifneq ("$(shell which riscv64-unknown-elf-as)", "")
	PREFIX=riscv64-unknown-elf-
else ifneq ("$(shell which riscv64-alpine-linux-musl-as)", "")
	PREFIX=riscv64-alpine-linux-musl-
else
	PREFIX=unknown
endif

ifeq ("$(shell uname -m)", "riscv64")
	AS=as
	LD=ld
	GDB=gdb
	AOUT=./a.out
	AOUTDEBUG=./a.out
else
	AS=$(PREFIX)as
	LD=$(PREFIX)ld
	GDB=gdb-multiarch
	AOUT=qemu-riscv64 ./a.out
	AOUTDEBUG=qemu-riscv64 -g 2810 ./a.out
endif

ALLOBJECT=$(sort $(patsubst %.s,%.o,$(wildcard *.s))) $(sort $(patsubst %.s,%.o,$(wildcard lib/*.s)))
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

fordebug:	a.out
	$(AOUTDEBUG)

debug:	a.out $(HOME)/.gdbinit
	$(GDB) ./a.out

$(HOME)/.gdbinit:
	echo set auto-load safe-path / > $(HOME)/.gdbinit

.s.o:
ifeq ("$(shell which $(AS))", "")
	$(error this should only be run on a machine with riscv support installed)
endif
	$(AS) $(ASFLAGS) $< -o $@

a.out:	$(AOUTOBJECT)
	$(LD) $(LDFLAGS) $^

setup:
	sudo apt install curl gcc-riscv64-linux-gnu gdb-multiarch icdiff make python3 qemu-user-binfmt

clean:
	rm -f *.o lib/*.o *.out *.xml core .gdb_history
