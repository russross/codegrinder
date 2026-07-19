ROOT_DIR := $(CURDIR)
PROTO_DIR := $(ROOT_DIR)/protocol
PROTO_FILE := $(PROTO_DIR)/codegrinder.proto
DIST_DIR ?= $(ROOT_DIR)/www
MACOSX_DEPLOYMENT_TARGET ?= 11.0

.PHONY: all setup build server grind test clean \
	grind-dist grind-linux-amd64 grind-linux-arm64 \
	grind-macos-amd64 grind-macos-arm64

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
	cargo build --release --workspace

server:
	cargo build --release -p codegrinder-server

grind:
	cargo build --release -p grind

grind-dist: grind-linux-amd64 grind-linux-arm64 grind-macos-amd64 grind-macos-arm64

grind-linux-amd64:
	@command -v cargo-zigbuild >/dev/null 2>&1 || { echo "Missing cargo-zigbuild" >&2; exit 1; }
	@command -v readelf >/dev/null 2>&1 || { echo "Missing readelf (usually provided by binutils)" >&2; exit 1; }
	@target_libdir="$$(rustc --print target-libdir --target x86_64-unknown-linux-musl)"; ls "$$target_libdir"/libstd-*.rlib >/dev/null 2>&1 || { echo "Missing Rust target x86_64-unknown-linux-musl; run: rustup target add x86_64-unknown-linux-musl" >&2; exit 1; }
	cargo zigbuild --release -p grind --target x86_64-unknown-linux-musl
	mkdir -p $(DIST_DIR)
	cp target/x86_64-unknown-linux-musl/release/grind $(DIST_DIR)/grind.linux_amd64
	@if readelf -l $(DIST_DIR)/grind.linux_amd64 | grep -q INTERP; then echo "Linux AMD64 grind is dynamically linked" >&2; exit 1; fi

grind-linux-arm64:
	@command -v cargo-zigbuild >/dev/null 2>&1 || { echo "Missing cargo-zigbuild" >&2; exit 1; }
	@command -v readelf >/dev/null 2>&1 || { echo "Missing readelf (usually provided by binutils)" >&2; exit 1; }
	@target_libdir="$$(rustc --print target-libdir --target aarch64-unknown-linux-musl)"; ls "$$target_libdir"/libstd-*.rlib >/dev/null 2>&1 || { echo "Missing Rust target aarch64-unknown-linux-musl; run: rustup target add aarch64-unknown-linux-musl" >&2; exit 1; }
	cargo zigbuild --release -p grind --target aarch64-unknown-linux-musl
	mkdir -p $(DIST_DIR)
	cp target/aarch64-unknown-linux-musl/release/grind $(DIST_DIR)/grind.linux_arm64
	@if readelf -l $(DIST_DIR)/grind.linux_arm64 | grep -q INTERP; then echo "Linux ARM64 grind is dynamically linked" >&2; exit 1; fi

grind-macos-amd64:
	@command -v cargo-zigbuild >/dev/null 2>&1 || { echo "Missing cargo-zigbuild" >&2; exit 1; }
	@target_libdir="$$(rustc --print target-libdir --target x86_64-apple-darwin)"; ls "$$target_libdir"/libstd-*.rlib >/dev/null 2>&1 || { echo "Missing Rust target x86_64-apple-darwin; run: rustup target add x86_64-apple-darwin" >&2; exit 1; }
	@if [ "$$(uname -s)" != Darwin ] && [ -z "$$SDKROOT" ]; then echo "Set SDKROOT to a macOS SDK when cross-compiling from $$(uname -s)" >&2; exit 1; fi
	MACOSX_DEPLOYMENT_TARGET=$(MACOSX_DEPLOYMENT_TARGET) cargo zigbuild --release -p grind --target x86_64-apple-darwin
	mkdir -p $(DIST_DIR)
	cp target/x86_64-apple-darwin/release/grind $(DIST_DIR)/grind.darwin_amd64

grind-macos-arm64:
	@command -v cargo-zigbuild >/dev/null 2>&1 || { echo "Missing cargo-zigbuild" >&2; exit 1; }
	@target_libdir="$$(rustc --print target-libdir --target aarch64-apple-darwin)"; ls "$$target_libdir"/libstd-*.rlib >/dev/null 2>&1 || { echo "Missing Rust target aarch64-apple-darwin; run: rustup target add aarch64-apple-darwin" >&2; exit 1; }
	@if [ "$$(uname -s)" != Darwin ] && [ -z "$$SDKROOT" ]; then echo "Set SDKROOT to a macOS SDK when cross-compiling from $$(uname -s)" >&2; exit 1; fi
	MACOSX_DEPLOYMENT_TARGET=$(MACOSX_DEPLOYMENT_TARGET) cargo zigbuild --release -p grind --target aarch64-apple-darwin
	mkdir -p $(DIST_DIR)
	cp target/aarch64-apple-darwin/release/grind $(DIST_DIR)/grind.darwin_arm64

test:
	cargo test --release --workspace
	cargo clippy --release --workspace -- -D warnings
	cargo fmt --all --check

clean:
	cargo clean
