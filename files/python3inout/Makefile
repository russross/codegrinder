.SUFFIXES:
.SUFFIXES: .py .xml

PYTHONSOURCE := $(wildcard *.py)

# find the main source file
py_count := $(shell ls | grep '\.py$$' | wc -l | tr -d ' ')
main_py_count := $(shell ls | grep '^main\.py$$' | wc -l | tr -d ' ')
def_main_count := $(shell grep -l '^def main\b' $(PYTHONSOURCE) | wc -l | tr -d ' ')

ifeq ($(py_count), 1)
    PYTHONMAIN := $(shell ls *.py)
else ifeq ($(main_py_count), 1)
    PYTHONMAIN := main.py
else ifeq ($(def_main_count), 1)
    PYTHONMAIN := $(shell grep -l '^def main\b' $(PYTHONSOURCE))
else
    PYTHONMAIN := NO_MAIN_PYTHON_FILE
endif

STEPPER_DELAY=0.01
STEPPER_WARMUPDELAY=0.1
STEPPER_POSTCRASHLINES=15
STEPPER_WRONGLINES=10
STEPPER_SUFFIX=input
STEPPER_INDIR=inputs
STEPPER_OUTDIR=inputs
STEPPER_CMD=python3 $(PYTHONMAIN)
export STEPPER_DELAY STEPPER_WARMUPDELAY STEPPER_POSTCRASHLINES STEPPER_WRONGLINES
export STEPPER_SUFFIX STEPPER_INDIR STEPPER_OUTDIR STEPPER_CMD

all:	step

step:
	mypy --strict *.py
	python3 lib/stepper

grade:
	rm -f test_detail.xml inputs/*.actual
	mypy --strict *.py
	python3 lib/grader

shell:
	python3

run:	
	mypy --strict *.py
	python3 -i $(PYTHONMAIN)

debug:
	mypy --strict *.py
	pdb3 $(PYTHONMAIN)

stylecheck:
	mypy --strict *.py
	pep8 $(PYTHONSOURCE)

setup:
	sudo apt install -y make mypy python3 python3-pip python3-six diffutils
	sudo pip3 install unittest-xml-reporting

clean:
	rm -rf __pycache__ .mypy_cache tests/*.actual test_detail.xml
