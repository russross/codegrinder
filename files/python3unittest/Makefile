.SUFFIXES:
.SUFFIXES: .py .xml

PYTHONSOURCE=$(wildcard *.py)

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

all:	test

test:
	python3 -m unittest discover -vs tests

grade:
	rm -f test_detail.xml
	python3 -m xmlrunner discover -vs tests --output-file test_detail.xml

shell:
	python3

run:	
	python3 -i $(PYTHONMAIN)

debug:
	pdb3 $(PYTHONMAIN)

stylecheck:
	pep8 $(PYTHONSOURCE)

setup:
	sudo apt install -y diffutils icdiff make python3 python3-pip python3-setuptools python3-six
	sudo pip3 install unittest-xml-reporting cisc108 pygame

clean:
	rm -rf __pycache__ tests/__pycache__ tests/*.actual test_detail.xml
