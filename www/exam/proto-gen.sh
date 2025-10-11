#!/bin/bash
pwd
protoc \
  --plugin=protoc-gen-ts=./node_modules/.bin/protoc-gen-ts \
  --ts_out ./ \
  --ts_opt long_type_string,generate_dependencies,client_none \
  --proto_path . \
  codegrinder.proto
