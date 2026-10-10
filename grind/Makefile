PACKAGE := grind
BINARY := grind
include ../scripts/rust.mk

ROOT_DIR := $(abspath ..)
DIST_DIR ?= $(ROOT_DIR)/www
MACOS_SDK_DIR ?= $(ROOT_DIR)/macos-minimal-sdk
MACOS_AMD64_SDKROOT ?= $(MACOS_SDK_DIR)/sysroot-macos-x86_64
MACOS_ARM64_SDKROOT ?= $(MACOS_SDK_DIR)/sysroot-macos-arm64
MACOSX_DEPLOYMENT_TARGET ?= 11.0

# Cross builds retain Cargo's cache; publish only changed executable bytes.
.PHONY: grind-dist grind-linux-amd64 grind-linux-arm64 grind-macos-amd64 grind-macos-arm64
grind-dist: grind-linux-amd64 grind-linux-arm64 grind-macos-amd64 grind-macos-arm64

grind-linux-amd64: build
	sh ../scripts/publish-client.sh ../target/release/grind '$(DIST_DIR)/grind.linux_amd64' static

grind-linux-arm64:
	cargo zigbuild --release --locked -p grind --target aarch64-unknown-linux-musl
	sh ../scripts/publish-client.sh ../target/aarch64-unknown-linux-musl/release/grind '$(DIST_DIR)/grind.linux_arm64' static

grind-macos-amd64:
	$(MAKE) -C $(MACOS_SDK_DIR) sysroot-macos-x86_64
	SDKROOT='$(MACOS_AMD64_SDKROOT)' MACOSX_DEPLOYMENT_TARGET='$(MACOSX_DEPLOYMENT_TARGET)' cargo zigbuild --release --locked -p grind --target x86_64-apple-darwin
	sh ../scripts/publish-client.sh ../target/x86_64-apple-darwin/release/grind '$(DIST_DIR)/grind.darwin_amd64'

grind-macos-arm64:
	$(MAKE) -C $(MACOS_SDK_DIR) sysroot-macos-arm64
	SDKROOT='$(MACOS_ARM64_SDKROOT)' MACOSX_DEPLOYMENT_TARGET='$(MACOSX_DEPLOYMENT_TARGET)' cargo zigbuild --release --locked -p grind --target aarch64-apple-darwin
	sh ../scripts/publish-client.sh ../target/aarch64-apple-darwin/release/grind '$(DIST_DIR)/grind.darwin_arm64'

mostlyclean: mostlyclean-dist
.PHONY: mostlyclean-dist clean-dist
mostlyclean-dist:
	rm -f '$(DIST_DIR)/grind.linux_amd64.part' '$(DIST_DIR)/grind.linux_arm64.part' '$(DIST_DIR)/grind.darwin_amd64.part' '$(DIST_DIR)/grind.darwin_arm64.part'

clean: clean-dist
clean-dist:
	rm -f '$(DIST_DIR)/grind.linux_amd64' '$(DIST_DIR)/grind.linux_arm64' '$(DIST_DIR)/grind.darwin_amd64' '$(DIST_DIR)/grind.darwin_arm64'
