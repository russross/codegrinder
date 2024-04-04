#!/bin/sh

set -e

echo building codegrinder server
go install -tags netgo github.com/russross/codegrinder/server

echo installing codegrinder server
sudo mv `go env GOPATH`/bin/server /usr/local/bin/codegrinder
