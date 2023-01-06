.SUFFIXES:
.SUFFIXES: .o .s .si .out .xml .input .expected .actual

ASFLAGS=-ggdb --warn --fatal-warnings -march=rv64im
LDFLAGS=--fatal-warnings -Ttext 10b0
PREFIX=riscv64-unknown-elf
RUN=qemu-riscv64
ASSEMBLER=$(shell which $(PREFIX)-as)

ALLOBJECT=$(sort $(patsubst %.s,%.o,$(wildcard *.s))) $(sort $(patsubst %.s,%.o,$(wildcard lib/*.s)))
START=$(filter start.o, $(ALLOBJECT))
AOUTOBJECT=$(START) $(filter-out $(START), $(ALLOBJECT))

all:	step

test:	a.out
	python3 lib/inout-runner.py input $(RUN) ./a.out

grade:	a.out
	rm -f test_details.xml inputs/*.actual
	python3 lib/inout-runner.py input $(RUN) ./a.out

run:	a.out
	$(RUN) ./a.out

step:	a.out
	python3 lib/inout-stepall.py input $(RUN) ./a.out

debug:	a.out $(HOME)/.gdbinit
	$(PREFIX)-gdb ./a.out

$(HOME)/.gdbinit:
	echo set auto-load safe-path / > $(HOME)/.gdbinit

.s.o:
ifeq ("$(ASSEMBLER)", "")
	$(error this should only be run on the cs2810.cs.utahtech.edu server)
endif
	$(PREFIX)-as $(ASFLAGS) $< -o $@

a.out:	$(AOUTOBJECT)
	$(PREFIX)-ld $(LDFLAGS) $^
clean:
	rm -f *.o lib/*.o *.out *.xml core .gdb_history
