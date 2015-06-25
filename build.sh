#!/bin/bash

set -e

gb build
sudo setcap cap_net_bind_service=+ep /home/russ/codegrinder/bin/codegrinder
