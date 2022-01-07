.SUFFIXES:
.SUFFIXES: .go .xml

all:	test

test:
	go test -v

grade:	go2xunit/go2xunit
	go test -v | go2xunit/go2xunit -output test_detail.xml

go2xunit/go2xunit:
	cd go2xunit && go build

setup:
	sudo apt install -y make golang

clean:
	rm -f *.xml go2xunit/go2xunit
