# Variables
CODEGRINDERROOT ?= ./
GOPATH := $(shell go env GOPATH)
BIN_DIR := $(GOPATH)/bin
CLI_BINARY := $(BIN_DIR)/cli
TARGET_BINARY := $(CODEGRINDERROOT)/grind.linux_amd64

# Default target
all: build move

# Build the CLI
build:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go install -tags netgo github.com/russross/codegrinder/cli

# Move the binary
move: build
	@echo "Moving binary to target directory..."
	mv $(CLI_BINARY) $(TARGET_BINARY)

# Clean target (optional, cleans build artifacts)
clean:
	@echo "Cleaning up..."
	rm -f $(TARGET_BINARY)

# Phony targets
.PHONY: all build move clean

