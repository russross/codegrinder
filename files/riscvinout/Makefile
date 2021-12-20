.SUFFIXES:
.SUFFIXES: .o .c .s .out .xml .log .input .expected .actual

ASFLAGS=-ggdb --warn --fatal-warnings -march=rv64imd -mno-relax
LDFLAGS=--fatal-warnings
PREFIX=riscv64-unknown-elf
RUN=qemu-riscv64
ASSEMBLER=$(shell which $(PREFIX)-as)

ALLOBJECT=$(sort \
	$(patsubst %.s,%.o,$(wildcard *.s)) \
	$(patsubst %.s,%.o,$(wildcard lib/*.s)))
LIBOBJECT=$(patsubst %.s,%.o,$(wildcard lib/*.s))
AOUTOBJECT=$(filter-out test.o, $(filter-out $(LIBOBJECT), $(ALLOBJECT)))
TESTOUTOBJECT=$(filter-out start.o, $(ALLOBJECT))

all:	step

test:	test.out
	python3 lib/inout-runner.py input $(RUN) ./test.out

grade:	test.out
	rm -f test_details.xml inputs/*.actual
	python3 lib/inout-runner.py input $(RUN) ./test.out

run:	a.out
	$(RUN) ./a.out

step:	test.out
	python3 lib/inout-stepall.py input $(RUN) ./test.out

debug:	test.out $(HOME)/.gdbinit
	$(PREFIX)-gdb ./test.out

$(HOME)/.gdbinit:
	echo set auto-load safe-path / > $(HOME)/.gdbinit

.s.o:
ifeq ("$(ASSEMBLER)", "")
	$(error this should only be run on the cs2810.cs.dixie.edu server)
endif
	$(PREFIX)-as $(ASFLAGS) $< -o $@

a.out:	$(AOUTOBJECT)
	$(PREFIX)-ld $(LDFLAGS) $^

test.out:	$(TESTOUTOBJECT)
	$(PREFIX)-ld $(LDFLAGS) $^ -o $@

clean:
	rm -f $(ALLOBJECT) *.out *.xml *.log core
