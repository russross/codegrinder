#!/usr/bin/env python3

import os
from pathlib import Path
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

loadLineHardware = re.compile(r'(?m)^load +([-\w]+\.hdl),$')
outLineHardware = re.compile(r'(?m)^output-file +([-\w]+.out),$')
compareLineHardware = re.compile(r'(?m)^compare-to +([-\w]+.cmp),$')
hardwareSuccessMessage = 'End of script - Comparison ended successfully\n'
hardwareParseFailure = re.compile(r'^In HDL file .*?/([-\w]+\.hdl), Line (\d+), .*: load [-\w]+\.hdl\n$')
hardwareCompareFailure = re.compile(r'^Comparison failure at line (\d+)\n$')

loadLineAssembly = re.compile(r'(?m)^load +([-\w]+\.hack),$')
outLineAssembly = re.compile(r'(?m)^output-file +([-\w]+.out),$')
compareLineAssembly = re.compile(r'(?m)^compare-to +([-\w]+.cmp),$')
assemblySuccessMessage = 'End of script - Comparison ended successfully\n'
assemblyFailure = re.compile(r'^In line (\d+),')
assemblyHackFailure = re.compile(r'^At line (\d+),')
assemblyCompareFailure = re.compile(r'^Comparison failure at line (\d+)\n$')

class TestFileInfo:
    def __init__(self, test=None, hdl=None, asm=None, hack=None, output=None, compare=None):
        self.test = test
        self.hdl = hdl
        self.asm = asm
        self.hack = hack
        self.output = output
        self.compare = compare

def gatherTests():
    tests = []
    newFiles = []

    # copy the tests and expected output files into place
    testDir = Path('tests')
    for path in testDir.iterdir():
        if not path.is_file():
            continue
        name = path.name

        # copy the file from ./tests/ to ./
        with path.open('r') as fp:
            contents = fp.read()
        with open(name, 'w') as fp:
            fp.write(contents)
        newFiles.append(name)

        # record info about test files
        if path.suffix != '.tst':
            continue
        elt = TestFileInfo(test = name)
        tests.append(elt)

        count = 0

        # each test must load a single hardware definition ...
        m = loadLineHardware.search(contents)
        if m:
            count += 1
            elt.hdl = m.group(1)

            # make sure the required .hdl file is present so the system does
            # not fall back to a builtin definition
            if not Path(elt.hdl).exists():
                return ([], newFiles, name + 'requires ' + elt.hdl + ', but it is missing')

            # get the output file name
            m = outLineHardware.search(contents)
            if not m:
                return ([], newFiles, 'no output file found in test file ' + name)
            elt.output = m.group(1)

            # get the compare file name
            m = compareLineHardware.search(contents)
            if not m:
                return ([], newFiles, 'no compare file found in test file ' + name)
            elt.compare = m.group(1)

        # ... or a single hack object file
        m = loadLineAssembly.search(contents)
        if m:
            count += 1
            elt.hack = m.group(1)

            # get the source file name
            elt.asm = elt.hack[:len(elt.hack)-len('.hack')] + '.asm'

            # get the compare file name
            m = outLineAssembly.search(contents)
            if not m:
                return ([], newFiles, 'no output file found in test file ' + name)
            elt.output = m.group(1)

            # get the compare file name
            m = compareLineAssembly.search(contents)
            if not m:
                return ([], newFiles, 'no compare file found in test file ' + name)
            elt.compare = m.group(1)

        # should be exactly one kind of test
        if count < 1:
            return ([], newFiles, 'no load line found in test file ' + name)
        elif count > 1:
            return ([], newFiles, 'found too many test types in test file ' + name)

    return (tests, newFiles, None)

def addResult(result, name, msg, seconds):
    global suite, tests, failures, disabled, skipped, errors, totaltime

    case = ET.SubElement(suite, 'testcase')
    case.set('name', name)
    case.set('time', str(seconds))
    totaltime += seconds
    case.set('status', result)
    if result == 'passed':
        pass
    elif result == 'failure':
        failure = ET.SubElement(case, 'failure')
        failure.set('type', 'failure')
        failure.text = msg
        failures += 1
    else:
        print('unexpected result type: ' + result)
        sys.exit(1)

    tests += 1

def runHardwareTest(test):
    # launch the test runner
    absPath = str(Path(test.test).resolve())
    start = time.time()
    proc = subprocess.Popen(
        [ '/usr/local/nand2tetris/tools/HardwareSimulator.sh', absPath ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE)
    (stdoutBytes, stderrBytes) = proc.communicate()
    (stdout, stderr) = (stdoutBytes.decode('utf-8'), stderrBytes.decode('utf-8'))
    seconds = time.time() - start

    parseResult = hardwareParseFailure.search(stderr)
    compareResult = hardwareCompareFailure.search(stderr)

    # was it a pass?
    if len(stderr) == 0 and stdout.endswith(hardwareSuccessMessage) and proc.returncode == 0:
        addResult('passed', 'test file ' + test.test, stdout, seconds)
        print(stdout, end='')

    # anything else is a failure
    else:
        addResult('failure', 'test file ' + test.test, stderr, seconds)
        print(stderr, end='')

    return seconds

def runAssemblyTest(test):
    # assemble the file
    absPath = str(Path(test.asm).resolve())
    start = time.time()
    proc = subprocess.Popen(
        [ '/usr/local/nand2tetris/tools/Assembler.sh', absPath ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE)
    (stdoutBytes, stderrBytes) = proc.communicate()
    (stdout, stderr) = (stdoutBytes.decode('utf-8'), stderrBytes.decode('utf-8'))
    seconds = time.time() - start

    # did it fail to assemble?
    if len(stderr) != 0 or proc.returncode != 0:
        addResult('failure', 'source file ' + test.test, stderr, seconds)
        print(stderr, end='')
        return seconds

    # launch the test runner
    absPath = str(Path(test.test).resolve())
    start = time.time()
    proc = subprocess.Popen(
        [ '/usr/local/nand2tetris/tools/CPUEmulator.sh', absPath ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE)
    (stdoutBytes, stderrBytes) = proc.communicate()
    (stdout, stderr) = (stdoutBytes.decode('utf-8'), stderrBytes.decode('utf-8'))
    seconds = time.time() - start

    # was it a pass?
    if len(stderr) == 0 and stdout.endswith(assemblySuccessMessage) and proc.returncode == 0:
        addResult('passed', 'test file ' + test.test, stdout, seconds)
        print(stdout, end='')

    # anything else is a failure
    else:
        addResult('failure', 'test file ' + test.test, stderr, seconds)
        print(stderr, end='')

    return seconds


# gather the tests to run
if Path('test_detail.xml').exists():
    os.remove('test_detail.xml')
(testFiles, newFiles, err) = gatherTests()
if err is None and len(testFiles) == 0:
    err = 'no test data found'

# prepare the XML result container
testsuites = ET.Element('testsuites')
suite = ET.SubElement(testsuites, 'testsuite')
(tests, failures, disabled, skipped, errors) = (0, 0, 0, 0, 0)
totaltime = 0.0

# if we have an error already, we fail without attempting any tests
if err is not None:
    print(err)
    addResult('failure', 'setting up', err, 0.0)

else:
    for test in testFiles:
        if test.hdl:
            totaltime += runHardwareTest(test)
        elif test.asm:
            totaltime += runAssemblyTest(test)

# clean up
def rm(name):
    if Path(name).exists():
        os.remove(name)
for test in testFiles:
    if test.hdl:
        rm(test.test)
        rm(test.compare)
        rm(test.output)
    elif test.asm:
        rm(test.test)
        rm(test.hack)
        rm(test.output)
for name in newFiles:
    rm(name)

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

print('Passed {}/{} tests in {:.2} seconds'.format(tests-failures, tests, totaltime))
