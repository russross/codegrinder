#!/bin/sh
set -eu
# Run the TypeScript generator without relying on its Node shebang.
exec bun ./node_modules/@protobuf-ts/plugin/bin/protoc-gen-ts "$@"
