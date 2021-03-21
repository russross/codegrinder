#!/usr/bin/env python3

import glob
import io
import os
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

suffix = sys.argv[1]
cmd = sys.argv[2:]

# get the list of input files to process
infiles = sorted(glob.glob('inputs/*.' + suffix))

testsuites = ET.Element('testsuites')
suite = ET.SubElement(testsuites, 'testsuite')
(tests, failures, disabled, skipped, errors) = (0, 0, 0, 0, 0)
totaltime = 0.0

prevpassed = True
for infile in infiles:
    if not prevpassed:
        print()

    outfile = infile[:-len('.' + suffix)] + '.expected'
    actualfile = infile[:-len('.' + suffix)] + '.actual'

    # get the input
    fp = open(infile, 'rb')
    input = fp.read()
    fp.close()

    # get the expected output
    fp = open(outfile, 'rb')
    expected = fp.read()
    fp.close()

    # report the result in XML
    case = ET.SubElement(suite, 'testcase')
    case.set('name', infile)

    # run the program to get the actual output
    body = ' '.join(cmd) + ' < ' + infile
    print(body)
    body += '\n'
    start = time.time()
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    (actual, stderr) = proc.communicate(input)
    seconds = time.time() - start
    fp = open(actualfile, 'wb')
    fp.write(actual)
    fp.close()

    # check the output
    passed = True
    if proc.returncode != 0:
        msg = '\n!!! returned non-zero status code {}'.format(proc.returncode)
        print(msg)
        body += msg + '\n'
        passed = False

    if stderr != b'':
        msg = '\n!!! stderr should have been empty, but instead the program printed:'
        lines = stderr.split(b'\n')
        if len(lines) > 0 and lines[-1] == b'':
            lines = lines[:-1]
        for line in lines:
            msg += '\n> ' + str(line, 'utf-8')
        print(msg)
        body += msg + '\n'
        passed = False

    if actual != expected:
        msg = '\n!!! output is incorrect:\n'
        diff = ['diff', actualfile, outfile]
        msg += ' '.join(diff)
        proc = subprocess.Popen(diff, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        (output, errout) = proc.communicate(b'')
        if len(output) > 0 and output[-1] == '\n':
            output = output[:-1]
        msg += str(output, 'utf-8')
        print(msg)
        body += msg + '\n'
        passed = False

    os.remove(actualfile)

    tests += 1
    totaltime += seconds
    case.set('time', str(time.time() - start))
    if not passed:
        failures += 1
        case.set('status', 'failed')
        failure = ET.SubElement(case, 'failure')
        failure.set('type', 'failure')
        failure.text = body

    prevpassed = passed

suite.set('tests', str(tests))
suite.set('failures', str(failures))
suite.set('disabled', str(disabled))
suite.set('skipped', str(skipped))
suite.set('errors', str(errors))
suite.set('time', str(totaltime))
testsuites.set('tests', str(tests))
testsuites.set('failures', str(failures))
testsuites.set('disabled', str(disabled))
testsuites.set('skipped', str(skipped))
testsuites.set('errors', str(errors))
testsuites.set('time', str(totaltime))

tree = ET.ElementTree(element=testsuites)
tree.write('test_detail.xml', encoding='utf-8', xml_declaration=True)

print('\nPassed {}/{} tests in {:.2} seconds'.format(tests-failures, tests, totaltime))
