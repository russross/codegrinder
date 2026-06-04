ROOT_DIR := $(CURDIR)
PROTO_DIR := $(ROOT_DIR)/protocol
PROTO_FILE := $(PROTO_DIR)/codegrinder.proto

.PHONY: all setup build test clean

all: build

setup:
	@missing=0; \
	for tool in cargo protoc; do \
		if ! command -v $$tool >/dev/null 2>&1; then \
			echo "Missing tool: $$tool"; \
			missing=1; \
		fi; \
	done; \
	if [ $$missing -ne 0 ]; then \
		echo "One or more required tools are missing. Skipping dependency setup."; \
		exit 0; \
	fi
	cargo fetch

build:
	cargo build --workspace

test:
	cargo test --workspace
	cargo clippy --workspace -- -D warnings
	cargo fmt --all --check

clean:
	cargo clean
