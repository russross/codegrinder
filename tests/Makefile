.PHONY: all build-check end2end mostlyclean clean
all: build-check

# End-to-end checks use the deployed server and client, without rebuilding them.
end2end:
	python3 e2e.py

build-check:
	python3 test_build.py

# Test failure artifacts are diagnostic records, not build intermediates.
mostlyclean:
	find . -type d -name __pycache__ -prune -exec rm -rf {} +

clean: mostlyclean
