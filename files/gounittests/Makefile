.SUFFIXES:
.SUFFIXES: .go .xml

all:	test

test:
	go test ./tests

grade:
	go test -v ./tests

run:
	go run *.go

setup:
	# install Go 1.7.3
	sudo rm -rf /usr/local/go
	sudo rm -f /usr/local/bin/go /usr/local/bin/gofmt /usr/local/bin/godoc
	curl -s https://storage.googleapis.com/golang/go1.7.3.linux-amd64.tar.gz | sudo tar zxf - -C /usr/local
	sudo ln -s ../go/bin/go /usr/local/bin/
	sudo ln -s ../go/bin/gofmt /usr/local/bin/
	sudo ln -s ../go/bin/godoc /usr/local/bin/

clean:
	rm -f *.xml
