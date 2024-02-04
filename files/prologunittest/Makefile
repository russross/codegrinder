.SUFFIXES:
.SUFFIXES: .pl .plt .xml .out

PROLOGSOURCE=$(wildcard *.pl)
TESTSOURCE=$(wildcard tests/*.plt)

all:	test

test:
	for test in $(TESTSOURCE) ; do \
	    swipl -s $$test -t run_tests ; \
	done

grade:
	rm -f test.out test_detail.xml
	for test in $(TESTSOURCE) ; do \
	    swipl -s $$test -t run_tests 2>&1 | tee -a test.out ; \
	done
	python3 bin/results2xml.py < test.out
	rm -f test.out

run:	
	for src in $(PROLOGSOURCE) ; do \
	    swipl -s $$src ; \
	done

shell:
	swipl

setup:
	sudo apt install -y icdiff make python3 swi-prolog

clean:
	rm -f test.out test_detail.xml
