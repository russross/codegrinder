.SUFFIXES:
.SUFFIXES: .go .xml .out

all:	step

test:	a.out
	python3 lib/inout-runner.py input ./a.out

grade:	a.out
	rm -f test_detail.xml inputs/*.actual
	python3 lib/inout-runner.py input ./a.out

run:	a.out
	./a.out

step:	a.out
	python3 lib/inout-stepall.py input ./a.out

a.out:	*.go
	go fmt
	go build -o a.out

setup:
	sudo apt install -y golang make python3

clean:
	rm -f *.out *.xml
