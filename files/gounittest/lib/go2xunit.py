#!/usr/bin/env python3
"""
go2xunit - Convert Go test output to XUnit/JUnit XML format
Ported from: github.com/tebeka/go2xunit
"""

import sys
import argparse
import re
import io
from datetime import datetime
from enum import IntEnum
from typing import List, Optional, Tuple, Dict
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape


__version__ = "1.4.10"


# Status constants
class Status(IntEnum):
    UNKNOWN = 0
    FAILED = 1
    SKIPPED = 2
    PASSED = 3


# Regular expressions for gotest output
GOTEST_START_RE = re.compile(r"^=== RUN:?\s+([a-zA-Z_][^\s]*)")
GOTEST_END_RE = re.compile(r"^--- (PASS|FAIL|SKIP):\s+([a-zA-Z_][^\s]*)\s+\((-?\d+(?:\.\d+)?)")
GOTEST_SUITE_RE = re.compile(r"^(ok|FAIL)\s+([^\s]+)\s+((-?\d+\.\d+)|\(cached\))")
GOTEST_NO_FILES_RE = re.compile(r"^\?\s+.*\[no test files\]$")
GOTEST_BUILD_FAILED_RE = re.compile(r"^FAIL\s+.*\[(build|setup) failed\]$")
GOTEST_EXIT_RE = re.compile(r"^exit status -?\d+")

# Regular expressions for gocheck output
GOCHECK_START_RE = re.compile(r"START: [^:]+:[^:]+: ([A-Za-z_]\w*)\.([A-Za-z_]\w*)")
GOCHECK_END_RE = re.compile(
    r"(PASS|FAIL|SKIP|PANIC|MISS): [^:]+:[^:]+: ([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s?(-?[0-9]+\.[0-9]+)?"
)
GOCHECK_SUITE_RE = re.compile(r"^(ok|FAIL)\s+([^\s]+)\s+(-?\d+\.\d+)")
GOCHECK_TEST_ERROR_RE = re.compile(r"(?s).*Error Trace:.*\.go.*Error:.*Messages:.*")

DATA_RACE_RE = re.compile(r"^WARNING: DATA RACE$")


class Test:
    def __init__(self, name: str):
        self.name = name
        self.time = "0"
        self.message = ""
        self.status = Status.UNKNOWN
        self.appended_error_output = False
        self.is_parent_test = False


class Suite:
    def __init__(self, name: str = ""):
        self.name = name
        self.time = "0"
        self.status = ""
        self.tests: List[Test] = []

    def num_passed(self) -> int:
        return sum(1 for test in self.tests if test.status == Status.PASSED)

    def num_failed(self) -> int:
        return sum(1 for test in self.tests if test.status == Status.FAILED)

    def num_skipped(self) -> int:
        return sum(1 for test in self.tests if test.status == Status.SKIPPED)

    def len(self) -> int:
        return len(self.tests)


class Options:
    fail_on_race = False


def token_to_status(token: str) -> Status:
    """Convert token string to Status"""
    if token in ("FAIL", "PANIC"):
        return Status.FAILED
    elif token == "PASS":
        return Status.PASSED
    elif token in ("SKIP", "MISS"):
        return Status.SKIPPED
    return Status.UNKNOWN


def has_datarace(lines: List[str]) -> bool:
    """Check if there's a data race warning in the lines"""
    return any(DATA_RACE_RE.match(line) for line in lines)


def get_previous_fail_test(suite: Suite, cur_test: Test) -> Optional[Test]:
    """Returns previous failing test in a suite"""
    for test in suite.tests:
        if test.name == cur_test.name:
            break
        if test.status == Status.FAILED:
            return test
    return None


def parse_gotest(text: str, suite_prefix: str = "") -> List[Suite]:
    """Parse gotest output"""
    lines = text.split('\n')
    suites: List[Suite] = []
    sub_tests: Dict[str, Test] = {}
    parent_test: Optional[Test] = None
    cur_test: Optional[Test] = None
    cur_suite: Optional[Suite] = None
    out: List[str] = []
    suite_stack: List[Suite] = []

    def handle_panic():
        nonlocal cur_test, cur_suite
        if cur_test and cur_suite:
            cur_test.status = Status.FAILED
            cur_test.time = "0"
            cur_suite.tests.append(cur_test)
        cur_test = None

    def append_error():
        nonlocal cur_suite, out
        if out and cur_suite and cur_suite.tests:
            message = "\n".join(out)
            test = cur_suite.tests[-1]
            if not test.is_parent_test:
                if test.message:
                    test.message += "\n" + message
                else:
                    test.message = message
                test.appended_error_output = GOCHECK_TEST_ERROR_RE.match(message) is not None
        out = []

    if not cur_suite:
        cur_suite = Suite()

    for line_num, line in enumerate(lines, 1):
        # Check for no test files
        if GOTEST_NO_FILES_RE.match(line):
            continue

        # Check for build failures
        if GOTEST_BUILD_FAILED_RE.match(line):
            raise ValueError(f"{line_num}: package build failed: {line}")

        if not cur_suite:
            cur_suite = Suite()

        # Check for test start
        match = GOTEST_START_RE.match(line)
        if match:
            sub_test = False
            if cur_test:
                # Handle subtests or new suite
                if parent_test is None and match.group(1).startswith(cur_test.name + "/"):
                    parent_test = cur_test
                    cur_suite.tests.append(cur_test)
                    sub_tests = {}
                    sub_test = True
                elif parent_test and match.group(1).startswith(parent_test.name + "/"):
                    parent_test.is_parent_test = True
                    parent_test.appended_error_output = True
                    sub_test = True
                elif not suite_stack:
                    suite_stack.append(cur_suite)
                    cur_suite = Suite(name=cur_test.name)
                else:
                    handle_panic()

            append_error()
            cur_test = Test(name=match.group(1))
            if sub_test:
                cur_suite.tests.append(cur_test)
                sub_tests[cur_test.name] = cur_test
            continue

        # Check for test end
        match = GOTEST_END_RE.match(line)
        if match:
            append_test = True
            status_str, test_name, time_str = match.groups()[:3]

            if parent_test and test_name == parent_test.name:
                cur_test = parent_test
                parent_test = None
                append_test = False
            elif test_name in sub_tests:
                cur_test = sub_tests[test_name]
                append_test = False
            else:
                parent_test = None
                sub_tests = {}
                if not cur_test:
                    if suite_stack:
                        prev_suite = suite_stack.pop()
                        suites.append(cur_suite)
                        cur_suite = prev_suite
                        continue
                    else:
                        raise ValueError(f"{line_num}: orphan end test")
                if test_name != cur_test.name:
                    raise ValueError(f"{line_num}: name mismatch (try disabling parallel mode)")

            if cur_test:
                cur_test.status = token_to_status(status_str)
                if cur_test.status == Status.UNKNOWN:
                    raise ValueError(f"{line_num}: unknown status - {status_str}")
                if Options.fail_on_race and has_datarace(out):
                    cur_test.status = Status.FAILED
                cur_test.time = time_str

                if out:
                    message = "\n".join(out)
                    prev_test = get_previous_fail_test(cur_suite, cur_test)
                    test = prev_test if prev_test and not prev_test.appended_error_output else cur_test
                    if not test.is_parent_test:
                        test.message += message if test.message else ""
                        test.appended_error_output = GOCHECK_TEST_ERROR_RE.match(message) is not None

                if append_test:
                    cur_suite.tests.append(cur_test)
                cur_test = None
                out = []
            continue

        # Check for suite end
        match = GOTEST_SUITE_RE.match(line)
        if match:
            if cur_test:
                handle_panic()
            append_error()
            if cur_suite:
                cur_suite.name = suite_prefix + match.group(2)
                cur_suite.time = match.group(3)
                suites.append(cur_suite)
            cur_suite = None
            continue

        # Skip exit status and PASS/FAIL lines
        if GOTEST_EXIT_RE.match(line) or line in ("FAIL", "PASS"):
            continue

        out.append(line)

    # Handle remaining test that didn't finish
    if cur_test:
        handle_panic()

    # Handle remaining suite
    if cur_suite:
        if not cur_suite.name:
            cur_suite.name = suite_prefix
        append_error()
        if cur_suite.tests:
            suites.append(cur_suite)

    if not suites:
        raise ValueError("no tests found")

    return suites


def parse_gocheck(text: str, suite_prefix: str = "") -> List[Suite]:
    """Parse gocheck output"""
    lines = text.split('\n')
    suites: List[Suite] = []
    suite_name = ""
    suite: Optional[Suite] = None
    test_name = ""
    out: List[str] = []

    for line_num, line in enumerate(lines, 1):
        # Check for test start
        match = GOCHECK_START_RE.match(line)
        if match:
            suite_name, test_name = match.groups()
            if test_name in ("SetUpTest", "TearDownTest"):
                continue
            if test_name:
                raise ValueError(f"{line_num}: start in middle of test")
            out = []
            continue

        # Check for test end
        match = GOCHECK_END_RE.match(line)
        if match:
            status_str, suite_match, test_match, time_str = match.groups()
            if test_match in ("SetUpTest", "TearDownTest"):
                continue
            if not test_name:
                raise ValueError(f"{line_num}: orphan end")
            if suite_match != suite_name or test_match != test_name:
                raise ValueError(f"{line_num}: suite/name mismatch")

            test = Test(name=test_name)
            test.message = "\n".join(out)
            test.time = time_str or "0"
            test.status = token_to_status(status_str)
            if test.status == Status.UNKNOWN:
                raise ValueError(f"{line_num}: unknown status {status_str}")

            if not suite or suite.name != suite_name:
                suite = Suite(name=suite_prefix + suite_name)
                suites.append(suite)
            suite.tests.append(test)

            test_name = ""
            suite_name = ""
            out = []
            continue

        # Check for suite summary line
        match = GOCHECK_SUITE_RE.match(line)
        if match:
            if not suite:
                suite = Suite(name=match.group(2))
                suites.append(suite)
            else:
                suite.status = match.group(1)
                suite.time = match.group(3)

            test_name = ""
            suite_name = ""
            out = []
            continue

        if test_name:
            out.append(line)

    if not suites:
        raise ValueError("no tests found")

    return suites


def generate_xunit_xml(suites: List[Suite], testtime: datetime) -> str:
    """Generate XUnit XML output"""
    root = ET.Element("testsuites") if len(suites) > 1 else None

    suite_elements = []
    total_time = 0.0

    for suite in suites:
        ts = ET.Element("testsuite")
        ts.set("name", suite.name)
        ts.set("tests", str(suite.len()))
        ts.set("errors", "0")
        ts.set("failures", str(suite.num_failed()))
        ts.set("skip", str(suite.num_skipped()))

        try:
            suite_time = float(suite.time)
            total_time += suite_time
        except (ValueError, TypeError):
            suite_time = 0.0

        for test in suite.tests:
            tc = ET.Element("testcase")
            tc.set("classname", suite.name)
            tc.set("name", test.name)
            try:
                tc.set("time", str(float(test.time)))
            except (ValueError, TypeError):
                tc.set("time", "0")

            if test.status == Status.SKIPPED:
                ET.SubElement(tc, "skipped")
            elif test.status == Status.FAILED:
                failure = ET.SubElement(tc, "failure")
                failure.set("type", "go.error")
                failure.set("message", "error")
                failure.text = test.message

            ts.append(tc)

        suite_elements.append(ts)

    if root is not None:
        for ts in suite_elements:
            root.append(ts)
    else:
        root = suite_elements[0] if suite_elements else ET.Element("testsuites")

    # Format XML
    xml_str = ET.tostring(root, encoding='unicode')
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + xml_str


def generate_xunitnet_xml(suites: List[Suite], testtime: datetime) -> str:
    """Generate XUnit.NET format XML output"""
    root = ET.Element("assembly")
    root.set("name", suites[-1].name if suites else "tests")
    root.set("run-date", testtime.strftime("%Y-%m-%d"))
    root.set("run-time", testtime.strftime("%H:%M:%S"))
    root.set("configFile", "none")

    total_passed = sum(s.num_passed() for s in suites)
    total_failed = sum(s.num_failed() for s in suites)
    total_skipped = sum(s.num_skipped() for s in suites)
    total_tests = total_passed + total_failed + total_skipped
    total_time = sum(float(s.time) if s.time else 0 for s in suites)

    root.set("time", f"{total_time:.3f}")
    root.set("total", str(total_tests))
    root.set("passed", str(total_passed))
    root.set("failed", str(total_failed))
    root.set("skipped", str(total_skipped))
    root.set("environment", "n/a")
    root.set("test-framework", "golang")

    for suite in suites:
        cls = ET.Element("class")
        cls.set("name", suite.name)
        cls.set("time", suite.time or "0")
        cls.set("total", str(suite.len()))
        cls.set("passed", str(suite.num_passed()))
        cls.set("failed", str(suite.num_failed()))
        cls.set("skipped", str(suite.num_skipped()))

        for test in suite.tests:
            tc = ET.Element("test")
            tc.set("name", test.name)
            tc.set("type", "test")
            tc.set("method", test.name)

            if test.status == Status.SKIPPED:
                tc.set("result", "Skip")
            elif test.status == Status.FAILED:
                tc.set("result", "Fail")
            else:
                tc.set("result", "Pass")

            tc.set("time", test.time or "0")

            if test.status == Status.FAILED:
                failure = ET.SubElement(tc, "failure")
                failure.set("exception-type", "go.error")
                msg = ET.SubElement(failure, "message")
                msg.text = test.message

            cls.append(tc)

        root.append(cls)

    xml_str = ET.tostring(root, encoding='unicode')
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + xml_str


def main():
    parser = argparse.ArgumentParser(
        description="Convert Go test output to XUnit/JUnit XML format"
    )
    parser.add_argument(
        "-input", "-i",
        dest="input_file",
        default="",
        help="Input file (default: stdin)"
    )
    parser.add_argument(
        "-output", "-o",
        dest="output_file",
        default="",
        help="Output file (default: stdout)"
    )
    parser.add_argument(
        "-fail",
        action="store_true",
        help="Exit with non-zero status if any test failed"
    )
    parser.add_argument(
        "-version",
        action="store_true",
        help="Print version and exit"
    )
    parser.add_argument(
        "-bamboo",
        action="store_true",
        help="XML compatible with Atlassian's Bamboo"
    )
    parser.add_argument(
        "-xunitnet",
        action="store_true",
        help="XML compatible with xunit.net"
    )
    parser.add_argument(
        "-gocheck",
        action="store_true",
        help="Parse gocheck output"
    )
    parser.add_argument(
        "-fail-on-race",
        action="store_true",
        help="Mark test as failing if it exposes a data race"
    )
    parser.add_argument(
        "-suite-name-prefix",
        default="",
        help="Prefix to include before all suite names"
    )

    args = parser.parse_args()

    if args.version:
        print(f"go2xunit {__version__}")
        sys.exit(0)

    Options.fail_on_race = args.fail_on_race

    # Validate arguments
    if args.bamboo and args.xunitnet:
        print("error: -bamboo and -xunitnet are mutually exclusive", file=sys.stderr)
        sys.exit(1)

    # Get input
    if args.input_file and args.input_file != "-":
        try:
            with open(args.input_file, 'r') as f:
                text = f.read()
            testtime = datetime.fromtimestamp(
                __import__('os').path.getmtime(args.input_file)
            )
        except IOError as e:
            print(f"error: can't open {args.input_file} for reading: {e}", file=sys.stderr)
            sys.exit(1)
    else:
        text = sys.stdin.read()
        testtime = datetime.now()

    # Parse
    try:
        if args.gocheck:
            suites = parse_gocheck(text, args.suite_name_prefix)
        else:
            suites = parse_gotest(text, args.suite_name_prefix)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)

    # Generate XML
    if args.xunitnet:
        xml_output = generate_xunitnet_xml(suites, testtime)
    else:
        xml_output = generate_xunit_xml(suites, testtime)

    # Write output
    if args.output_file and args.output_file != "-":
        try:
            with open(args.output_file, 'w') as f:
                f.write(xml_output)
        except IOError as e:
            print(f"error: can't open {args.output_file} for writing: {e}", file=sys.stderr)
            sys.exit(1)
    else:
        print(xml_output, end='')

    # Check for failures if -fail flag is set
    if args.fail and any(s.num_failed() > 0 for s in suites):
        sys.exit(1)


if __name__ == "__main__":
    main()
