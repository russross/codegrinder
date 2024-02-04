.SUFFIXES:
.SUFFIXES: .go .xml

all:	test

test:
	go fmt
	go test -v

grade:	go2xunit/go2xunit
	go fmt
	go test -v | go2xunit/go2xunit -output test_detail.xml

go2xunit/go2xunit:
	cd go2xunit && go build

setup:
	sudo apt install -y icdiff make golang python3

clean:
	rm -f *.xml go2xunit/go2xunit
