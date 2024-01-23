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
	PREFIX=
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

all:	step

grade:	a.out
	rm -f test_details.xml inputs/*.actual
	python3 lib/inout-runner.py input $(AOUT)

run:	a.out
	$(AOUT)

step:	a.out
	python3 lib/inout-stepall.py input $(AOUT)

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
	sudo apt install curl gcc-riscv64-linux-gnu gdb-multiarch git make micro python3 qemu-user-binfmt

clean:
	rm -f *.o lib/*.o *.out *.xml core .gdb_history
