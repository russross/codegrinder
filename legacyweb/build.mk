.DEFAULT_GOAL := all
PROTO_OUTPUTS := generated/codegrinder.ts generated/codegrinder.client.ts generated/google/protobuf/duration.ts generated/google/protobuf/timestamp.ts
SOURCES := $(shell find scripts -type f -name '*.ts' | sort) $(wildcard *.ts *.json *.mjs *.css *.html)

.PHONY: all build proto check test test-browser mostlyclean clean FORCE
all: build
build: build/.published
proto: $(PROTO_OUTPUTS)

# Inventories include source names so removing a module invalidates the bundle.
build/inputs: FORCE
	sh ../../scripts/inventory.sh $@ $(SOURCES) ../../protocol/codegrinder.proto

node_modules/.installed: package.json bun.lock
	bun install --frozen-lockfile
	touch $@

$(PROTO_OUTPUTS) &: ../../protocol/codegrinder.proto proto-gen.sh protoc-gen-ts.sh node_modules/.installed
	./proto-gen.sh
	touch $(PROTO_OUTPUTS)

# Webpack emits page modules, workers, and optional chunks into the live tree.
-include build/outputs.mk build/published-outputs.mk
build/.built: build/inputs $(PROTO_OUTPUTS) node_modules/.installed
	bun run --bun typecheck
	bun run --bun webpack
	sh ../../scripts/outputs.sh build/outputs.mk WEB $@ $$(find scripts -type f \( -name '*.js' -o -name '*.wasm' -o -name '*.LICENSE.txt' \) | sort) sw.js
	touch $@

check: $(PROTO_OUTPUTS)
	bun run --bun typecheck

test: build
	bun run test

test-browser: build
	bun run test:browser

# Static assets and generated bundles publish only after a successful build.
build/.published: build/.built tools/publish.py
	python3 tools/publish.py

FORCE:
.DELETE_ON_ERROR:
