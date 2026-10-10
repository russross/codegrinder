UI_SOURCES := $(filter-out %.test.ts,$(wildcard *.ts *.d.ts *.css google/protobuf/*.ts)) tsconfig.json webpack.config.mjs

all: index.html

# Inventories capture source edits and deletions without invalidating unchanged bundles.
build/ui-inputs: FORCE
	@mkdir -p build
	@sha256sum $(UI_SOURCES) > $@.part
	@cmp -s $@.part $@ && rm $@.part || mv $@.part $@

node_modules/.installed: package.json package-lock.json
	npm ci
	touch $@

vm/build/assets.json: FORCE
	$(MAKE) -C vm

build/ui/.built: node_modules/.installed vm/build/assets.json build/ui-inputs
	npm run proto:generate
	npm run typecheck
	node_modules/.bin/webpack
	touch $@

# Keep prior immutable assets for already-open tabs and cached entry pages.
index.html: build/ui/.built index.template.html favicon.svg scripts/publish.mjs
	node scripts/publish.mjs

FORCE:
.PHONY: all FORCE
.DELETE_ON_ERROR:
