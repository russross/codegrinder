#!/bin/sh
# Adapt the reference suite's shell/script invocation to the compiled executable.
set -eu
shift
exec "${STEPPER_RUNNER:?set STEPPER_RUNNER to the executable path}" "$@"
