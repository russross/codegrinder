#!/bin/sh

set -e

echo building codegrinder server
go install -tags netgo github.com/russross/codegrinder/server
