.DEFAULT_GOAL := all
PROTO_OUTPUTS := codegrinder.ts codegrinder.client.ts google/protobuf/duration.ts google/protobuf/timestamp.ts
UI_SOURCES := $(filter-out $(PROTO_OUTPUTS) %.test.ts style.css,$(wildcard *.ts *.css)) tsconfig.json webpack.config.mjs

all: ../../dist/client/index.html
proto: $(PROTO_OUTPUTS)

# Inventories capture source edits and deletions without invalidating unchanged bundles.
build/ui-inputs: FORCE
	sh ../../scripts/inventory.sh $@ $(UI_SOURCES)

node_modules/.installed: package.json bun.lock
	bun install --frozen-lockfile
	touch $@

../vms/build/assets.json: FORCE
	$(MAKE) -C ../../vms

$(PROTO_OUTPUTS) &: ../../protocol/codegrinder.proto proto-gen.sh protoc-gen-ts.sh node_modules/.installed
	./proto-gen.sh
	touch $(PROTO_OUTPUTS)

# Output inventories also recover individual bundles removed outside cleanup.
-include build/ui-outputs.mk build/published-outputs.mk
build/ui/.built: node_modules/.installed ../vms/build/assets.json build/ui-inputs $(PROTO_OUTPUTS)
	bun run --bun typecheck
	bun run --bun webpack
	sh ../../scripts/outputs.sh build/ui-outputs.mk UI $@ $$(find build/ui -type f ! -name .built | sort)
	touch $@

# Keep prior immutable assets for already-open tabs and cached entry pages.
../../dist/client/index.html: build/ui/.built index.template.html style.css favicon.svg scripts/publish.py
	python3 scripts/publish.py

check: node_modules/.installed $(PROTO_OUTPUTS) ../vms/build/assets.json
	bun run --bun typecheck

test: all
	bun run test

test-widgets: node_modules/.installed $(PROTO_OUTPUTS) ../vms/build/assets.json
	bun run test:widgets

test-browser: all
	bun run test:browser

FORCE:
.PHONY: all proto check test test-widgets test-browser FORCE
.DELETE_ON_ERROR:
