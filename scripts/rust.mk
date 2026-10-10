# Cargo tracks source files, embedded assets, build scripts, and compiler flags.
# Always consult its graph rather than duplicating it with Make timestamps.
.PHONY: all build check test test-only mostlyclean clean
all: build
build:
	cargo build --release --locked -p $(PACKAGE)

check:
	cargo fmt --package $(PACKAGE) --check
	cargo clippy --release --locked -p $(PACKAGE) -- -D warnings

test: check
	$(MAKE) -C . test-only

test-only:
	cargo test --release --locked -p $(PACKAGE) $(TEST_ARGS)

# The workspace cache is shared; preserve both native deployment executables.
mostlyclean:
	sh ../scripts/mostlyclean-rust.sh ../target

clean: mostlyclean
	rm -f ../target/release/$(BINARY) ../target/release/$(BINARY).d
