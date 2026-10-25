#!/bin/sh
# Replay transcripts with independent stream readers and one input writer.
# Each helper publishes complete records before sending one-byte wakeups.
LC_ALL=C
export LC_ALL
umask 077
work=
workers=
logger=
report_tmp=

fatal() { printf 'Stepper: %s\n' "$*" >&2; exit 2; }
notify() { printf '\n' >&9; }

# Match the established terminal feedback, including visible line endings.
escape=$(printf '\033')
print_color() { printf '%s%s%s\n' "$escape[$1m" "$2" "$escape[0m"; }
print_io() {
    render_bytes < "$2" | print_context "$1" no
}

# Wrappers wait in a builtin so traps can interrupt blocked external commands.
# Every such wrapper owns and reaps its child, including during FIFO opens.
stop_child() {
    trap '' HUP INT TERM
    if [ -n "$child" ]; then
        kill -TERM "$child" 2>/dev/null || :
        kill -KILL "$child" 2>/dev/null || :
        wait "$child" 2>/dev/null || :
    fi
    exit 143
}
stop_program() {
    # Snapshot descendants while their parent still exists. This is best effort:
    # an already orphaned or deliberately detached process is outside this tree.
    trap '' HUP INT TERM
    IFS=' 	
'
    if [ -n "$child" ]; then
        descendants=$(ps -e -o pid= -o ppid= | awk -v root="$child" '
            { parent[$1]=$2 }
            END {
                for (pid in parent) {
                    ancestor=parent[pid]
                    while (ancestor && ancestor != root && ancestor in parent)
                        ancestor=parent[ancestor]
                    if (ancestor == root) print pid
                }
            }')
        for descendant in $descendants; do kill -TERM "$descendant" 2>/dev/null || :; done
        kill -TERM "$child" 2>/dev/null || :
        # Give student cleanup handlers one second before forcing termination.
        sleep 1 & grace=$!
        wait "$grace" || :
        for descendant in $descendants; do kill -KILL "$descendant" 2>/dev/null || :; done
        kill -KILL "$child" 2>/dev/null || :
        wait "$child"; status=$?; child=
        printf '%s\n' "$status" > "$case_dir/exit.tmp"
        mv "$case_dir/exit.tmp" "$case_dir/exit-status"
    fi
    exit 143
}
stop_case() {
    # A trap interrupting IFS= read can inherit that temporary assignment in
    # older shells. PID lists always require the standard field separators.
    IFS=' 	
'
    if [ -n "$workers" ]; then
        for worker in $workers; do kill -TERM "$worker" 2>/dev/null || :; done
        for worker in $workers; do wait "$worker" 2>/dev/null || :; done
        workers=
    fi
    exec 7>&- 8<&-
}
cleanup() {
    trap '' HUP INT TERM
    stop_case
    if [ -n "$logger" ]; then
        kill -TERM "$logger" 2>/dev/null || :
        wait "$logger" 2>/dev/null || :
        logger=
    fi
    if [ -n "$work" ]; then rm -rf "$work"; fi
    if [ -n "$report_tmp" ]; then rm -f "$report_tmp"; fi
}
trap cleanup 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
trap ':' PIPE

# Never reuse an existing temporary directory. mkdir and restrictive permissions
# avoid depending on a particular implementation of mktemp.
attempt=0
while [ "$attempt" -lt 100 ]; do
    candidate=${TMPDIR:-/tmp}/stepper.$$.$attempt
    if mkdir "$candidate" 2>/dev/null; then work=$candidate; break; fi
    attempt=$((attempt + 1))
done
[ -n "$work" ] || fatal 'cannot create temporary directory'
case $work in /*) ;; *) work=$PWD/$work ;; esac

timeout=${STEPPER_TIMEOUT:-5}
directory=${STEPPER_DIR:-inputs}
grade=${STEPPER_GRADE:-false}
transform=${STEPPER_INPUT_TRANSFORM:-'s/\.transcript$/.input/'}
case $timeout in ''|*[!0-9]*) fatal 'STEPPER_TIMEOUT must be a positive integer' ;; esac
[ "$timeout" -gt 0 ] || fatal 'STEPPER_TIMEOUT must be positive'
case $grade in true|false) ;; *) fatal 'STEPPER_GRADE must be true or false' ;; esac
if [ "$grade" = true ]; then rm -f test_detail.xml || fatal 'cannot remove old report'; fi
[ -d "$directory" ] || fatal "not a directory: $directory"
if [ "${1:-}" = -- ]; then shift; fi
[ "$#" -gt 0 ] || fatal 'usage: sh lib/stepper -- command [argument ...]'

# Input records end output phases. Expected stream records have global sequence
# numbers; phases hold their ending sequence numbers and cumulative byte counts.
compile() {
    mkdir "$case_dir/out" "$case_dir/err" "$case_dir/expected-out" \
        "$case_dir/expected-err" "$case_dir/input" || return 1
    : > "$case_dir/expected-out.raw"
    : > "$case_dir/expected-err.raw"
    : > "$case_dir/phases"
    lines=$(wc -l < "$transcript") || return 1
    tr -d '\000' < "$transcript" > "$case_dir/text" || return 1
    cmp -s "$transcript" "$case_dir/text" || {
        printf 'Transcript contains NUL bytes\n'; return 1;
    }
    awk -v root="$case_dir" -v lines="$lines" '
        function save(path, text) { print text > path; close(path) }
        function phase(input) {
            print out+0, err+0, outbytes+0, errbytes+0, input, NR > (root "/phases")
        }
        substr($0, 1, 2) !~ /^(< |> |! )$/ {
            print "Invalid transcript record on line " NR; bad=1; exit
        }
        {
            text=substr($0, 3); action=substr($0, 1, 1)
            if (action == "<") {
                save(root "/input/" ++inputs, text)
                save(root "/input/" inputs ".source", NR)
                phase(inputs)
            }
            if (action == ">") {
                save(root "/expected-out/" ++out, text)
                save(root "/expected-out/" out ".source", NR)
                print text > (root "/expected-out.raw"); outbytes+=length(text)+1
            }
            if (action == "!") {
                save(root "/expected-err/" ++err, text)
                save(root "/expected-err/" err ".source", NR)
                print text > (root "/expected-err.raw"); errbytes+=length(text)+1
            }
        }
        END {
            if (bad) exit 1
            if (NR != lines) { print "Transcript must end with a newline"; exit 1 }
            phase(0); print inputs+0 > (root "/input-count")
        }
    ' "$transcript"
}

# Raw tee captures preserve bytes that shell variables cannot represent. Each
# reader additionally publishes complete lines, or an unterminated final tail.
collect_stream() {
    trap 'exit 143' HUP INT TERM
    exec 8<&- 7>&- 9>"$case_dir/wake"
    stream=$1; sequence=0
    while :; do
        line=
        if IFS= read -r line; then ending=yes; else ending=no; fi
        if [ "$ending" = no ] && [ -z "$line" ]; then break; fi
        sequence=$((sequence + 1))
        if [ "$ending" = yes ]; then
            printf '%s\n' "$line" > "$case_dir/$stream/pending"
        else
            printf '%s' "$line" > "$case_dir/$stream/pending"
        fi
        mv "$case_dir/$stream/pending" "$case_dir/$stream/$sequence" || exit 2
        notify
        [ "$ending" = yes ] || break
    done
    printf '%s\n' "$sequence" > "$case_dir/$stream/eof"
    notify
}
capture_stream() {
    child=
    trap stop_child HUP INT TERM
    exec 8<&- 7>&- 9>"$case_dir/wake"
    stream=$1
    tee "$case_dir/$stream.raw" < "$case_dir/$stream.fifo" \
        > "$case_dir/$stream.lines" &
    child=$!
    wait "$child"; status=$?; child=
    printf '%s\n' "$status" > "$case_dir/$stream/capture.tmp"
    mv "$case_dir/$stream/capture.tmp" "$case_dir/$stream/capture"
    notify
}

# Only this helper owns the write end of student stdin. A blocked write cannot
# block the manager, and the final acknowledgment follows descriptor closure.
write_inputs() {
    child=
    trap 'trap - 0; stop_child' HUP INT TERM
    trap 'exit 1' PIPE
    exec 8<&- 7>&- 9>"$case_dir/wake"
    trap 'status=$?; printf "%s\n" "$status" > "$case_dir/writer.tmp";
        mv "$case_dir/writer.tmp" "$case_dir/writer-status"; notify' 0
    exec 6<"$case_dir/control"
    exec 3>"$case_dir/in.fifo"
    count=$(cat "$case_dir/input-count"); number=0
    while [ "$number" -lt "$count" ]; do
        IFS= read -r order <&6 || exit 1
        number=$((number + 1))
        # Keep failed pipe writes outside this shell's stdio buffers. Bash 3.2
        # can otherwise flush undelivered input into a later status-file write.
        cat "$case_dir/input/$number" >&3 & child=$!
        wait "$child"; status=$?; child=
        [ "$status" -eq 0 ] || exit 1
        if [ "$number" -eq "$count" ]; then exec 3>&-; fi
        printf '%s\n' "$number" > "$case_dir/input.tmp"
        mv "$case_dir/input.tmp" "$case_dir/input-status" || exit 2
        notify
    done
    exec 3>&-
    : > "$case_dir/input-closed"
    notify
}
supervise() {
    child=
    trap stop_program HUP INT TERM
    exec 8<&- 7>&- 9>"$case_dir/wake"
    "$@" < "$case_dir/in.fifo" > "$case_dir/out.fifo" 2> "$case_dir/err.fifo" &
    child=$!
    wait "$child"; status=$?; child=
    printf '%s\n' "$status" > "$case_dir/exit.tmp"
    mv "$case_dir/exit.tmp" "$case_dir/exit-status"
    notify
}

# Data wakes the manager immediately; integer ticks only measure deadlines.
clock_worker() {
    child=
    trap stop_child HUP INT TERM
    exec 9>"$case_dir/wake"
    tick=0
    while :; do
        sleep 1 & child=$!
        wait "$child" || exit 1
        child=
        tick=$((tick + 1))
        printf '%s\n' "$tick" > "$case_dir/clock.tmp"
        mv "$case_dir/clock.tmp" "$case_dir/clock" || exit 2
        notify
    done
}
read_phase() {
    IFS=' ' read -r out_end err_end out_bytes err_bytes input_number source_line <&4
}

# Bounded batches leave time for the other stream and deadline checks. Byte
# offsets keep failure context positioned after the successfully matched output.
match_stream() {
    stream=$1; next=$2; end=$3; matched=$4; batch=0
    while [ "$next" -le "$end" ] && [ -f "$case_dir/$stream/$next" ]; do
        # Shell readers can discard NUL bytes. Verify the original captured bytes
        # before accepting a record or moving the failure-context offset.
        size=$(wc -c < "$case_dir/expected-$stream/$next")
        dd if="$case_dir/$stream.raw" bs=1 skip="$matched" count="$size" \
            2>/dev/null > "$case_dir/match.raw"
        if ! cmp -s "$case_dir/expected-$stream/$next" "$case_dir/$stream/$next" ||
            ! cmp -s "$case_dir/expected-$stream/$next" "$case_dir/match.raw"; then
            failure_kind=incorrect; failure_stream=$stream
            source_line=$(cat "$case_dir/expected-$stream/$next.source")
            if [ "$stream" = out ]; then stream_name=stdout; else stream_name=stderr; fi
            reason="Output mismatch on $stream_name."; return 1
        fi
        matched=$((matched + size)); next=$((next + 1)); batch=$((batch + 1))
        progress=$now
        [ "$batch" -lt 64 ] || break
    done
    if [ "$next" -le "$end" ] && [ -f "$case_dir/$stream/eof" ] &&
        [ ! -f "$case_dir/$stream/$next" ]; then
        failure_kind=missing; failure_stream=$stream
        source_line=$(cat "$case_dir/expected-$stream/$next.source")
        if [ "$stream" = out ]; then stream_name=stdout; else stream_name=stderr; fi
        reason="Program closed $stream_name before producing expected output."; return 1
    fi
}

# Matching tolerates stream interleaving; display follows transcript order.
# Keep one unread action until its stream record or input acknowledgment exists.
display_progress() {
    while :; do
        if [ -z "$display_action" ]; then
            IFS= read -r display_record <&5 || return 0
            display_action=${display_record%% *}
        fi
        case $display_action in
            '>')
                [ "$display_out" -lt "$out_next" ] || return 0
                print_io out "$case_dir/expected-out/$display_out"
                display_out=$((display_out + 1)) ;;
            '!')
                [ "$display_err" -lt "$err_next" ] || return 0
                print_io err "$case_dir/expected-err/$display_err"
                display_err=$((display_err + 1)) ;;
            '<')
                [ "$display_input" -le "$sent_inputs" ] || return 0
                print_io in "$case_dir/input/$display_input"
                display_input=$((display_input + 1)) ;;
        esac
        display_action=
    done
}
run_manager() {
    exec 4<"$case_dir/phases"
    exec 5<"$transcript"
    read_phase || return 1
    out_next=1; err_next=1; out_matched=0; err_matched=0
    pending=0; now=0; progress=0
    while :; do
        now=$(cat "$case_dir/clock")
        if [ "$pending" -ne 0 ] && [ -f "$case_dir/input-status" ]; then
            ack=$(cat "$case_dir/input-status")
            if [ "$ack" -eq "$pending" ]; then pending=0; progress=$now; fi
        fi
        if match_stream out "$out_next" "$out_end" "$out_matched"; then matched_ok=yes; else matched_ok=no; fi
        out_next=$next; out_matched=$matched
        display_progress
        [ "$matched_ok" = yes ] || return 1
        if match_stream err "$err_next" "$err_end" "$err_matched"; then matched_ok=yes; else matched_ok=no; fi
        err_next=$next; err_matched=$matched
        display_progress
        [ "$matched_ok" = yes ] || return 1
        if [ -f "$case_dir/writer-status" ]; then
            status=$(cat "$case_dir/writer-status")
            [ "$status" -eq 0 ] || {
                if [ "$pending" -ne 0 ]; then source_line=$(cat "$case_dir/input/$pending.source"); fi
                reason='Program closed its input stream prematurely.'; return 1;
            }
        fi

        # Raw sizes expose partial and binary output beyond the permitted phase.
        for stream in out err; do
            if [ "$stream" = out ]; then limit=$out_bytes; stream_name=stdout
            else limit=$err_bytes; stream_name=stderr; fi
            bytes=$(wc -c < "$case_dir/$stream.raw")
            if [ "$bytes" -gt "$limit" ]; then
                if { [ "$stream" = out ] && [ "$out_next" -le "$out_end" ]; } ||
                    { [ "$stream" = err ] && [ "$err_next" -le "$err_end" ]; }; then
                    failure_kind=incorrect; failure_stream=$stream
                    reason="Output mismatch on $stream_name."
                elif [ "$input_number" -eq 0 ]; then
                    failure_kind=extra; failure_stream=$stream
                    reason='Program produced unexpected extra output after completion.'
                    source_line=$(( $(wc -l < "$transcript") + 1 ))
                else
                    failure_kind=early; failure_stream=$stream
                    reason="Program produced output on $stream_name before expected input."
                fi
                return 1
            fi
            if [ -f "$case_dir/$stream/capture" ]; then
                status=$(cat "$case_dir/$stream/capture")
                [ "$status" -eq 0 ] || { reason="Capture failed on $stream"; return 1; }
            fi
        done
        if [ "$out_next" -gt "$out_end" ] && [ "$err_next" -gt "$err_end" ] &&
            [ "$pending" -eq 0 ]; then
            if [ "$input_number" -ne 0 ]; then
                if [ -f "$case_dir/exit-status" ]; then
                    reason='Program exited before all input was sent'; return 1
                fi
                pending=$input_number
                sent_inputs=$input_number
                display_progress
                # Permit the response before waking the writer that triggers it.
                read_phase || { reason='Invalid phase data'; return 1; }
                printf '\n' >&7 || { reason='Input writer closed prematurely'; return 1; }
                continue
            fi
            if [ -f "$case_dir/out/eof" ] && [ -f "$case_dir/err/eof" ] &&
                [ -f "$case_dir/out/capture" ] && [ -f "$case_dir/err/capture" ] &&
                [ -f "$case_dir/exit-status" ] && [ -f "$case_dir/input-closed" ]; then
                status=$(cat "$case_dir/exit-status")
                for stream in out err; do
                    cmp -s "$case_dir/expected-$stream.raw" "$case_dir/$stream.raw" || {
                        failure_kind=extra; failure_stream=$stream
                        source_line=$(( $(wc -l < "$transcript") + 1 ))
                        reason='Program produced unexpected extra output after completion.'; return 1;
                    }
                done
                [ "$status" -eq 0 ] || {
                    source_line=$(( $(wc -l < "$transcript") + 1 ))
                    reason="Program exited with non-zero status code: $status"; return 1;
                }
                return 0
            fi
        fi
        if [ $((now - progress)) -ge "$timeout" ]; then
            if [ "$out_next" -le "$out_end" ]; then reason='timed out waiting for stdout'
            elif [ "$err_next" -le "$err_end" ]; then reason='timed out waiting for stderr'
            elif [ "$pending" -ne 0 ]; then reason='timed out waiting for input delivery'
            else reason='timed out waiting for program termination'; fi
            if [ "$out_next" -le "$out_end" ]; then
                source_line=$(cat "$case_dir/expected-out/$out_next.source")
            elif [ "$err_next" -le "$err_end" ]; then
                source_line=$(cat "$case_dir/expected-err/$err_next.source")
            fi
            return 1
        fi
        IFS= read -r wake <&8 || { reason='Notification channel closed'; return 1; }
    done
}

# Render control bytes without letting student output change terminal formatting.
# UTF-8 bytes remain intact; incomplete final lines have no newline marker.
render_bytes() {
    od -An -v -tu1 | awk '
        {
            text=""
            for (i=1; i<=NF; i++) {
                byte=$i+0
                if (byte == 10) { text=text "\\n\n"; tail=0; continue }
                if (byte == 9) text=text "\\t"
                else if (byte == 13) text=text "\\r"
                else if (byte < 32 || byte == 127) text=text sprintf("\\%03o", byte)
                else text=text sprintf("%c", byte)
                tail=1
            }
            printf "%s", text
        }
        END { if (tail) print " [no newline]" }
    '
}

# A context block belongs to one stream and is bounded by bytes and lines.
# The ending sentinel distinguishes a real newline from an unfinished fragment.
print_context() {
    context_stream=$1; inverse=$2
    case $context_stream in
        out) context_color= ;;
        err) context_color=$escape'[35m' ;;
        in) context_color=$escape'[36m' ;;
    esac
    awk -v escape="$escape" -v color="$context_color" -v inverse="$inverse" '
        {
            printf "%s", color
            if (inverse == "yes") printf "%s[7m", escape
            if (substr($0, length($0)-1) == "\\n")
                printf "%s%s[2m⏎", substr($0, 1, length($0)-2), escape
            else printf "%s%s[2m [no newline]", substr($0, 1, length($0)-13), escape
            printf "%s[0m\n", escape
        }
    '
}
report_failure() {
    if [ -n "$failure_stream" ]; then
        stream=$failure_stream
        if [ "$stream" = out ]; then
            stream_name=stdout; offset=$out_matched; first=$out_next; last=$out_end
        else
            stream_name=stderr; offset=$err_matched; first=$err_next; last=$err_end
        fi
        # Collect only the failing stream after its successfully matched bytes.
        dd if="$case_dir/$stream.raw" bs=1 skip="$offset" count=20001 2>/dev/null > "$case_dir/context.raw"
        context_bytes=$(wc -c < "$case_dir/context.raw")
        head -c 20000 "$case_dir/context.raw" | render_bytes > "$case_dir/context.lines"
        head -n 5 "$case_dir/context.lines" | print_context "$stream" yes
        context_lines=$(wc -l < "$case_dir/context.lines")
        if [ "$context_bytes" -gt 20000 ] || [ "$context_lines" -gt 5 ]; then
            print_color 2 '[output truncated]'
        fi
        case $failure_kind in
            incorrect) transition="$stream_name is incorrect—the highlighted lines should have been:" ;;
            extra) transition="unexpected $stream_name—the highlighted lines were unexpected" ;;
            early) transition="unexpected $stream_name—input was expected before the highlighted lines" ;;
            missing) transition="$stream_name ended early—the following lines were missing:" ;;
        esac
        print_color '1;31' "!!!!! $transition"
        # Phase boundaries prevent expected context from crossing unsent input.
        if [ "$failure_kind" = incorrect ] || [ "$failure_kind" = missing ]; then
            : > "$case_dir/expected-context.raw"
            shown=0
            while [ "$first" -le "$last" ] && [ "$shown" -lt 5 ]; do
                cat "$case_dir/expected-$stream/$first" >> "$case_dir/expected-context.raw"
                first=$((first + 1)); shown=$((shown + 1))
            done
            head -c 20000 "$case_dir/expected-context.raw" | render_bytes | print_context "$stream" no
            expected_bytes=$(wc -c < "$case_dir/expected-context.raw")
            if [ "$first" -le "$last" ] || [ "$expected_bytes" -gt 20000 ]; then
                print_color 2 '[expected output truncated]'
            fi
        fi
        reason="incorrect $stream_name"
    else
        case $reason in
            'Program closed its input stream prematurely.'|'Program exited before all input was sent')
                reason='stdin closed before all input was sent' ;;
            'Program exited with non-zero status code: '*) reason= ;;
        esac
    fi
    # Cleanup can terminate a student process; only its earlier status counts.
    if [ -n "$observed_status" ] && [ "$observed_status" -ne 0 ]; then
        reason="${reason:+$reason/}incorrect exit status: $observed_status"
    fi
    print_color '1;31' "!!!!! test failed: $reason"
}

# Rotate arguments recursively to substitute embedded placeholders without eval
# or reparsing quoting. Each original argument remains exactly one argument.
replace_arguments() {
    remaining=$1; shift
    if [ "$remaining" -eq 0 ]; then
        if [ "$argument_mode" = display ]; then
            printf '$'
            for argument do
                printf ' %s' "$argument"
            done
            printf '\n'
        else supervise "$@"; fi
        return
    fi
    arg=$1; shift; replaced=
    while :; do
        case $arg in
            *@INPUT@*) replaced=$replaced${arg%%@INPUT@*}$input_path; arg=${arg#*@INPUT@} ;;
            *) break ;;
        esac
    done
    replace_arguments "$((remaining - 1))" "$@" "$replaced$arg"
}
run_case() {
    reason=; failure_kind=; failure_stream=; observed_status=
    source_line=1; out_matched=0; err_matched=0; case_time=0
    out_next=1; err_next=1; sent_inputs=0
    display_action=; display_out=1; display_err=1; display_input=1
    if ! compile > "$case_dir/compile.log"; then
        reason=$(cat "$case_dir/compile.log")
        print_color '1;31' "!!!!! test failed: $reason"
        return 1
    fi
    input_path=$(printf '%s\n' "$transcript" | sed "$transform") || {
        print_color '1;31' '!!!!! test failed: invalid input transform'; return 1;
    }
    argument_mode=display
    replace_arguments "$#" "$@" > "$case_dir/command.log"
    cat "$case_dir/command.log"
    argument_mode=run
    mkfifo "$case_dir/in.fifo" "$case_dir/out.fifo" "$case_dir/err.fifo" \
        "$case_dir/out.lines" "$case_dir/err.lines" "$case_dir/wake" "$case_dir/control" || {
        print_color '1;31' '!!!!! test failed: cannot create stream channels'; return 1;
    }
    : > "$case_dir/out.raw"; : > "$case_dir/err.raw"
    printf '0\n' > "$case_dir/clock"
    clock_worker & workers=$!
    exec 8<"$case_dir/wake"
    collect_stream out < "$case_dir/out.lines" & workers="$workers $!"
    collect_stream err < "$case_dir/err.lines" & workers="$workers $!"
    capture_stream out & workers="$workers $!"
    capture_stream err & workers="$workers $!"
    write_inputs & workers="$workers $!"
    replace_arguments "$#" "$@" & workers="$workers $!"
    exec 7>"$case_dir/control"
    if run_manager; then result=0; else result=1; fi
    if [ -f "$case_dir/exit-status" ]; then observed_status=$(cat "$case_dir/exit-status"); fi
    stop_case
    case_time=$(cat "$case_dir/clock")
    exec 4<&- 5<&-
    if [ "$result" -eq 0 ]; then print_color 32 '✔'
    else
        report_failure > "$case_dir/failure.log"
        cat "$case_dir/failure.log"
    fi
    return "$result"
}
xml_escape() {
    sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' \
        -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"
}

# Forward the serialized case feedback while retaining its grading log. The
# wrapper owns tee so interruption also reaps a child blocked opening the FIFO.
forward_log() {
    child=
    trap stop_child HUP INT TERM
    tee "$case_dir/log" < "$case_dir/log.fifo" &
    child=$!
    wait "$child"; status=$?; child=
    return "$status"
}

# XML contains readable logs rather than quoted representations of whole logs.
# Escape control bytes after stripping our ANSI formatting; preserve UTF-8.
plain_log() {
    sed "s/$escape\[[0-9;]*m//g" | od -An -v -tu1 | awk '
        { for (i=1; i<=NF; i++) {
            byte=$i+0
            if (byte == 9 || byte == 10 || (byte >= 32 && byte != 127))
                printf "%c", byte
            else printf "\\%03o", byte
        } }
    '
}

# Feedback mode stops at the first failure; grade mode records every attempt.
# FIFO forwarding keeps case state and child ownership in the managing shell.
tests=0; failures=0; total=0; total_time=0
for transcript in "$directory"/*.transcript; do
    [ -f "$transcript" ] || continue
    total=$((total + 1))
done
: > "$work/cases.xml"
for transcript in "$directory"/*.transcript; do
    [ -f "$transcript" ] || continue
    tests=$((tests + 1)); case_dir=$work/case.$tests
    mkdir "$case_dir" || fatal 'cannot create test directory'
    mkfifo "$case_dir/log.fifo" || fatal 'cannot create log FIFO'
    forward_log & logger=$!
    if run_case "$@" > "$case_dir/log.fifo"; then passed=true; else passed=false; failures=$((failures + 1)); fi
    # Drain the final feedback before another case or summary can write output.
    wait "$logger"; log_status=$?; logger=
    printf '\n'
    [ "$log_status" -eq 0 ] || fatal 'cannot forward case log'
    total_time=$((total_time + case_time))
    if [ "$grade" = true ]; then
        name=${transcript##*/}
        printf '<testcase name="' >> "$work/cases.xml"
        printf '%s' "$name" | xml_escape >> "$work/cases.xml"
        printf '" time="%s"' "$case_time" >> "$work/cases.xml"
        if [ "$passed" = false ]; then printf ' status="failed"' >> "$work/cases.xml"; fi
        printf '>' >> "$work/cases.xml"
        if [ "$passed" = false ]; then
            printf '<failure type="failure">' >> "$work/cases.xml"
            if [ -f "$case_dir/failure.log" ]; then
                cat "$case_dir/command.log" "$case_dir/failure.log" | plain_log | xml_escape >> "$work/cases.xml"
            else
                plain_log < "$case_dir/log" | xml_escape >> "$work/cases.xml"
            fi
            printf '</failure>' >> "$work/cases.xml"
        fi
        printf '</testcase>\n' >> "$work/cases.xml"
    elif [ "$passed" = false ]; then
        break
    fi
done
if [ "$failures" -eq 0 ]; then summary_color='1;92'; else summary_color='1;91'; fi
print_color "$summary_color" "Passed $((tests - failures))/$tests tests in $total_time seconds ($total total)"
if [ "$grade" = true ]; then
    report_tmp=test_detail.xml.tmp.$$
    {
        printf '<?xml version="1.0" encoding="UTF-8"?>\n'
        printf '<testsuites tests="%s" failures="%s" time="%s" errors="0" skipped="0" disabled="0">\n' \
            "$tests" "$failures" "$total_time"
        printf '<testsuite tests="%s" failures="%s" time="%s" errors="0" skipped="0" disabled="0">\n' \
            "$tests" "$failures" "$total_time"
        cat "$work/cases.xml"
        printf '</testsuite></testsuites>\n'
    } > "$report_tmp" || fatal 'cannot write test_detail.xml'
    mv "$report_tmp" test_detail.xml || fatal 'cannot publish test_detail.xml'
    report_tmp=
fi
[ "$total" -ne 0 ] || printf 'Warning: no transcript files found\n' >&2
[ "$failures" -eq 0 ]
