#!/usr/bin/env python3

import glob
import os.path
import subprocess
import sys

cmd = ['sqlite3', 'database.db']

# get the list of input files to process
infiles = sorted(glob.glob('*.sql'))

first = True
for infile in infiles:
    if not first:
        print()
    first = False

    outfile = os.path.join('outputs', infile[:-len('.sql')] + '.expected')

    c = ['python3', 'lib/inout-stepper.py', infile, outfile]
    c.extend(cmd)

    # run the program to get the actual output
    print(' '.join(c))
    status = subprocess.call(c)
    if status != 0:
        sys.exit(status)
