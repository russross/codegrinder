#!/bin/sh
set -eu

mkdir -p generated
protoc \
  --plugin=protoc-gen-ts=./protoc-gen-ts.sh \
  --ts_out generated \
  --ts_opt long_type_string,generate_dependencies \
  --proto_path ../../protocol \
  ../../protocol/codegrinder.proto
