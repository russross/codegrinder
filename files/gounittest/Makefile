.SUFFIXES:
.SUFFIXES: .go .xml

all:	test

test:
	go test -v ./tests

grade:
	go test -v ./tests | go run lib/*.go -output test_detail.xml

run:
	go run *.go

setup:
	sudo apt install -y make
	# delete old installation of Go
	sudo rm -rf /usr/local/go
	sudo rm -f /usr/local/bin/go /usr/local/bin/gofmt /usr/local/bin/godoc
	# install Go 1.13.4
	curl -s https://dl.google.com/go/go1.13.4.linux-amd64.tar.gz | sudo tar zxf - -C /usr/local
	sudo ln -s ../go/bin/go /usr/local/bin/
	sudo ln -s ../go/bin/gofmt /usr/local/bin/
	sudo ln -s ../go/bin/godoc /usr/local/bin/

clean:
	rm -f *.xml
