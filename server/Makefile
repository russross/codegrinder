PACKAGE := codegrinder
BINARY := codegrinder
DEPLOY_TARGET := x86_64-unknown-linux-musl
BUILD_TARGET := install
include ../scripts/rust.mk

DIST_DIR ?= $(abspath ../dist)

# Publish atomically so a running service can retain its existing executable.
install:
	cargo zigbuild --release --locked -p $(PACKAGE) --target $(DEPLOY_TARGET)
	sh ../scripts/publish-client.sh ../target/$(DEPLOY_TARGET)/release/codegrinder '$(DIST_DIR)/server/codegrinder' static

mostlyclean: mostlyclean-dist
mostlyclean-dist:
	rm -f '$(DIST_DIR)/server/codegrinder.part'

clean: clean-dist
clean-dist:
	rm -rf '$(DIST_DIR)/server'

.PHONY: install mostlyclean-dist clean-dist
