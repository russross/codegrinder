#!/bin/sh

set -e

echo building codegrinder server
go install -tags netgo github.com/russross/codegrinder/server

if [ -z "$CODEGRINDERROOT" ]; then
    CODEGRINDERROOT="$HOME"/codegrinder
fi

echo building grind for linux amd64
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go install -tags netgo github.com/russross/codegrinder/cli
mv `go env GOPATH`/bin/linux_amd64/cli "$CODEGRINDERROOT"/www/grind.linux_amd64
