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
	mypy --strict *.py
	python3 lib/inout-runner.py input python3 $(PYTHONMAIN)

step:
	mypy --strict *.py
	python3 lib/inout-stepall.py input python3 $(PYTHONMAIN)

grade:
	rm -f test_detail.xml inputs/*.actual
	mypy --strict *.py
	python3 lib/inout-runner.py input python3 $(PYTHONMAIN)

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
