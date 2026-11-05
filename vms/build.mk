RISCBOX_VERSION := $(shell cat riscbox.version)
.DEFAULT_GOAL := all
RISCLET_VERSION := $(shell cat risclet.version)
ALPINE_VERSION := $(shell cat alpine.version)
ALPINE_SHA256 := 9714553757e7bf645eff5dcc52bdd206f358a7bed77874842567852e8326a51d
RISCBOX_ARCHIVE := ../downloads/riscbox-$(RISCBOX_VERSION).tar.gz
RISCLET_BINARY := ../downloads/risclet-$(RISCLET_VERSION)
ALPINE_ARCHIVE := ../downloads/alpine-minirootfs-$(ALPINE_VERSION)-riscv64.tar.gz
IMAGES := riscv c
riscv_SIZE := 12
c_SIZE := 16
riscv_PACKAGES := make tzdata
c_PACKAGES := make tzdata tcc tcc-libs-static musl-dev
riscv_TOOLS := build/riscv-tools.tar
c_TOOLS := -
GUEST_SOURCES := $(shell find guest -type f | sort)
STEPPER := ../../stepper/dist/stepper.linux_riscv64

all: build/assets.stamp

# Inventories capture removed sources and release changes without touching unchanged inputs.
build/guest-inputs: FORCE
	sh ../../scripts/inventory.sh $@ $(GUEST_SOURCES)

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

$(RISCBOX_ARCHIVE):
	./scripts/download-release.sh riscbox '$(RISCBOX_VERSION)' '$@'

$(RISCLET_BINARY):
	./scripts/download-release.sh risclet '$(RISCLET_VERSION)' '$@'

$(ALPINE_ARCHIVE):
	./scripts/fetch.sh 'https://dl-cdn.alpinelinux.org/alpine/v$(basename $(ALPINE_VERSION))/releases/riscv64/$(notdir $@)' '$(ALPINE_SHA256)' '$@'

# Public declarations, runtime, and boot payloads always come from the same archive.
-include build/runtime-outputs.mk $(foreach image,$(IMAGES),build/$(image)-disk-outputs.mk) build/assets-outputs.mk build/release-outputs.mk
build/riscbox.stamp: $(RISCBOX_ARCHIVE) build/riscbox-version scripts/unpack-release.py
	python3 scripts/unpack-release.py '$(RISCBOX_ARCHIVE)' ../downloads/riscbox-$(RISCBOX_VERSION)
	for file in ../downloads/riscbox-$(RISCBOX_VERSION)/riscbox-*/*.br; do [ -f "$$file" ] || continue; [ -f "$${file%.br}" ] || brotli -d -k "$$file"; done
	ln -sfn ../../downloads/riscbox-$(RISCBOX_VERSION) build/riscbox
	sh ../../scripts/outputs.sh build/release-outputs.mk RELEASE $@ $$(find ../downloads/riscbox-$(RISCBOX_VERSION) -type f | sort)
	touch $@

build/runtime.stamp: build/riscbox.stamp
	mkdir -p ../../www/vms
	cp -R build/riscbox/riscbox-* ../../www/vms/
	sh ../../scripts/outputs.sh build/runtime-outputs.mk RUNTIME $@ $$(find ../../www/vms/riscbox-* -type f | sort)
	touch $@

# Kernel and firmware are shared by every preparation boot.
build/boot.stamp: build/riscbox.stamp build/linux build/fw_dynamic.bin
	cp build/riscbox/riscbox-*/linux build/linux
	cp build/riscbox/riscbox-*/fw_dynamic.bin build/fw_dynamic.bin
	touch $@

build/linux build/fw_dynamic.bin:

build/riscv-tools.tar: $(RISCLET_BINARY) build/risclet-version
	mkdir -p build/riscv-tools/usr/local/bin
	cp '$(RISCLET_BINARY)' build/riscv-tools/usr/local/bin/risclet
	chmod 755 build/riscv-tools/usr/local/bin/risclet
	tar -cf $@ -C build/riscv-tools usr

# Each sibling image inventories its own overlay, including source deletions.
$(foreach image,$(IMAGES),build/$(image)-inputs): build/%-inputs: FORCE
	sh ../../scripts/inventory.sh $@ $$(find $* -type f | sort)

# Consult Cargo before comparing the published runner's timestamp.
.PHONY: stepper
stepper:
	$(MAKE) -C ../../stepper riscv64

$(STEPPER): stepper

build/riscv-rootfs.ext4: build/riscv-inputs build/riscv-tools.tar

build/c-rootfs.ext4: build/c-inputs

# Settings changes rebuild only the image whose effective inputs changed.
$(foreach image,$(IMAGES),build/$(image)-settings): build/%-settings: FORCE
	@mkdir -p build
	@printf '%s\n' '$($*_SIZE)' '$($*_PACKAGES)' '$($*_TOOLS)' > $@.part
	@cmp -s $@.part $@ && rm $@.part || mv $@.part $@

$(foreach image,$(IMAGES),build/$(image)-rootfs.ext4): build/%-rootfs.ext4: build/%-settings build/guest-inputs build-image.sh $(ALPINE_ARCHIVE) build/boot.stamp $(STEPPER)
	./build-image.sh '$*' '$($*_SIZE)' '$(ALPINE_ARCHIVE)' '$($*_TOOLS)' $($*_PACKAGES)

# The upstream splitter hashes content; each image adds its sibling name.
$(foreach image,$(IMAGES),build/$(image)-disk-name): build/%-disk-name: build/%-rootfs.ext4 build/riscbox.stamp
	mkdir -p ../../www/vms build/$*-split
	uv run -q --script build/riscbox/splitimg.py $< build/$*-split > $@.part
	awk '{print "$*-" $$1}' $@.part > $@
	mkdir -p ../../www/vms/$$(cat $@)
	cp -R build/$*-split/$$(awk '{print $$1}' $@.part)/. ../../www/vms/$$(cat $@)/
	rm -rf build/$*-split
	rm $@.part
	sh ../../scripts/outputs.sh build/$*-disk-outputs.mk DISK_$* $@ $$(find "../../www/vms/$$(cat $@)" -type f | sort)
	touch $@

build/assets.stamp: $(foreach image,$(IMAGES),build/$(image)-disk-name) scripts/assets.py build/runtime.stamp
	python3 scripts/assets.py '$(RISCBOX_VERSION)' $(IMAGES)
	touch build/assets.stamp

FORCE:
.PHONY: all stepper FORCE
.DELETE_ON_ERROR:
