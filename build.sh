#!/bin/bash

set -e

echo building codegrinder server
go install github.com/russross/codegrinder/server

echo installing codegrinder server
sudo mv `go env GOPATH`/bin/server /usr/local/bin/codegrinder
#sudo setcap cap_net_bind_service=+ep /usr/local/bin/codegrinder
