.SUFFIXES:
.SUFFIXES: .o .s .si .out .xml .input .transcript

ASFLAGS=-g -Wall -Werror -target riscv64-unknown-elf -march=rv64im
LDFLAGS=-g -Wl,--discard-locals -Wall -Werror -target riscv64-unknown-elf -march=rv64im -nostdlib -fuse-ld=lld
AS=clang
LD=clang
AOUT=risclet -m run

ALLOBJECT=$(sort $(patsubst %.s,%.o,$(wildcard *.s)))
START=$(filter start.o, $(ALLOBJECT))
AOUTOBJECT=$(START) $(filter-out $(START), $(ALLOBJECT))

STEPPER_CMD=$(AOUT)
STEPPER_DIR=inputs
STEPPER_TIMEOUT=5
STEPPER_POSTERRORLINES=15
STEPPER_GRADE=false
export STEPPER_CMD STEPPER_DIR STEPPER_TIMEOUT STEPPER_POSTERRORLINES STEPPER_GRADE

all:	step

grade:	export STEPPER_GRADE := true
grade:	a.out
	@rm -f test_details.xml
	python3 lib/stepper

run:	a.out
	$(AOUT)

step:	a.out
	python3 lib/stepper

trace:	a.out
	risclet -m trace

debug:	a.out
	risclet -m debug

.s.o:
	$(AS) $(ASFLAGS) -c $<

a.out:	$(AOUTOBJECT)
	$(LD) $(LDFLAGS) $^

setup:
	sudo apt install curl clang lld lldb make python3 qemu-user-binfmt

clean:
	rm -f core *.o *.out *.xml
