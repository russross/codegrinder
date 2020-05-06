#!/bin/bash

set -e

CGPATH=`go env GOPATH`/src/github.com/russross/codegrinder
DBFILE="$CGPATH/db/codegrinder.db"

if [ ! -f "$HOME/.sqliterc" ]; then
    cp "$CGPATH/setup/sqliterc" "$HOME/.sqliterc"
fi

echo Creating directory if needed
mkdir -p "$CGPATH/db"

echo Deleting old database if it exists
rm -f "$DBFILE"

echo Creating database tables
sqlite3 "$DBFILE" < "$CGPATH/setup/schema.sql"

echo Creating problem types
sqlite3 "$DBFILE" < "$CGPATH/setup/problemtypes.sql"
