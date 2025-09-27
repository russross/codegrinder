CODEGRINDERROOT ?= $(HOME)/codegrinder
GOPATH = $(shell go env GOPATH)

SERVER_SOURCES = $(wildcard server/*.go types/*.go rpc/*.go)
CLI_SOURCES = $(wildcard cli/*.go types/*.go rpc/*.go)

.PHONY: all server grind rpc

server: $(GOPATH)/bin/server

grind: grind-linux-amd64

rpc: rpc/codegrinder.pb.go rpc/codegrinder_grpc.pb.go

rpc/codegrinder.pb.go rpc/codegrinder_grpc.pb.go: rpc/codegrinder.proto
	protoc --proto_path=. --proto_path=/usr/include --go_out=. --go_opt=module=github.com/russross/codegrinder --go-grpc_out=. --go-grpc_opt=module=github.com/russross/codegrinder rpc/codegrinder.proto

$(GOPATH)/bin/server: $(SERVER_SOURCES)
	@echo building codegrinder server
	go install -tags netgo github.com/russross/codegrinder/server

$(CODEGRINDERROOT)/www/grind.linux_amd64: $(CLI_SOURCES)
	@echo building grind for linux amd64
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go install -tags netgo github.com/russross/codegrinder/cli
	mv $(GOPATH)/bin/cli $(CODEGRINDERROOT)/www/grind.linux_amd64

grind-linux-amd64: $(CODEGRINDERROOT)/www/grind.linux_amd64

$(CODEGRINDERROOT)/www/grind.linux_arm: $(CLI_SOURCES)
	@echo building grind for linux arm32
	CGO_ENABLED=0 GOOS=linux GOARCH=arm go install -tags netgo github.com/russross/codegrinder/cli
	mv $(GOPATH)/bin/linux_arm/cli $(CODEGRINDERROOT)/www/grind.linux_arm

grind-linux-arm: $(CODEGRINDERROOT)/www/grind.linux_arm

$(CODEGRINDERROOT)/www/grind.linux_arm64: $(CLI_SOURCES)
	@echo building grind for linux arm64
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go install -tags netgo github.com/russross/codegrinder/cli
	mv $(GOPATH)/bin/linux_arm64/cli $(CODEGRINDERROOT)/www/grind.linux_arm64

grind-linux-arm64: $(CODEGRINDERROOT)/www/grind.linux_arm64

$(CODEGRINDERROOT)/www/grind.linux_riscv64: $(CLI_SOURCES)
	@echo building grind for linux riscv64
	CGO_ENABLED=0 GOOS=linux GOARCH=riscv64 go install -tags netgo github.com/russross/codegrinder/cli
	mv $(GOPATH)/bin/linux_riscv64/cli $(CODEGRINDERROOT)/www/grind.linux_riscv64

grind-linux-riscv64: $(CODEGRINDERROOT)/www/grind.linux_riscv64

$(CODEGRINDERROOT)/www/grind.darwin_amd64: $(CLI_SOURCES)
	@echo building grind for darwin amd64
	CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go install -tags netgo github.com/russross/codegrinder/cli
	mv $(GOPATH)/bin/darwin_amd64/cli $(CODEGRINDERROOT)/www/grind.darwin_amd64

grind-darwin-amd64: $(CODEGRINDERROOT)/www/grind.darwin_amd64

$(CODEGRINDERROOT)/www/grind.darwin_arm64: $(CLI_SOURCES)
	@echo building grind for darwin arm64
	CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go install -tags netgo github.com/russross/codegrinder/cli
	mv $(GOPATH)/bin/darwin_arm64/cli $(CODEGRINDERROOT)/www/grind.darwin_arm64

grind-darwin-arm64: $(CODEGRINDERROOT)/www/grind.darwin_arm64

$(CODEGRINDERROOT)/www/grind.exe: $(CLI_SOURCES)
	@echo building grind for windows amd64
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go install -tags netgo github.com/russross/codegrinder/cli
	mv $(GOPATH)/bin/windows_amd64/cli.exe $(CODEGRINDERROOT)/www/grind.exe

grind-windows-amd64: $(CODEGRINDERROOT)/www/grind.exe

all: server grind-linux-amd64 grind-linux-arm grind-linux-arm64 grind-linux-riscv64 grind-darwin-amd64 grind-darwin-arm64 grind-windows-amd64
