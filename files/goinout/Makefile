.SUFFIXES:
.SUFFIXES: .go .xml .out

GODEBUG=installgoroot=all
export GODEBUG

STEPPER_DELAY=0.01
STEPPER_WARMUPDELAY=1.0
STEPPER_POSTCRASHLINES=15
STEPPER_WRONGLINES=10
STEPPER_SUFFIX=input
STEPPER_INDIR=inputs
STEPPER_OUTDIR=inputs
STEPPER_CMD=./a.out
export STEPPER_DELAY STEPPER_WARMUPDELAY STEPPER_POSTCRASHLINES STEPPER_WRONGLINES
export STEPPER_SUFFIX STEPPER_INDIR STEPPER_OUTDIR STEPPER_CMD

all:	step

grade:	a.out
	rm -f test_detail.xml inputs/*.actual
	python3 lib/grader

run:	a.out
	./a.out

step:	a.out
	python3 lib/stepper

a.out:	*.go
	go fmt
	go build -o a.out

setup:
	sudo apt install -y golang icdiff make python3

clean:
	rm -f *.out *.xml
