.SUFFIXES:
.SUFFIXES: .rs .out .xml .lock .input .transcript

STEPPER_CMD=target/debug/student
STEPPER_DIR=inputs
STEPPER_TIMEOUT=5
STEPPER_POSTERRORLINES=15
STEPPER_GRADE=false
export STEPPER_CMD STEPPER_DIR STEPPER_TIMEOUT STEPPER_POSTERRORLINES STEPPER_GRADE

all:	step

grade:	export STEPPER_GRADE := true
grade:	target/debug/student
	@rm -f test_detail.xml
	python3 lib/stepper

run:	target/debug/student
	target/debug/student

step:	target/debug/student
	python3 lib/stepper

target/debug/student:	src/*.rs Cargo.toml
	cargo build

clean:
	cargo clean
	rm -f *.lock *.xml
