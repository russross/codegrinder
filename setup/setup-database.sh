#!/bin/bash

set -e

CGPATH=$GOPATH/src/github.com/russross/codegrinder
DBFILE=$CGPATH/db/codegrinder.db

if [ ! -f "$HOME/.sqliterc" ]; then
    echo WARNING! You should set up ~/.sqliterc before running this command
    echo Use: cp $CGPATH/setup/sqliterc ~/.sqliterc
    echo continuing anyway... you should set up .sqliterc and then re-run this command
fi

echo Creating directory if needed
mkdir -p $CGPATH/db

echo Deleting old database if it exists
rm -f $DBFILE

echo Creating database tables
sqlite3 $DBFILE < $CGPATH/setup/schema.sql

echo Creating problem types
sqlite3 $DBFILE < $CGPATH/setup/problemtypes.sql
