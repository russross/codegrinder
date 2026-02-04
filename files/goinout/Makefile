.SUFFIXES:
.SUFFIXES: .go .out .xml .input .transcript

GODEBUG=installgoroot=all
export GODEBUG

STEPPER_CMD=./a.out
STEPPER_DIR=inputs
STEPPER_TIMEOUT=5
STEPPER_POSTERRORLINES=15
STEPPER_GRADE=false
export STEPPER_CMD STEPPER_DIR STEPPER_TIMEOUT STEPPER_POSTERRORLINES STEPPER_GRADE

all:	step

grade:	export STEPPER_GRADE := true
grade:	a.out
	@rm -f test_detail.xml
	python3 lib/stepper

run:	a.out
	./a.out

step:	a.out
	python3 lib/stepper

a.out:	*.go
	go fmt
	go build -o a.out

clean:
	rm -f *.out *.xml
