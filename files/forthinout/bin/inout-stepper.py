#!/usr/bin/env python3

import os
import selectors
import subprocess
import sys

delay = 0.01
warmupdelay = 0.1
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

                    # does it match what we expected?
                    if outputData.startswith(chunk):
                        print(chunk.decode('utf-8'), end='')
                        outputData = outputData[len(chunk):]
                    else:
                        print('\n!!INCORRECT OUTPUT!! Your next line of output was:')
                        print(repr(chunk.decode('utf-8')))
                        print('but the next line of output expected was:')
                        newline = outputData.find(b'\n')
                        if newline < 0:
                            print(repr(outputData.decode('utf-8')))
                        else:
                            print(repr(outputData[:newline+1].decode('utf-8')))
                        keepGoing = False
                        error = True
                        break

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
        print(repr(inputData.decode('utf-8')))
    if not error and len(outputData) > 0:
        print('\n!!ERROR!! Program ended but more output was expected. Expected output was:')
        print(repr(outputData.decode('utf-8')))
    if error or len(inputData) > 0 or len(outputData) > 0:
        sys.exit(1)

main()
