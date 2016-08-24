.SUFFIXES:
.SUFFIXES: .s .o .out .ppm

ASMSOURCE=$(wildcard *.s)
ASMOBJECT=${ASMSOURCE:%.s=%.o}

all:	a.out

.s.o:
	as -g -march=armv6zk -mcpu=arm1176jzf-s -mfloat-abi=hard -mfpu=vfp $< -o $@

a.out: $(ASMOBJECT)
	ld $^

clean:
	rm -f $(ASMOBJECT) *.out
