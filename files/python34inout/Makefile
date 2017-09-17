.SUFFIXES:
.SUFFIXES: .py .pyc .xml

PYTHONSOURCE=$(wildcard *.py)

# find the main source file
py_count := $(shell ls | grep '\.py$$' | wc -l)
main_py_count := $(shell ls | grep '^main\.py$$' | wc -l)
def_main_count := $(shell grep -l '^def main\b' $(PYTHONSOURCE) | wc -l)

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
	python3.4 bin/inout-runner.py python3.4 $(PYTHONMAIN)

grade:
	rm -f test_detail.xml
	python3.4 bin/inout-runner.py python3.4 $(PYTHONMAIN)

shell:
	python3.4

run:	
	python3.4 -i $(PYTHONMAIN)

debug:
	pdb3.4 $(PYTHONMAIN)

stylecheck:
	pep8 $(PYTHONSOURCE)

stylefix:
	autopep8 -vvaai $(PYTHONSOURCE)

setup:
	sudo apt-get install -y make python3.4 python-pip python3-six
	sudo pip install autopep8

clean:
	rm -rf test_detail.xml $(PYTHONSOURCE:.py=.pyc) tests/*.pyc tests/*.actual
