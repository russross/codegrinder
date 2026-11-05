#!/bin/sh
set -eu
if [ "$#" -ne 3 ]; then
    echo "usage: $0 URL SHA256 DESTINATION" >&2
    exit 2
fi
url=$1
digest=$2
destination=$3
mkdir -p "$(dirname "$destination")"
trap 'rm -f "$destination.part"' EXIT HUP INT TERM

# Only verified, complete bytes enter the download cache.
curl --fail --location --show-error --retry 3 --connect-timeout 20 --max-time 300 \
    --output "$destination.part" "$url"
printf '%s  %s\n' "$digest" "$destination.part" | sha256sum -cs || {
    echo "download checksum failed: $destination" >&2
    exit 1
}
mv "$destination.part" "$destination"
