#!/bin/bash

set -e

echo building codegrinder server
cd $GOPATH/src/github.com/russross/codegrinder/codegrinder
go install

echo installing codegrinder server
sudo mv $GOPATH/bin/codegrinder /usr/local/bin/
sudo setcap cap_net_bind_service=+ep /usr/local/bin/codegrinder

echo building grind tool
cd ../grind
go install
