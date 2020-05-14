#!/bin/bash

set -e

echo building codegrinder server
go install github.com/russross/codegrinder/codegrinder

echo installing codegrinder server
sudo mv `go env GOPATH`/bin/codegrinder /usr/local/bin/
sudo setcap cap_net_bind_service=+ep /usr/local/bin/codegrinder

echo building grind for linux amd64
GOOS=linux GOARCH=amd64 go install github.com/russross/codegrinder/grind
mv `go env GOPATH`/bin/linux_amd64/grind "$HOME"/codegrinder/www/grind.linux_amd64
