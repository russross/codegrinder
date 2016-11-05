#!/bin/bash

set -e

echo building codegrinder server
go install github.com/russross/codegrinder/codegrinder &

echo building grind for linux
GOOS=linux GOARCH=amd64 go build -ldflags=-s -o $GOPATH/src/github.com/russross/codegrinder/www/grind.linux github.com/russross/codegrinder/grind &

wait

echo installing codegrinder server
sudo mv $GOPATH/bin/codegrinder /usr/local/bin/
sudo setcap cap_net_bind_service=+ep /usr/local/bin/codegrinder
