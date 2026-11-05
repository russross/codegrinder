.DEFAULT_GOAL := all

# Source overlays and preparation scripts execute inside the shared build tree.
all:
	python3 ../scripts/stage-sources.py . ../build/vms
	$(MAKE) -C ../build/vms -f build.mk

mostlyclean:
	python3 ../client/scripts/prune.py --vm-only
	rm -rf ../build/vms

clean:
	rm -rf ../build/vms ../dist/vms

.PHONY: all mostlyclean clean
