#!/usr/bin/env python3

import os
import sys
import signal
import time

def main():
    if len(sys.argv) < 4:
        print('Usage: {} inputfile outputfile cmd ...'.format(sys.argv[0]), file=sys.stderr)
        sys.exit(1)

    inputfile, outputfile = sys.argv[1], sys.argv[2]
    cmd = sys.argv[3:]

    # create the input feeder
    (stdin, w) = os.pipe()
    inpid = os.fork()
    if inpid == 0:
        os.close(stdin)
        inputFeeder(w, inputfile)
        sys.exit(0)
    os.close(w)

    # create the output watcher
    (r, stdout) = os.pipe()
    outpid = os.fork()
    if outpid == 0:
        os.close(stdout)
        outputWatcher(r, outputfile)
        sys.exit(0)
    os.close(r)

    # create the stderr watcher
    (r, stderr) = os.pipe()
    errpid = os.fork()
    if errpid == 0:
        os.close(stderr)
        stderrWatcher(r)
        sys.exit(0)
    os.close(r)

    # launch the main command
    pid = os.fork()
    if pid == 0:
        os.dup2(stdin, 0)
        os.set_inheritable(0, True)
        os.close(stdin)
        os.dup2(stdout, 1)
        os.set_inheritable(1, True)
        os.close(stdout)
        os.dup2(stderr, 2)
        os.set_inheritable(2, True)
        os.close(stderr)
        os.execvp(cmd[0], cmd)

    # wait for a child to exit, then kill the rest
    (child, status) = os.wait()
    if child != inpid: os.kill(inpid, signal.SIGTERM)
    if child != outpid: os.kill(outpid, signal.SIGTERM)
    if child != errpid: os.kill(errpid, signal.SIGTERM)
    if child != pid: os.kill(pid, signal.SIGTERM)

def inputFeeder(fd, filename):
    fp = open(filename)
    lines = fp.readlines()
    fp.close()

    fp = os.fdopen(fd, 'w')
    for line in lines:
        time.sleep(0.1)
        print(' in: ' + str(line), end='')
        fp.write(line)
        fp.flush()
    fp.close()

def outputWatcher(fd, filename):
    fp = open(filename)
    lines = fp.readlines()
    fp.close()

    fp = os.fdopen(fd, 'r')
    for line in lines:
        input = fp.readline()
        if line == input:
            print('out: ' + str(line), end='')
        else:
            print('out: ' + str(input), end='')
            print('!!INCORRECT OUTPUT!! Expected:')
            print('out: ' + str(line), end='')
            sys.exit(1)
    input = fp.readline()
    if input != '':
        print('<<<: ' + str(input), end='')
        print('>>>: <end of file>')
        sys.exit(1)

def stderrWatcher(fd):
    fp = os.fdopen(fd, 'r')
    for line in fp:
        print('    ERROR:' + str(input), end='')

main()
