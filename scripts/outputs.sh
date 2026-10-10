#!/bin/sh
set -eu
destination=$1
name=$2
target=$3
shift 3

# Remember actual emitted paths so a deleted output rebuilds its producer.
{
    printf '%s_OUTPUTS :=' "$name"
    printf ' %s' "$@"
    printf '\n%s: $(%s_OUTPUTS)\n$(%s_OUTPUTS):\n' "$target" "$name" "$name"
} > "$destination.part"
mv "$destination.part" "$destination"
