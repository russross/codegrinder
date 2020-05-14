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

echo building grind for linux arm
GOOS=linux GOARCH=arm go install github.com/russross/codegrinder/grind
mv `go env GOPATH`/bin/linux_arm/grind "$HOME"/codegrinder/www/grind.linux_arm

echo building grind for darwin amd64
GOOS=darwin GOARCH=amd64 go install github.com/russross/codegrinder/grind
mv `go env GOPATH`/bin/darwin_amd64/grind "$HOME"/codegrinder/www/grind.darwin_amd64

echo building grind for windows amd64
GOOS=windows GOARCH=amd64 go install github.com/russross/codegrinder/grind
mv `go env GOPATH`/bin/windows_amd64/grind.exe "$HOME"/codegrinder/www/grind.exe
