RISCBOX_VERSION := 2026.10.7
RISCLET_VERSION := 0.5.5
ALPINE_VERSION := 3.24.2
ALPINE_SHA256 := 57132e6e4f3a4ba9ffdf24e485513ce507e45471e7fd565aeed91c055cd63f7b
RISCBOX_ARCHIVE := build/downloads/riscbox-$(RISCBOX_VERSION).tar.gz
RISCLET_BINARY := build/downloads/risclet-$(RISCLET_VERSION)
ALPINE_ARCHIVE := build/downloads/alpine-minirootfs-$(ALPINE_VERSION)-riscv64.tar.gz
GUEST_SOURCES := $(shell find guest -type f | sort)

all: build/assets.json

# Inventories capture removed sources and release changes without touching unchanged inputs.
build/guest-inputs: FORCE
	@mkdir -p build
	@sha256sum $(GUEST_SOURCES) > $@.part
	@cmp -s $@.part $@ && rm $@.part || mv $@.part $@

build/versions: FORCE
	@mkdir -p build
	@printf 'riscbox=%s\nrisclet=%s\n' '$(RISCBOX_VERSION)' '$(RISCLET_VERSION)' > $@.part
	@cmp -s $@.part $@ && rm $@.part || mv $@.part $@

$(RISCBOX_ARCHIVE): scripts/download-release.sh scripts/fetch.sh
	./scripts/download-release.sh riscbox '$(RISCBOX_VERSION)' '$@'

$(RISCLET_BINARY): scripts/download-release.sh scripts/fetch.sh
	./scripts/download-release.sh risclet '$(RISCLET_VERSION)' '$@'

$(ALPINE_ARCHIVE): scripts/fetch.sh
	./scripts/fetch.sh 'https://dl-cdn.alpinelinux.org/alpine/v$(basename $(ALPINE_VERSION))/releases/riscv64/$(notdir $@)' '$(ALPINE_SHA256)' '$@'

# Public declarations, runtime, and boot payloads always come from the same archive.
build/riscbox.stamp: $(RISCBOX_ARCHIVE) build/versions
	rm -rf build/riscbox.part
	mkdir -p build/riscbox.part
	tar -xzf '$(RISCBOX_ARCHIVE)' --strip-components=1 -C build/riscbox.part
	test -f build/riscbox.part/riscbox.js
	test -f build/riscbox.part/riscbox.wasm
	test -f build/riscbox.part/riscbox.d.ts
	rm -rf build/riscbox
	mv build/riscbox.part build/riscbox
	touch $@

runtime/riscbox-$(RISCBOX_VERSION)/.built: build/riscbox.stamp
	mkdir -p '$(@D)'
	cp -R build/riscbox/. '$(@D)/'
	printf '{"type":"commonjs"}\n' > '$(@D)/package.json'
	touch $@

build/rootfs.ext4: build/guest-inputs build-image.sh $(RISCLET_BINARY) $(ALPINE_ARCHIVE) build/versions build/riscbox.stamp
	./build-image.sh build/riscbox '$(RISCLET_BINARY)' '$(ALPINE_ARCHIVE)'

# Disk splitting and image preparation are independent of all app changes.
build/disk-name: build/rootfs.ext4 build/riscbox.stamp
	mkdir -p image
	python3 build/riscbox/splitimg.py build/rootfs.ext4 image > $@.part
	awk '{print $$1}' $@.part > $@
	rm $@.part

build/assets.json: build/disk-name build/versions scripts/assets.mjs runtime/riscbox-$(RISCBOX_VERSION)/.built
	node scripts/assets.mjs '$(RISCBOX_VERSION)'

FORCE:
.PHONY: all FORCE
.DELETE_ON_ERROR:
