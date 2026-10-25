RISCBOX_VERSION := 2026.10.7
.DEFAULT_GOAL := all
RISCLET_VERSION := 0.5.5
ALPINE_VERSION := 3.24.2
ALPINE_SHA256 := 57132e6e4f3a4ba9ffdf24e485513ce507e45471e7fd565aeed91c055cd63f7b
RISCBOX_ARCHIVE := build/downloads/riscbox-$(RISCBOX_VERSION).tar.gz
RISCLET_BINARY := build/downloads/risclet-$(RISCLET_VERSION)
ALPINE_ARCHIVE := build/downloads/alpine-minirootfs-$(ALPINE_VERSION)-riscv64.tar.gz
CLANG_ARCHIVE ?= $(HOME)/clang-21.1.8-alpine3.24-rv64gc.tar.gz
IMAGES := riscv c
riscv_SIZE := 12
c_SIZE := 96
riscv_PACKAGES := make tzdata
c_PACKAGES := make tzdata tcc tcc-libs-static
riscv_TOOLS := build/riscv-tools.tar
c_TOOLS := $(CLANG_ARCHIVE)
GUEST_SOURCES := $(shell find guest -type f | sort)

all: build/assets.stamp

# Inventories capture removed sources and release changes without touching unchanged inputs.
build/guest-inputs: FORCE
	sh ../../../scripts/inventory.sh $@ $(GUEST_SOURCES)

build/riscbox-version: FORCE
	@mkdir -p build
	@printf '%s\n' '$(RISCBOX_VERSION)' > $@.part
	@cmp -s $@.part $@ && rm $@.part || mv $@.part $@

build/alpine-version: FORCE
	@mkdir -p build
	@printf '%s\n' '$(ALPINE_VERSION)' '$(ALPINE_SHA256)' > $@.part
	@cmp -s $@.part $@ && rm $@.part || mv $@.part $@

build/risclet-version: FORCE
	@mkdir -p build
	@printf '%s\n' '$(RISCLET_VERSION)' > $@.part
	@cmp -s $@.part $@ && rm $@.part || mv $@.part $@

$(RISCBOX_ARCHIVE): scripts/download-release.sh scripts/fetch.sh
	./scripts/download-release.sh riscbox '$(RISCBOX_VERSION)' '$@'

$(RISCLET_BINARY): scripts/download-release.sh scripts/fetch.sh
	./scripts/download-release.sh risclet '$(RISCLET_VERSION)' '$@'

$(ALPINE_ARCHIVE): scripts/fetch.sh build/alpine-version
	./scripts/fetch.sh 'https://dl-cdn.alpinelinux.org/alpine/v$(basename $(ALPINE_VERSION))/releases/riscv64/$(notdir $@)' '$(ALPINE_SHA256)' '$@'

# Public declarations, runtime, and boot payloads always come from the same archive.
-include build/runtime-outputs.mk $(foreach image,$(IMAGES),build/$(image)-disk-outputs.mk) build/assets-outputs.mk build/release-outputs.mk
build/riscbox.stamp: $(RISCBOX_ARCHIVE) build/riscbox-version
	rm -rf build/riscbox.part
	mkdir -p build/riscbox.part
	tar -xzf '$(RISCBOX_ARCHIVE)' --strip-components=1 -C build/riscbox.part
	test -f build/riscbox.part/riscbox.js
	test -f build/riscbox.part/riscbox.wasm
	test -f build/riscbox.part/riscbox.d.ts
	rm -rf build/riscbox
	mv build/riscbox.part build/riscbox
	sh ../../../scripts/outputs.sh build/release-outputs.mk RELEASE $@ $$(find build/riscbox -type f | sort)
	touch $@

runtime/riscbox-$(RISCBOX_VERSION)/.built: build/riscbox.stamp
	mkdir -p '$(@D)'
	cp -R build/riscbox/. '$(@D)/'
	printf '{"type":"commonjs"}\n' > '$(@D)/package.json'
	sh ../../../scripts/outputs.sh build/runtime-outputs.mk RUNTIME $@ $$(find '$(@D)' -type f ! -name .built | sort)
	touch $@

# Kernel and firmware are shared by every preparation boot.
build/boot.stamp: build/riscbox.stamp build/linux build/fw_dynamic.bin
	gzip -dc build/riscbox/linux-*.gz > build/linux
	gzip -dc build/riscbox/fw_dynamic.bin-*.gz > build/fw_dynamic.bin
	touch $@

build/linux build/fw_dynamic.bin:

build/riscv-tools.tar: $(RISCLET_BINARY) build/risclet-version
	mkdir -p build/riscv-tools/usr/local/bin
	cp '$(RISCLET_BINARY)' build/riscv-tools/usr/local/bin/risclet
	chmod 755 build/riscv-tools/usr/local/bin/risclet
	tar -cf $@ -C build/riscv-tools usr

# Each sibling image inventories its own overlay, including source deletions.
$(foreach image,$(IMAGES),build/$(image)-inputs): build/%-inputs: FORCE
	sh ../../../scripts/inventory.sh $@ $$(find $* -type f | sort)

build/riscv-rootfs.ext4: build/riscv-inputs build/riscv-tools.tar

build/c-rootfs.ext4: build/c-inputs $(CLANG_ARCHIVE)

# Settings changes rebuild only the image whose effective inputs changed.
$(foreach image,$(IMAGES),build/$(image)-settings): build/%-settings: FORCE
	@mkdir -p build
	@printf '%s\n' '$($*_SIZE)' '$($*_PACKAGES)' '$($*_TOOLS)' > $@.part
	@cmp -s $@.part $@ && rm $@.part || mv $@.part $@

$(foreach image,$(IMAGES),build/$(image)-rootfs.ext4): build/%-rootfs.ext4: build/%-settings build/guest-inputs build-image.sh $(ALPINE_ARCHIVE) build/boot.stamp
	./build-image.sh '$*' '$($*_SIZE)' '$(ALPINE_ARCHIVE)' '$($*_TOOLS)' $($*_PACKAGES)

# The upstream splitter hashes content; each image adds its sibling name.
$(foreach image,$(IMAGES),build/$(image)-disk-name): build/%-disk-name: build/%-rootfs.ext4 build/riscbox.stamp
	mkdir -p image build/$*-split
	python3 build/riscbox/splitimg.py $< build/$*-split > $@.part
	awk '{print "$*-" $$1}' $@.part > $@
	mkdir -p image/$$(cat $@)
	cp -R build/$*-split/$$(awk '{print $$1}' $@.part)/. image/$$(cat $@)/
	rm -rf build/$*-split
	rm $@.part
	sh ../../../scripts/outputs.sh build/$*-disk-outputs.mk DISK_$* $@ $$(find "image/$$(cat $@)" -type f | sort)
	touch $@

build/assets.stamp: $(foreach image,$(IMAGES),build/$(image)-disk-name) scripts/assets.py runtime/riscbox-$(RISCBOX_VERSION)/.built
	python3 scripts/assets.py '$(RISCBOX_VERSION)' $(IMAGES)
	touch build/assets.stamp

# Build caches can disappear while cached browsers retain their deployed assets.
mostlyclean:
	rm -rf build
	rm -f image/*.part
	find runtime -name .built -type f -delete

clean: mostlyclean
	rm -rf runtime/riscbox-*
	rm -f runtime/riscbox.js runtime/riscbox.wasm runtime/riscbox.d.ts runtime/SHA256SUMS
	find image -mindepth 1 -maxdepth 1 -exec rm -rf {} +

FORCE:
.PHONY: all mostlyclean clean FORCE
.DELETE_ON_ERROR:
