#!/bin/sh
set -eu

protoc \
  --plugin=protoc-gen-ts=./protoc-gen-ts.sh \
  --ts_out ./ \
  --ts_opt long_type_string,generate_dependencies \
  --proto_path ../../protocol \
  ../../protocol/codegrinder.proto
