.SUFFIXES:
.SUFFIXES: .go .xml

all:	test

test:
	go fmt
	go test -v

grade:
	go fmt
	go test -v | python3 lib/go2xunit.py -output test_detail.xml

setup:
	sudo apt install -y make golang python3

clean:
	rm -f *.xml
