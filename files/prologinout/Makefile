.SUFFIXES:
.SUFFIXES: .pl .out .xml

PROLOGSOURCE=$(wildcard *.pl)

STEPPER_DELAY=0.01
STEPPER_WARMUPDELAY=0.25
STEPPER_POSTCRASHLINES=15
STEPPER_WRONGLINES=10
STEPPER_SUFFIX=input
STEPPER_INDIR=inputs
STEPPER_OUTDIR=inputs
STEPPER_CMD=swipl -qs $(PROLOGSOURCE)
export STEPPER_DELAY STEPPER_WARMUPDELAY STEPPER_POSTCRASHLINES STEPPER_WRONGLINES
export STEPPER_SUFFIX STEPPER_INDIR STEPPER_OUTDIR STEPPER_CMD

all:	step

step:
	python3 lib/stepper

grade:
	rm -f test_detail.xml inputs/*.actual
	python3 lib/grader

shell:
	swipl

run:	
	$(STEPPER_CMD)

setup:
	sudo apt install -y icdiff make python3 swi-prolog

clean:
	rm -f tests/*.actual test_detail.xml
