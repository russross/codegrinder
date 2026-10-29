.DEFAULT_GOAL := all
PROTO_OUTPUTS := codegrinder.ts codegrinder.client.ts google/protobuf/duration.ts google/protobuf/timestamp.ts
UI_SOURCES := $(filter-out $(PROTO_OUTPUTS) %.test.ts style.css,$(wildcard *.ts *.css)) tsconfig.json webpack.config.mjs

all: index.html
proto: $(PROTO_OUTPUTS)

# Inventories capture source edits and deletions without invalidating unchanged bundles.
build/ui-inputs: FORCE
	sh ../../scripts/inventory.sh $@ $(UI_SOURCES)

node_modules/.installed: package.json package-lock.json
	npm ci
	touch $@

vm/build/assets.json: FORCE
	$(MAKE) -C vm

$(PROTO_OUTPUTS) &: ../../protocol/codegrinder.proto proto-gen.sh node_modules/.installed
	./proto-gen.sh
	touch $(PROTO_OUTPUTS)

# Output inventories also recover individual bundles removed outside cleanup.
-include build/ui-outputs.mk build/published-outputs.mk
build/ui/.built: node_modules/.installed vm/build/assets.json build/ui-inputs $(PROTO_OUTPUTS)
	npm run typecheck
	node_modules/.bin/webpack
	sh ../../scripts/outputs.sh build/ui-outputs.mk UI $@ $$(find build/ui -type f ! -name .built | sort)
	touch $@

# Keep prior immutable assets for already-open tabs and cached entry pages.
index.html: build/ui/.built index.template.html style.css favicon.svg scripts/publish.py
	python3 scripts/publish.py

check: node_modules/.installed $(PROTO_OUTPUTS) vm/build/assets.json
	npm run typecheck

test: all
	npm test

test-widgets: node_modules/.installed $(PROTO_OUTPUTS)
	npm run test:widgets

test-browser: all
	npm run test:browser

# Keep only the assets used by the published page, independently of build caches.
mostlyclean:
	python3 scripts/prune.py
	rm -rf build node_modules codegrinder.ts codegrinder.client.ts google
	rm -f index.html.part
	$(MAKE) -C vm mostlyclean

clean:
	rm -rf build node_modules codegrinder.ts codegrinder.client.ts google dist
	rm -f index.html index.html.part .published-assets.json .published-assets.json.part
	$(MAKE) -C vm clean

FORCE:
.PHONY: all proto check test test-widgets test-browser mostlyclean clean FORCE
.DELETE_ON_ERROR:
