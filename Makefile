ROOT_DIR := $(CURDIR)
PROTO_DIR := $(ROOT_DIR)/protocol
PROTO_FILE := $(PROTO_DIR)/codegrinder.proto
SERVER_DIR := server
CLI_DIR := cli
SERVER_OUT_DIR := $(ROOT_DIR)/server
CLI_OUT_DIR := $(ROOT_DIR)/cli

.PHONY: all setup proto proto-server proto-cli build test clean

all: build

setup:
	@missing=0; \
	for tool in uv python; do \
		if ! command -v $$tool >/dev/null 2>&1; then \
			echo "Missing tool: $$tool"; \
			missing=1; \
		fi; \
	done; \
	if [ $$missing -ne 0 ]; then \
		echo "One or more required tools are missing. Skipping dependency setup."; \
		exit 0; \
	fi
	uv sync --directory $(SERVER_DIR) --group dev
	uv sync --directory $(CLI_DIR) --group dev

proto: proto-server proto-cli

proto-server: $(PROTO_FILE)
	@missing=0; \
	for tool in uv; do \
		if ! command -v $$tool >/dev/null 2>&1; then \
			echo "Missing tool: $$tool"; \
			missing=1; \
		fi; \
	done; \
	if [ $$missing -ne 0 ]; then \
		echo "Skipping proto generation for $(SERVER_DIR)."; \
		exit 0; \
	fi
	@proto_include="$$(uv run --directory $(SERVER_DIR) python -c 'import pathlib, grpc_tools; print(pathlib.Path(grpc_tools.__file__).with_name("_proto"))' 2>/dev/null || true)"; \
	if [ -z "$$proto_include" ]; then \
		echo "Missing grpcio-tools in $(SERVER_DIR). Run: make setup"; \
		exit 1; \
	fi; \
	uv run --directory $(SERVER_DIR) python -m grpc_tools.protoc \
		-I $(PROTO_DIR) \
		-I "$$proto_include" \
		--python_out=$(SERVER_OUT_DIR) \
		--pyi_out=$(SERVER_OUT_DIR) \
		--grpc_python_out=$(SERVER_OUT_DIR) \
		$(PROTO_FILE)

proto-cli: $(PROTO_FILE)
	@missing=0; \
	for tool in uv; do \
		if ! command -v $$tool >/dev/null 2>&1; then \
			echo "Missing tool: $$tool"; \
			missing=1; \
		fi; \
	done; \
	if [ $$missing -ne 0 ]; then \
		echo "Skipping proto generation for $(CLI_DIR)."; \
		exit 0; \
	fi
	@proto_include="$$(uv run --directory $(CLI_DIR) python -c 'import pathlib, grpc_tools; print(pathlib.Path(grpc_tools.__file__).with_name("_proto"))' 2>/dev/null || true)"; \
	if [ -z "$$proto_include" ]; then \
		echo "Missing grpcio-tools in $(CLI_DIR). Run: make setup"; \
		exit 1; \
	fi; \
	uv run --directory $(CLI_DIR) python -m grpc_tools.protoc \
		-I $(PROTO_DIR) \
		-I "$$proto_include" \
		--python_out=$(CLI_OUT_DIR) \
		--pyi_out=$(CLI_OUT_DIR) \
		--grpc_python_out=$(CLI_OUT_DIR) \
		$(PROTO_FILE)

build: proto

test: proto
	uv run --directory $(SERVER_DIR) python -m pytest
	uv run --directory $(CLI_DIR) python -m pytest

clean:
	rm -f $(SERVER_DIR)/codegrinder_pb2.py $(SERVER_DIR)/codegrinder_pb2.pyi $(SERVER_DIR)/codegrinder_pb2_grpc.py
	rm -f $(CLI_DIR)/codegrinder_pb2.py $(CLI_DIR)/codegrinder_pb2.pyi $(CLI_DIR)/codegrinder_pb2_grpc.py
	rm -f $(SERVER_DIR)/.coverage $(CLI_DIR)/.coverage
	rm -rf $(SERVER_DIR)/htmlcov $(CLI_DIR)/htmlcov
	rm -rf $(SERVER_DIR)/.pytest_cache $(CLI_DIR)/.pytest_cache
	rm -rf $(SERVER_DIR)/.ty $(CLI_DIR)/.ty
	rm -rf $(SERVER_DIR)/.ty_cache $(CLI_DIR)/.ty_cache
	rm -rf $(SERVER_DIR)/.mypy_cache $(CLI_DIR)/.mypy_cache
	rm -rf $(SERVER_DIR)/.ruff_cache $(CLI_DIR)/.ruff_cache
	find $(SERVER_DIR) -type d -name '__pycache__' -prune -exec rm -rf {} +
	find $(CLI_DIR) -type d -name '__pycache__' -prune -exec rm -rf {} +
	find $(SERVER_DIR) -type d -name '*.egg-info' -prune -exec rm -rf {} +
	find $(CLI_DIR) -type d -name '*.egg-info' -prune -exec rm -rf {} +
