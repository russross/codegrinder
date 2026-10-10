.DEFAULT_GOAL := all
PROTO_OUTPUTS := generated/codegrinder.ts generated/codegrinder.client.ts generated/google/protobuf/duration.ts generated/google/protobuf/timestamp.ts
SOURCES := $(shell find scripts -type f -name '*.ts' | sort) $(wildcard *.ts *.json *.mjs *.css *.html)

.PHONY: all build proto check test test-browser mostlyclean clean FORCE
all: build
build: build/.built
proto: $(PROTO_OUTPUTS)

# Inventories include source names so removing a module invalidates the bundle.
build/inputs: FORCE
	sh ../../scripts/inventory.sh $@ $(SOURCES) ../../protocol/codegrinder.proto

node_modules/.installed: package.json package-lock.json
	npm ci
	touch $@

$(PROTO_OUTPUTS) &: ../../protocol/codegrinder.proto proto-gen.sh node_modules/.installed
	./proto-gen.sh
	touch $(PROTO_OUTPUTS)

# Webpack emits page modules, workers, and optional chunks into the live tree.
-include build/outputs.mk
build/.built: build/inputs $(PROTO_OUTPUTS) node_modules/.installed
	npm run typecheck
	node_modules/.bin/webpack
	sh ../../scripts/outputs.sh build/outputs.mk WEB $@ $$(find scripts -type f \( -name '*.js' -o -name '*.wasm' -o -name '*.LICENSE.txt' \) | sort) sw.js
	touch $@

check: $(PROTO_OUTPUTS)
	npm run typecheck

test: build
	npm test

test-browser: build
	npm run test:browser

# Deployed JavaScript and static source assets remain usable without npm.
mostlyclean:
	rm -rf build generated node_modules

clean: mostlyclean
	rm -f scripts/*.js scripts/*.wasm scripts/*.LICENSE.txt sw.js sw.js.LICENSE.txt

FORCE:
.DELETE_ON_ERROR:
