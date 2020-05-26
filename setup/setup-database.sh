#!/bin/bash

set -e

if [ -z "$CODEGRINDERROOT"]; then
    CODEGRINDERROOT="$HOME"/codegrinder
fi

DBFILE="$CODEGRINDERROOT"/db/codegrinder.db

if [ ! -f "$HOME"/.sqliterc ]; then
    cp "$CODEGRINDERROOT"/setup/sqliterc "$HOME"/.sqliterc
fi

echo Creating directory if needed
mkdir -p "$CODEGRINDERROOT"/db

echo Deleting old database if it exists
rm -f "$DBFILE"

echo Creating database tables
sqlite3 "$DBFILE" < "$CODEGRINDERROOT"/setup/schema.sql

echo Creating problem types
sqlite3 "$DBFILE" < "$CODEGRINDERROOT"/setup/problemtypes.sql
