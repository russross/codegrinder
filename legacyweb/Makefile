.DEFAULT_GOAL := all

# Keep dependencies, generated bindings, bundles, and test artifacts in the build tree.
all build proto check test test-browser:
	python3 ../scripts/stage-sources.py . ../build/legacyweb
	$(MAKE) -C ../build/legacyweb -f build.mk $@

mostlyclean:
	rm -rf ../build/legacyweb

clean: mostlyclean
	rm -rf ../dist/web

.PHONY: all build proto check test test-browser mostlyclean clean
