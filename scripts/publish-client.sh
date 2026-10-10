#!/bin/sh
set -eu
source=$1
destination=$2

# Reject dynamically linked Linux executables before replacing a deployment.
if [ "${3:-}" = static ]; then
    headers=$(readelf -l "$source")
    case "$headers" in
        *INTERP*) echo "Linux grind is dynamically linked: $source" >&2; exit 1 ;;
    esac
fi
mkdir -p "$(dirname "$destination")"
trap 'rm -f "$destination.part"' 0
if ! cmp -s "$source" "$destination"; then
    cp "$source" "$destination.part"
    mv "$destination.part" "$destination"
fi
