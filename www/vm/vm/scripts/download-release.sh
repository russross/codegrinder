#!/bin/sh
set -eu
if [ "$#" -ne 3 ]; then
    echo "usage: $0 riscbox|risclet VERSION DESTINATION" >&2
    exit 2
fi
project=$1
version=$2
destination=$3
case "$project" in
    riscbox) asset="riscbox-$version.tar.gz" ;;
    risclet) asset=risclet-riscv64gc-unknown-linux-musl ;;
    *) echo "unknown release project: $project" >&2; exit 2 ;;
esac
metadata=$(mktemp)
trap 'rm -f "$metadata"' EXIT HUP INT TERM

# Release metadata supplies the upload digest for the requested immutable version.
set -- --header 'Accept: application/vnd.github+json'
if [ -n "${GH_TOKEN:-}" ]; then set -- "$@" --header "Authorization: Bearer $GH_TOKEN"; fi
curl --fail --location --show-error --retry 3 --connect-timeout 20 --max-time 60 \
    "$@" --output "$metadata" "https://api.github.com/repos/russross/$project/releases/tags/v$version"
url=$(jq -er --arg name "$asset" 'select(.draft == false) | .assets[] | select(.name == $name) | .browser_download_url' "$metadata")
digest=$(jq -er --arg name "$asset" 'select(.draft == false) | .assets[] | select(.name == $name) | .digest | select(test("^sha256:[a-f0-9]{64}$")) | ltrimstr("sha256:")' "$metadata")
"$(dirname "$0")/fetch.sh" "$url" "$digest" "$destination"
echo "Downloaded and verified $project v$version"
