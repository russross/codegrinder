PACKAGE := codegrinder
BINARY := codegrinder
include ../scripts/rust.mk

DIST_DIR ?= $(abspath ../dist)

# Publish atomically so a running service can retain its existing executable.
build: install
install: compile
	sh ../scripts/publish-client.sh ../target/release/codegrinder '$(DIST_DIR)/server/codegrinder'

mostlyclean: mostlyclean-dist
mostlyclean-dist:
	rm -f '$(DIST_DIR)/server/codegrinder.part'

clean: clean-dist
clean-dist:
	rm -rf '$(DIST_DIR)/server'

.PHONY: install mostlyclean-dist clean-dist
