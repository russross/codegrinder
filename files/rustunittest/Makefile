.SUFFIXES:
.SUFFIXES: .rs .rlib .out .xml

CRATE=student

RUSTC=rustc
RUSTFLAGS=--edition=2018 --crate-name $(CRATE) --crate-type lib
TESTFLAGS=--edition=2018 --crate-name $(CRATE) --test

UNITSOURCE=lib.rs
UNITOBJECT=lib.rlib
TESTSOURCE=$(wildcard tests/*.rs)

all:	test

test:	a.out
	./a.out --test --test-threads 1

grade:	a.out
	rm -f test_detail.xml
	./a.out --test --test-threads 1 -Z unstable-options --format json | cargo2junit > test_detail.xml

.rs.rlib:
	$(RUSTC) $(RUSTFLAGS) $< -o $@

a.out:	$(UNITOBJECT) $(TESTSOURCE)
	$(RUSTC) $(TESTFLAGS) $(TESTSOURCE) --extern $(CRATE)=$(UNITOBJECT) -o $@

setup:
	sudo apt install -y cargo make

clean:
	rm -f *.rlib *.out *.xml
