# LeakSanitizer's tracing process cannot complete in the browser VM.
# AddressSanitizer and UndefinedBehaviorSanitizer remain enabled by the build.
ASAN_OPTIONS=detect_leaks=0
export ASAN_OPTIONS
