#!/bin/bash

set -e

cd ~/src/github.com/russross/codegrinder/codegrinder
go install
cd ../grind
go install
sudo setcap cap_net_bind_service=+ep ~/bin/codegrinder
