.SUFFIXES:
.SUFFIXES: .c .o
.PHONY: all grade step clean

CFLAGS=-std=c18 -O0 -g -Wall -Wextra -Werror -Wpedantic -Wstrict-prototypes

all: step

grade: a.out
	./a.out < inputs/basic.input > actual.out
	diff -u inputs/basic.expected actual.out

step: grade

a.out: main-test.o containment.o
	clang $(CFLAGS) $^ -o $@

.c.o:
	clang $(CFLAGS) -c $< -o $@

clean:
	rm -f *.o *.out actual.out
