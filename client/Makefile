.DEFAULT_GOAL := all

# Compile a synchronized source tree so dependencies and generated bindings stay out of source.
all proto check test test-widgets test-browser:
	python3 ../scripts/stage-sources.py . ../build/client
	$(MAKE) -C ../build/client -f build.mk $@

mostlyclean:
	python3 scripts/prune.py
	rm -rf ../build/client
	$(MAKE) -C ../vms mostlyclean

clean:
	rm -rf ../build/client ../www/client
	$(MAKE) -C ../vms clean

.PHONY: all proto check test test-widgets test-browser mostlyclean clean
