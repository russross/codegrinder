#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

if [ ! -f "$SCRIPT_DIR/codegrinder.proto" ]; then
    echo "Missing codegrinder.proto in $SCRIPT_DIR"
    echo "Expected symlink: ln -s ../rpc/codegrinder.proto pycli/codegrinder.proto"
    exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
    echo "uv is required. Install it first."
    exit 1
fi

PROTO_INCLUDE=$(uv run python -c 'import pathlib, grpc_tools; print(pathlib.Path(grpc_tools.__file__).with_name("_proto"))' 2>/dev/null || true)
if [ -z "$PROTO_INCLUDE" ]; then
    echo "Missing grpcio-tools in this uv environment."
    echo "Install with: uv sync --group dev"
    exit 1
fi

uv run python -m grpc_tools.protoc \
    -I "$SCRIPT_DIR" \
    -I "$PROTO_INCLUDE" \
    --python_out="$SCRIPT_DIR" \
    --pyi_out="$SCRIPT_DIR" \
    --grpc_python_out="$SCRIPT_DIR" \
    "$SCRIPT_DIR/codegrinder.proto"

echo "Generated: codegrinder_pb2.py, codegrinder_pb2.pyi, and codegrinder_pb2_grpc.py"
