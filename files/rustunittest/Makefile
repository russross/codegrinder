.SUFFIXES:
.SUFFIXES: .rs .rlib .out .xml .lock

TESTFLAGS=-- --test-threads 1 -Z unstable-options --format json --report-time

all:	test

test:
	cargo test $(TESTFLAGS)

grade:
	rm -f test_detail.xml
	cargo test $(TESTFLAGS) | cargo2junit > test_detail.xml

setup:
	sudo apt install -y cargo make
	cargo install cargo2junit

clean:
	cargo clean
	rm -f *.lock *.xml
