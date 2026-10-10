#!/bin/sh
set -eu
destination=$1
shift
mkdir -p "$(dirname "$destination")"
trap 'rm -f "$destination.part"' 0

# File names and bytes record additions, removals, and content changes.
if [ "$#" -eq 0 ]; then
    : > "$destination.part"
else
    sha256sum "$@" > "$destination.part"
fi
if ! cmp -s "$destination.part" "$destination"; then
    mv "$destination.part" "$destination"
fi
