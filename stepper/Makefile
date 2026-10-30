.DEFAULT_GOAL := all
AMD64 := x86_64-unknown-linux-musl
RISCV64 := riscv64gc-unknown-linux-musl

# Cargo tracks sources and flags; publication preserves unchanged output times.
.PHONY: all build amd64 riscv64 check test test-only mostlyclean clean
all: build
build: amd64 riscv64

amd64:
	RUSTFLAGS='-C target-feature=+crt-static' cargo zigbuild --locked --profile standalone-linux -p stepper --target $(AMD64)
	sh ../scripts/publish-client.sh ../target/$(AMD64)/standalone-linux/stepper dist/stepper.linux_amd64
	sh ../scripts/publish-client.sh dist/stepper.linux_amd64 ../problemtypes/containers/c/stepper
	sh ../scripts/publish-client.sh dist/stepper.linux_amd64 ../problemtypes/containers/prolog/stepper
	sh ../scripts/publish-client.sh dist/stepper.linux_amd64 ../problemtypes/containers/riscv/stepper

riscv64:
	RUSTFLAGS='-C target-feature=-crt-static -C link-arg=-dynamic' cargo zigbuild --locked --profile standalone-linux -p stepper --target $(RISCV64)
	sh ../scripts/publish-client.sh ../target/$(RISCV64)/standalone-linux/stepper dist/stepper.linux_riscv64

# Check every target, including fixtures compiled as external consumers.
check:
	cargo fmt --package stepper --check
	rustfmt --edition 2024 --check tests/support/multicall.rs
	cargo clippy --release --locked -p stepper --all-targets -- -D warnings

test: check
	$(MAKE) test-only

test-only:
	cargo test --release --locked -p stepper $(TEST_ARGS)

# Published runners survive intermediate-cache cleanup for dependent deployments.
mostlyclean:
	sh ../scripts/mostlyclean-rust.sh ../target
	rm -f dist/*.part

clean: mostlyclean
	rm -rf dist
