#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then
    echo "usage: $0 TARGET_DIRECTORY" >&2
    exit 2
fi
target=$1

# Keep the checkout's runnable binaries even across a service restart.
for entry in "$target"/* "$target"/.[!.]* "$target"/..?*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    case "$entry" in
        "$target/release")
            for asset in "$entry"/* "$entry"/.[!.]* "$entry"/..?*; do
                [ -e "$asset" ] || [ -L "$asset" ] || continue
                case "$asset" in
                    "$entry/codegrinder"|"$entry/grind") ;;
                    *) rm -rf "$asset" ;;
                esac
            done
            ;;
        *) rm -rf "$entry" ;;
    esac
done
