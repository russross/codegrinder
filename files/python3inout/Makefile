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

all:	step

test:
	python3 bin/inout-runner.py python3 $(PYTHONMAIN)

step:
	python3 bin/inout-stepall.py python3 $(PYTHONMAIN)

grade:
	rm -f test_detail.xml inputs/*.actual
	python3 bin/inout-runner.py python3 $(PYTHONMAIN)

shell:
	python3

run:	
	python3 -i $(PYTHONMAIN)

debug:
	pdb3 $(PYTHONMAIN)

stylecheck:
	pep8 $(PYTHONSOURCE)

setup:
	sudo apt install -y make python3 python3-pip python3-six diffutils
	sudo pip3 install unittest-xml-reporting

clean:
	rm -rf __pycache__ tests/__pycache__ tests/*.actual test_detail.xml
