#!/usr/bin/env python3

import glob
import subprocess
import sys

cmd = sys.argv[1:]

# get the list of input files to process
infiles = sorted(glob.glob('inputs/*.input'))

first = True
for infile in infiles:
    if not first:
        print()
    first = False

    outfile = infile[:-len('.input')] + '.output'

    c = ['python3', 'bin/inout-stepper.py', infile, outfile]
    c.extend(cmd)

    # run the program to get the actual output
    print(' '.join(c))
    status = subprocess.call(c)
    if status != 0:
        sys.exit(status)
