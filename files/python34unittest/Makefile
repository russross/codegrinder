.SUFFIXES:
.SUFFIXES: .py .pyc .xml

PYTHONSOURCE=$(wildcard *.py)

# find the main source file
py_count := $(shell ls | egrep '\.py$$' | wc -l)
main_py_count := $(shell ls | egrep '^main\.py$$' | wc -l)
def_main_count := $(shell egrep -l '^def main\b' $(PYTHONSOURCE) | wc -l)

ifeq ($(py_count), 1)
    PYTHONMAIN := $(shell ls *.py)
else ifeq ($(main_py_count), 1)
    PYTHONMAIN := main.py
else if ($(def_main_count), 1)
    PYTHONMAIN := $(shell egrep -l '^def main\b' $(PYTHONSOURCE))
else
    PYTHONMAIN := NO_MAIN_PYTHON_FILE
endif

all:	test

test:
	python3.4 -B -m unittest discover -s tests

grade:
	rm -f test_detail.xml
	python3.4 -B -m xmlrunner discover -s tests

shell:
	python3.4

run:	
	python3.4 -B -i $(PYTHONMAIN)

debug:
	pdb3.4 $(PYTHONMAIN)

stylecheck:
	pep8 $(PYTHONSOURCE)

stylefix:
	autopep8 -vvaai $(PYTHONSOURCE)

setup:
	sudo apt-get install -y make python3 python-pip
	sudo pip install autopep8

clean:
	rm -rf test_detail.xml $(PYTHONSOURCE:.py=.pyc) tests/*.pyc xmlrunner/__pycache__
