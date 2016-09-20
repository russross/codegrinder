# convert unit test output to xunit xml file

import re
import sys
import os.path
import xml.etree.ElementTree as ET

completeTest = re.compile(r'% PL-Unit: (\S+) \.* done$')
errorTest = re.compile(r'ERROR: (\S+):(\d+):\d+: (.*)$')
beginningOfTest = re.compile(r'% PL-Unit: (\S+) \.*$')
errorInsideTest = re.compile(r'ERROR: (\S+):\d+:$')
endOfTest = re.compile(r'\.* done$')

suites = ET.Element('testsuites')
suite = ET.SubElement(suites, 'testsuite')
passed, failed, errors = 0, 0, 0
case, err, details = None, None, ''
for line in sys.stdin:
    # outside a test result?
    if case is None:
        # compiler error?
        groups = errorTest.match(line)
        if groups:
            errors += 1
            partial = os.path.relpath(groups.group(1))
            case = ET.SubElement(suite, 'testcase')
            case.set('name', 'Compiler error in '+partial+' line '+groups.group(2))
            case.set('status', 'error')
            err = ET.SubElement(case, 'error')
            err.text = groups.group(3)
            case, err, details = None, None, ''
            break

        # simple test pass?
        groups = completeTest.match(line)
        if groups:
            passed += 1
            case = ET.SubElement(suite, 'testcase')
            case.set('name', groups.group(1))
            case, err, details = None, None, ''
            continue

        # multiline result?
        groups = beginningOfTest.match(line)
        if groups:
            passed += 1
            case = ET.SubElement(suite, 'testcase')
            case.set('name', groups.group(1))
            details = line + '\n'
            continue

    # inside a multiline result?
    else:
        details += line + '\n'

        # error in the test?
        groups = errorInsideTest.match(line)
        if groups:
            partial = os.path.relpath(groups.group(1))
            if err is None:
                case.set('status', 'failed')
                passed -= 1
                failed += 1
                err = ET.SubElement(case, 'failure')
            continue

        # end of test case?
        groups = endOfTest.match(line)
        if groups:
            if err is not None:
                err.text = details
            case, err, details = None, None, ''
            continue

suite.set('tests', str(passed + failed + errors))
suites.set('tests', str(passed + failed + errors))
if failed > 0:
    suite.set('failures', str(failed))
    suites.set('failures', str(failed))
if errors > 0:
    suite.set('errors', str(errors))
    suites.set('errors', str(errors))
ET.ElementTree(suites).write('test_detail.xml', encoding='utf-8')
