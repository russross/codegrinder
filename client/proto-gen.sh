#!/bin/sh
set -eu

./node_modules/.bin/grpc_tools_node_protoc \
  --plugin=protoc-gen-ts=./node_modules/.bin/protoc-gen-ts \
  --ts_out ./ \
  --ts_opt long_type_string,generate_dependencies \
  --proto_path ../../protocol \
  ../../protocol/codegrinder.proto
