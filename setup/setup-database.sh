#!/bin/bash

set -e

echo Deleting old database and user
sudo -u postgres psql -c "drop database if exists $USER;"
sudo -u postgres psql -c "drop user if exists $USER;"

echo Creating database and user
sudo -u postgres psql -c "create user $USER;"
sudo -u postgres psql -c "create database $USER;"
sudo -u postgres psql -c "grant all privileges on database $USER to $USER;"

echo Creating tables
psql < $GOPATH/src/github.com/russross/codegrinder/setup/schema.sql
psql < $GOPATH/src/github.com/russross/codegrinder/setup/problemtypes.sql
