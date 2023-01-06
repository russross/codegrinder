.SUFFIXES:
.SUFFIXES: .rs .out .xml .lock


all:	step

test:	target/debug/student
	python3 scripts/inout-runner.py input target/debug/student

grade:	target/debug/student
	rm -f test_detail.xml inputs/*.actual
	python3 scripts/inout-runner.py input target/debug/student

run:	target/debug/student
	target/debug/student

step:	target/debug/student
	python3 scripts/inout-stepall.py input target/debug/student

target/debug/student:	src/*.rs Cargo.toml
	cargo build

setup:
	sudo apt install -y cargo make

clean:
	cargo clean
	rm -f *.lock *.xml
