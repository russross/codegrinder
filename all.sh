#!/bin/sh

set -e

echo building codegrinder server
go install -tags netgo github.com/russross/codegrinder/server

if [ -z "$CODEGRINDERROOT" ]; then
    CODEGRINDERROOT="$HOME"/codegrinder
fi

echo building grind for linux amd64
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go install -tags netgo github.com/russross/codegrinder/cli
mv `go env GOPATH`/bin/cli "$CODEGRINDERROOT"/www/grind.linux_amd64

echo building grind for linux arm32
CGO_ENABLED=0 GOOS=linux GOARCH=arm go install -tags netgo github.com/russross/codegrinder/cli
mv `go env GOPATH`/bin/linux_arm/cli "$CODEGRINDERROOT"/www/grind.linux_arm

echo building grind for linux arm64
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go install -tags netgo github.com/russross/codegrinder/cli
mv `go env GOPATH`/bin/linux_arm64/cli "$CODEGRINDERROOT"/www/grind.linux_arm64

echo building grind for linux riscv64
CGO_ENABLED=0 GOOS=linux GOARCH=riscv64 go install -tags netgo github.com/russross/codegrinder/cli
mv `go env GOPATH`/bin/linux_riscv64/cli "$CODEGRINDERROOT"/www/grind.linux_riscv64

echo building grind for darwin amd64
CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go install -tags netgo github.com/russross/codegrinder/cli
mv `go env GOPATH`/bin/darwin_amd64/cli "$CODEGRINDERROOT"/www/grind.darwin_amd64

echo building grind for darwin arm64
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go install -tags netgo github.com/russross/codegrinder/cli
mv `go env GOPATH`/bin/darwin_arm64/cli "$CODEGRINDERROOT"/www/grind.darwin_arm64

echo building grind for windows amd64
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go install -tags netgo github.com/russross/codegrinder/cli
mv `go env GOPATH`/bin/windows_amd64/cli.exe "$CODEGRINDERROOT"/www/grind.exe
