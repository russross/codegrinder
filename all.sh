#!/bin/bash

set -e

echo building codegrinder server
go install github.com/russross/codegrinder/codegrinder &

echo building grind for linux
GOOS=linux GOARCH=amd64 go build -ldflags=-s -o $GOPATH/src/github.com/russross/codegrinder/www/grind.linux github.com/russross/codegrinder/grind &

echo building grind for arm
GOOS=linux GOARCH=arm go build -ldflags=-s -o $GOPATH/src/github.com/russross/codegrinder/www/grind.arm github.com/russross/codegrinder/grind &

echo building grind for macos
GOOS=darwin GOARCH=amd64 go build -ldflags=-s -o $GOPATH/src/github.com/russross/codegrinder/www/grind.macos github.com/russross/codegrinder/grind &

echo building grind for windows
GOOS=windows GOARCH=amd64 go build -ldflags=-s -o $GOPATH/src/github.com/russross/codegrinder/www/grind.exe github.com/russross/codegrinder/grind &

wait

echo installing codegrinder server
sudo mv $GOPATH/bin/codegrinder /usr/local/bin/
sudo setcap cap_net_bind_service=+ep /usr/local/bin/codegrinder
