#!/bin/bash

set -e

echo building codegrinder server
go install github.com/russross/codegrinder/codegrinder &

echo building grind for local machine
(go install -ldflags=-s github.com/russross/codegrinder/grind && \
upx -qq $GOPATH/bin/grind) &

wait

echo installing codegrinder server and grind tool
sudo mv $GOPATH/bin/codegrinder /usr/local/bin/
sudo setcap cap_net_bind_service=+ep /usr/local/bin/codegrinder
sudo mv $GOPATH/bin/grind /usr/local/bin/

echo building grind for linux
(GOOS=linux GOARCH=amd64 go build -ldflags=-s -o $GOPATH/src/github.com/russross/codegrinder/www/grind.linux github.com/russross/codegrinder/grind && \
upx -qq $GOPATH/src/github.com/russross/codegrinder/www/grind.linux) &

echo building grind for arm
(GOOS=linux GOARCH=arm go build -ldflags=-s -o $GOPATH/src/github.com/russross/codegrinder/www/grind.arm github.com/russross/codegrinder/grind && \
upx -qq $GOPATH/src/github.com/russross/codegrinder/www/grind.arm) &

echo building grind for macos
GOOS=darwin GOARCH=amd64 go build -ldflags=-s -o $GOPATH/src/github.com/russross/codegrinder/www/grind.macos github.com/russross/codegrinder/grind &

echo building grind for windows
(GOOS=windows GOARCH=amd64 go build -ldflags=-s -o $GOPATH/src/github.com/russross/codegrinder/www/grind.exe github.com/russross/codegrinder/grind && \
upx -qq $GOPATH/src/github.com/russross/codegrinder/www/grind.exe) &

wait
