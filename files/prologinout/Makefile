.SUFFIXES:
.SUFFIXES: .pl .out .xml .input .transcript

PROLOGSOURCE=$(wildcard *.pl)

STEPPER_CMD=swipl -qs $(PROLOGSOURCE)
STEPPER_DIR=inputs
STEPPER_TIMEOUT=5
STEPPER_POSTERRORLINES=15
STEPPER_GRADE=false
export STEPPER_CMD STEPPER_DIR STEPPER_TIMEOUT STEPPER_POSTERRORLINES STEPPER_GRADE

all:	step

grade:	export STEPPER_GRADE := true
grade:
	@rm -f test_detail.xml
	python3 lib/stepper

run:	
	$(STEPPER_CMD)

step:
	python3 lib/stepper

shell:
	swipl

setup:
	sudo apt install -y curl make python3 swi-prolog

clean:
	rm -f test_detail.xml
