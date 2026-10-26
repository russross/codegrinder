ROOT_DIR := $(CURDIR)
DIST_DIR ?= $(ROOT_DIR)/www
MACOS_SDK_DIR ?= $(ROOT_DIR)/macos-minimal-sdk
export DIST_DIR MACOS_SDK_DIR

.PHONY: all setup build server grind web web-check exam test end2end clean mostlyclean \
	grind-dist grind-linux-amd64 grind-linux-arm64 grind-macos-amd64 grind-macos-arm64

all: build

# Components own their workflows; Cargo owns the shared Rust dependency graph.
setup:
	cargo fetch --locked

build: server grind stepper

.PHONY: stepper
stepper:
	$(MAKE) -C stepper

server:
	$(MAKE) -C server

grind:
	$(MAKE) -C grind

web:
	$(MAKE) -C www/web

web-check:
	$(MAKE) -C www/web check

exam:
	$(MAKE) -C www/exam

grind-dist grind-linux-amd64 grind-linux-arm64 grind-macos-amd64 grind-macos-arm64:
	$(MAKE) -C grind $@

# Complete formatting and lint checks before either component starts its tests.
test:
	$(MAKE) -C server check
	$(MAKE) -C grind check
	$(MAKE) -C stepper check
	$(MAKE) -C server test-only
	$(MAKE) -C grind test-only
	$(MAKE) -C stepper test-only

end2end:
	$(MAKE) -C tests end2end

# Cleanup never reaches configuration, databases, or installed system files.
# SDK cleanup stays here so its checkout can track upstream without local changes.
mostlyclean:
	$(MAKE) -C stepper mostlyclean
	$(MAKE) -C server mostlyclean
	$(MAKE) -C grind mostlyclean
	$(MAKE) -C www mostlyclean
	rm -rf '$(MACOS_SDK_DIR)/sysroot-macos-x86_64' '$(MACOS_SDK_DIR)/sysroot-macos-arm64' '$(MACOS_SDK_DIR)/download'
	rm -f '$(MACOS_SDK_DIR)/hello'
	$(MAKE) -C tests mostlyclean

clean:
	$(MAKE) -C stepper clean
	$(MAKE) -C server clean
	$(MAKE) -C grind clean
	$(MAKE) -C www clean
	rm -rf '$(MACOS_SDK_DIR)/sysroot-macos-x86_64' '$(MACOS_SDK_DIR)/sysroot-macos-arm64' '$(MACOS_SDK_DIR)/download'
	rm -f '$(MACOS_SDK_DIR)/hello'
	$(MAKE) -C tests clean
