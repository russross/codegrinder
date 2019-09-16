.SUFFIXES:
.SUFFIXES: .sml .xml

SMLSOURCE=$(wildcard *.sml)

all:	test

test:
	poly -H 16 < tests/tests.sml

grade:
	poly -H 16 < tests/tests.sml

run:	
	( cat $(SMLSOURCE) ; echo ';' ; cat ) | rlwrap poly -H 16

shell:
	rlwrap poly -H 16

setup:
	sudo apt-get install -y polyml rlwrap make

clean:
	rm -f test_detail.xml
