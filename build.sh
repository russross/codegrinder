#!/bin/bash

set -e

echo building codegrinder server
go install github.com/russross/codegrinder/codegrinder

echo installing codegrinder server
sudo mv $GOPATH/bin/codegrinder /usr/local/bin/
sudo setcap cap_net_bind_service=+ep /usr/local/bin/codegrinder

echo building grind tool
go install github.com/russross/codegrinder/grind
sudo mv $GOPATH/bin/grind /usr/local/bin/
