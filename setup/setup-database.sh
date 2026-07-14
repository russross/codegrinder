#!/bin/sh

set -e

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DBFILE="$ROOT/db/codegrinder.db"
FORCE=false

while [ "$#" -gt 0 ]; do
    case "$1" in
        --database)
            if [ "$#" -lt 2 ]; then
                echo "--database requires a path" >&2
                exit 2
            fi
            DBFILE=$2
            shift 2
            ;;
        --force)
            FORCE=true
            shift
            ;;
        *)
            echo "usage: $0 --force [--database PATH]" >&2
            exit 2
            ;;
    esac
done

if [ "$FORCE" != true ]; then
    echo "refusing to replace a database without --force" >&2
    echo "usage: $0 --force [--database PATH]" >&2
    exit 2
fi

echo "Creating $(dirname -- "$DBFILE") if needed"
mkdir -p "$(dirname -- "$DBFILE")"

echo "Replacing $DBFILE"
rm -f "$DBFILE"

echo Creating database tables
sqlite3 "$DBFILE" < "$ROOT/setup/schema.sql"
