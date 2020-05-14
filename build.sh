#!/bin/bash

set -e

echo building codegrinder server
go install github.com/russross/codegrinder/codegrinder

echo installing codegrinder server
sudo mv `go env GOPATH`/bin/codegrinder /usr/local/bin/
sudo setcap cap_net_bind_service=+ep /usr/local/bin/codegrinder
