# Cargo tracks source files, embedded assets, build scripts, and compiler flags.
# Always consult its graph rather than duplicating it with Make timestamps.
.PHONY: all build compile check test test-only mostlyclean clean
BUILD_TARGET ?= compile
all: build
build: $(BUILD_TARGET)
compile:
	cargo build --release --locked -p $(PACKAGE)

check:
	cargo fmt --package $(PACKAGE) --check
	cargo clippy --release --locked -p $(PACKAGE) -- -D warnings

# Bound independent tests so process-heavy deadline checks retain scheduling headroom.
RUST_TEST_THREADS ?= $(shell nproc | awk '{print ($$1 < 4 ? $$1 : 4)}')
export RUST_TEST_THREADS

test: check
	$(MAKE) -C . test-only

test-only:
	cargo test --release --locked -p $(PACKAGE) $(TEST_ARGS)

# The workspace cache is shared; preserve both native deployment executables.
mostlyclean:
	sh ../scripts/mostlyclean-rust.sh ../target

clean: mostlyclean
	rm -f ../target/release/$(BINARY) ../target/release/$(BINARY).d
