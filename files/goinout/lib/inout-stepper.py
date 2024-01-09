#!/usr/bin/env python3

import os
import selectors
import subprocess
import sys

delay = 0.01
warmupdelay = 1.0
postcrashlines = 15
wronglines = 10
bufsize = 2**16

def main():
    if len(sys.argv) < 4:
        print('Usage: {} inputfile outputfile cmd ...'.format(sys.argv[0]), file=sys.stderr)
        sys.exit(1)

    inputfile, outputfile = sys.argv[1], sys.argv[2]
    cmd = sys.argv[3:]

    # read all of the input
    with open(inputfile, 'rb') as fp:
        inputData = fp.read()

    # read all of the expected output
    with open(outputfile, 'rb') as fp:
        outputData = fp.read()

    # launch the process
    proc = subprocess.Popen(cmd, bufsize=0, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stdin = proc.stdin.fileno()
    stdout = proc.stdout.fileno()
    stderr = proc.stderr.fileno()

    # start monitoring the output channels
    sel = selectors.DefaultSelector()
    sel.register(stdout, selectors.EVENT_READ, 'out')
    sel.register(stderr, selectors.EVENT_READ, 'err')

    # the next chunk of input to feed to the process
    # this gets filled when we have a timeout while waiting for output
    nextInput = ''
    partial = b''
    inputClosed = False

    keepGoing = True
    warmup = True
    error = False

    wrong = []

    while keepGoing:
        # wait for some output, and if we have input ready
        # check if we can send it
        if len(nextInput) > 0:
            sel.register(stdin, selectors.EVENT_WRITE, 'in')
        events = sel.select(timeout=(warmupdelay if warmup else delay))
        if len(nextInput) > 0:
            sel.unregister(stdin)
        warmup = False

        # timeout? prepare some input to feed to the process
        if len(events) == 0 and len(nextInput) == 0:
            # if we timeout after bad output, do not feed input or wait any longer
            if len(wrong) > 0:
                keepGoing = False
                break

            if len(inputData) > 0:
                # grab one line, or everything if there are no newlines
                newline = inputData.find(b'\n')
                if newline == -1:
                    nextInput = inputData
                else:
                    nextInput = inputData[:newline+1]
            elif not inputClosed:
                os.close(stdin)
                inputClosed = True

        # handle each of the input/output channels that are ready
        for (key, mask) in events:
            if key.data == 'out':
                # there is stdout output ready
                data = os.read(stdout, bufsize)
                if len(data) == 0 and len(partial) > 0:
                    print('\n!!ERROR!! Program output ended without a newline:')
                    for line in wrong:
                        print(repr(line.decode('utf-8')))
                    print(repr(partial.decode('utf-8')))
                    sys.exit(1)
                elif len(data) == 0:
                    keepGoing = False
                    break
                data = partial + data
                partial = b''

                # compare it to the expected output one line at a time
                while len(data) > 0:
                    newline = data.find(b'\n')
                    if newline < 0:
                        # save this partial line until more input is available
                        partial = data
                        break

                    chunk = data[:newline+1]
                    data = data[len(chunk):]

                    # is this line incorrect or does it follow an incorrect line?
                    if len(wrong) > 0 or not outputData.startswith(chunk):
                        wrong.append(chunk)

                        # stop after a while
                        if len(wrong) >= wronglines+5:
                            keepGoing = False
                            break

                    # does it match what we expected?
                    else:
                        print(chunk.decode('utf-8'), end='')
                        outputData = outputData[len(chunk):]

            if key.data == 'err':
                # there is stderr output ready
                data = os.read(stderr, bufsize)
                if len(data) == 0:
                    keepGoing = False
                    break
                print('\n!!ERROR OUTPUT!!')
                print(data.decode('utf-8'), end='')
                keepGoing = False
                error = True

            if key.data == 'in':
                # the stdin pipe is ready to receive data
                count = os.write(stdin, nextInput)
                if count == 0:
                    keepGoing = False
                    break
                print(nextInput[:count].decode('utf-8'), end='')

                inputData = inputData[count:]
                nextInput = ''

    if len(wrong) > 0:
        # report incorrect output
        if len(wrong) == 1:
            print('\n!!INCORRECT OUTPUT!! Your next line of output was:')
        else:
            if len(wrong) >= wronglines+5:
                wrong = wrong[:wronglines]
            print(f'\n!!INCORRECT OUTPUT!! Your next {len(wrong)} lines of output were:')
        for line in wrong:
            print(repr(line.decode('utf-8')))

        # gather the same number of correct output lines if possible
        correct = []
        for i in range(len(wrong)):
            newline = outputData.find(b'\n')
            if newline < 0:
                correct.append(outputData)
                break
            else:
                correct.append(outputData[:newline+1])
                outputData = outputData[newline+1:]

        # report expected output
        if len(correct) == 1:
            print('\nbut the next line of output expected was:')
        else:
            print(f'\nbut the next {len(correct)} lines of output expected were:')
        for line in correct:
            print(repr(line.decode('utf-8')))
        error = True

    # wait for the child process to end
    proc.kill()
    proc.wait()
    os.close(stdout)
    os.close(stderr)
    if not inputClosed:
        os.close(stdin)

    # report an error if we noticed error output, wrong regular output, or
    # any input/output leftover that should have been consumed
    if not error and len(inputData) > 0:
        print('\n!!ERROR!! Program ended without reading all input. Unused input was:')
        lines = inputData.decode('utf-8').split('\n')[:-1]
        if len(lines) < postcrashlines+5:
            for line in lines:
                print(repr(line + '\n'))
        else:
            for line in lines[:postcrashlines]:
                print(repr(line + '\n'))
            print(f'... (skipped {len(lines)-postcrashlines} additional lines of unread input)')
    if not error and len(outputData) > 0:
        print('\n!!ERROR!! Program ended but more output was expected. Expected output was:')
        lines = outputData.decode('utf-8').split('\n')[:-1]
        if len(lines) < postcrashlines+5:
            for line in lines:
                print(repr(line + '\n'))
        else:
            for line in lines[:postcrashlines]:
                print(repr(line + '\n'))
            print(f'... (skipped {len(lines)-postcrashlines} additional lines of expected output)')
    if error or len(inputData) > 0 or len(outputData) > 0:
        sys.exit(1)

main()
