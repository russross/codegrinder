CODEGRINDERROOT ?= $(HOME)/codegrinder
GOPATH := $(shell go env GOPATH)

# --------------------------------------------------------------------
# Sources
# --------------------------------------------------------------------
PROTO_SOURCES   := $(wildcard rpc/*.proto)
PROTO_GENERATED := $(PROTO_SOURCES:.proto=.pb.go) \
                   $(PROTO_SOURCES:.proto=_grpc.pb.go)

SERVER_SOURCES  := $(wildcard server/*.go types/*.go rpc/*.go)
CLI_SOURCES     := $(wildcard cli/*.go types/*.go rpc/*.go)

# --------------------------------------------------------------------
# Top-level targets
# --------------------------------------------------------------------
.PHONY: all server grind clean

server: $(GOPATH)/bin/server

all: server grind-linux-amd64 grind-linux-arm \
     grind-linux-arm64 grind-linux-riscv64 \
     grind-darwin-amd64 grind-darwin-arm64 \
     grind-windows-amd64

grind: grind-linux-amd64

clean:
	rm -f $(PROTO_GENERATED)
	rm -f $(GOPATH)/bin/server
	rm -f $(CODEGRINDERROOT)/www/grind.*

# --------------------------------------------------------------------
# Proto generation
# --------------------------------------------------------------------
$(PROTO_GENERATED): $(PROTO_SOURCES)
	protoc --proto_path=. --proto_path=/usr/include \
	    --go_out=. --go_opt=module=github.com/russross/codegrinder \
	    --go-grpc_out=. --go-grpc_opt=module=github.com/russross/codegrinder $<

# --------------------------------------------------------------------
# Server build
# --------------------------------------------------------------------
$(GOPATH)/bin/server: $(SERVER_SOURCES) $(PROTO_GENERATED)
	@echo building codegrinder server
	go install -tags netgo github.com/russross/codegrinder/server

# --------------------------------------------------------------------
# CLI builds for multiple platforms
# --------------------------------------------------------------------
$(CODEGRINDERROOT)/www/grind.linux_amd64: $(CLI_SOURCES) $(PROTO_GENERATED)
	@echo building grind for linux amd64
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go install -tags netgo github.com/russross/codegrinder/cli
	mv $(GOPATH)/bin/cli $@

grind-linux-amd64: $(CODEGRINDERROOT)/www/grind.linux_amd64

$(CODEGRINDERROOT)/www/grind.linux_arm: $(CLI_SOURCES) $(PROTO_GENERATED)
	@echo building grind for linux arm32
	CGO_ENABLED=0 GOOS=linux GOARCH=arm go install -tags netgo github.com/russross/codegrinder/cli
	mv $(GOPATH)/bin/linux_arm/cli $@

grind-linux-arm: $(CODEGRINDERROOT)/www/grind.linux_arm

$(CODEGRINDERROOT)/www/grind.linux_arm64: $(CLI_SOURCES) $(PROTO_GENERATED)
	@echo building grind for linux arm64
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go install -tags netgo github.com/russross/codegrinder/cli
	mv $(GOPATH)/bin/linux_arm64/cli $@

grind-linux-arm64: $(CODEGRINDERROOT)/www/grind.linux_arm64

$(CODEGRINDERROOT)/www/grind.linux_riscv64: $(CLI_SOURCES) $(PROTO_GENERATED)
	@echo building grind for linux riscv64
	CGO_ENABLED=0 GOOS=linux GOARCH=riscv64 go install -tags netgo github.com/russross/codegrinder/cli
	mv $(GOPATH)/bin/linux_riscv64/cli $@

grind-linux-riscv64: $(CODEGRINDERROOT)/www/grind.linux_riscv64

$(CODEGRINDERROOT)/www/grind.darwin_amd64: $(CLI_SOURCES) $(PROTO_GENERATED)
	@echo building grind for darwin amd64
	CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go install -tags netgo github.com/russross/codegrinder/cli
	mv $(GOPATH)/bin/darwin_amd64/cli $@

grind-darwin-amd64: $(CODEGRINDERROOT)/www/grind.darwin_amd64

$(CODEGRINDERROOT)/www/grind.darwin_arm64: $(CLI_SOURCES) $(PROTO_GENERATED)
	@echo building grind for darwin arm64
	CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go install -tags netgo github.com/russross/codegrinder/cli
	mv $(GOPATH)/bin/darwin_arm64/cli $@

grind-darwin-arm64: $(CODEGRINDERROOT)/www/grind.darwin_arm64

$(CODEGRINDERROOT)/www/grind.exe: $(CLI_SOURCES) $(PROTO_GENERATED)
	@echo building grind for windows amd64
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go install -tags netgo github.com/russross/codegrinder/cli
	mv $(GOPATH)/bin/windows_amd64/cli.exe $@

grind-windows-amd64: $(CODEGRINDERROOT)/www/grind.exe
