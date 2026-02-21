#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

rm -f codegrinder_pb2.py codegrinder_pb2.pyi codegrinder_pb2_grpc.py
rm -f .coverage
rm -rf htmlcov .pytest_cache .ty .ty_cache .mypy_cache .ruff_cache

find "$SCRIPT_DIR" -type d -name '__pycache__' -prune -exec rm -rf {} +
find "$SCRIPT_DIR" -type d -name '*.egg-info' -prune -exec rm -rf {} +

echo "Cleaned pycli artifacts"
