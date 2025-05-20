import ast
import os
import sys
import trace
import unittest

class ASTTest(unittest.TestCase):

    def setUp(self, filename, parse_file=True):
        """Stores the raw text of the student submission, the lines that were
        printed when executing the student submission, and the AST tree of the
        submission."""
        self.filename = filename
        self.printed_lines = []
        f = open(filename)
        text = f.read()
        self.file = text
        if parse_file:
            self.tree = ast.parse(text)
        f.close()

    def find_all(self, node_type, start_node=None):
        """Returns all of the AST nodes matching the given node type. Optional
        start_node parameter allows walking a specific portion of the original
        tree. TODO: list common node types here for easy access."""
        if start_node is None:
            start_node = self.tree
        nodes = []
        for node in ast.walk(start_node):
            if isinstance(node, node_type):
                nodes.append(node)
        return nodes

    def print_replacement(self, *text, **kwargs):
        """Saves printed lines to a data member. Used by exec_solution, not
        usually necessary in any specific test."""
        self.printed_lines += text

    def exec_solution(self):
        """Executes the student submission."""
        print = self.print_replacement
        exec(self.file)

    def debug_tree(self):
        """Converts the AST tree for manual traversal. Not really necessary
        with find_all."""
        return ast.dump(self.tree)

    def get_function_calls(self, start_node=None):
        """Helper to find all of the function calls in the submission."""
        names = []
        for func in self.find_all(ast.Call, start_node):
            if isinstance(func.func, ast.Name):
                names.append(func.func.id)
        return names

    def find_function_calls(self, func_name):
        """Finds all of the function calls that match a certain name and
        returns their nodes."""
        calls = []
        for call in self.find_all(ast.Call):
            if isinstance(call.func, ast.Name) and call.func.id == func_name:
                calls.append(call)
        return calls

    def get_method_calls(self, start_node=None):
        """Helper to find all of the function calls in the submission."""
        names = []
        for func in self.find_all(ast.Call, start_node):
            if isinstance(func.func, ast.Attribute):
                names.append(func.func.attr)
        return names

    def find_method_calls(self, func_name):
        """Finds all of the method calls that match a certain name and returns
        their nodes."""
        calls = []
        for call in self.find_all(ast.Call):
            if isinstance(call.func, ast.Attribute) and call.func.attr == func_name:
                calls.append(call)
        return calls

    def match_signature(self, funcname, argc):
        """Finds and returns the function definition statement that matches the
        given function name and argument count. If it can't find a
        corresponding function definition, it returns None."""
        for func in self.find_all(ast.FunctionDef):
            if func.name == funcname and len(func.args.args) == argc:
                return func
        return None

    def assert_prints(self, lines=1, msg="You are not printing anything!"):
        """Assert helper testing the number of printed lines."""
        self.assertGreaterEqual(len(self.printed_lines), 1, msg)

    def function_prints(self, func_def_node):
        """Checks whether the given function has been defined to print or not."""
        calls_in_func = self.find_all(ast.Call, func_def_node)
        for call in calls_in_func:
            if call.func.id == "print":
                return True
        return False

    def get_function_linenos(self):
        linenos = {}
        for funcdef in self.find_all(ast.FunctionDef):
            linenos[funcdef.name] = {
                    "start": funcdef.lineno,
                    "end": get_function_end_lineno(funcdef),
                    }
        return linenos

    def ensure_coverage(self, function_names, min_coverage):
        """Checks whether the student has written enough unit tests to cover a
        significant portion of their solution. Note: super hacky... Also, you
        might want to patch stdout for tests that use this."""
        basename = self.filename.split('.')[0]
        # build a tracer to trace the execution of the student's solution
        tracer = trace.Trace(
                ignoremods=['asttest'],
                ignoredirs=[sys.prefix, sys.exec_prefix])
        def trigger(basename):
            """Helper function to import student's solution and thus, evaluate it"""
            import importlib
            # import solution
            m = importlib.import_module(basename)
            # reload it to force evaluating it (in case already imported elsewhere)
            importlib.reload(m)
        # run the helper function (trigger) to trigger evaluation of the solution
        tracer.runfunc(trigger, basename)
        # write tracing results to a *.cover file
        tracer.results().write_results(coverdir='.')
        # count how many lines were skipped
        all_skipped = []
        f = open(basename+".cover")
        lineno = 0
        for line in f:
            lineno += 1
            if line[:6] == ">>>>>>":
                # skipped line
                all_skipped.append((line[8:], lineno))
        f.close()
        # clean up cover file
        os.remove(basename+".cover")
        # count executable lines
        visitor = FindExecutableLines()
        visitor.visit(self.tree)
        all_executable_lines = set(visitor.lines)
        # compare skipped lines with actual lines
        total_lines = 0
        skipped_lines = []
        executable_lines = []
        linenos = self.get_function_linenos()
        for funcname in function_names:
            self.assertIn(funcname, linenos, "Function {} is not "
                    "defined.".format(funcname))
            start = linenos[funcname]["start"]
            end = linenos[funcname]["end"]
            # count executable lines (can't just subtract start from end
            # because that includes lines that don't show up in the trace)
            for lineno in all_executable_lines:
                if lineno in range(start+1, end+1):
                    total_lines += 1
            # count skipped lines
            for (line, lineno) in all_skipped:
                if lineno in range(start+1, end+1):
                    skipped_lines.append(line)
        self.assertGreater((total_lines-len(skipped_lines))/total_lines, min_coverage,
                "Your test coverage is not adequate. Write tests that cover "
                "all possible outcomes of your function. Here are the lines "
                "that weren't covered:\n\n" + '\n'.join(skipped_lines))

    def is_top_level(self, node):
        """Determines if a node is at the top-level of the program."""
        for elt in self.tree.body:
            if isinstance(elt, ast.Expr):
                if elt.value == node:
                    return True
            elif elt == node:
                return True
        return False

def get_function_end_lineno(funcdef):
    """Given an ast.FunctionDef node, returns the line number of the last line
    in the function. I only wrote this since I found out too late the
    end_lineno attribute was only introduced in Python 3.8, which we aren't
    currently using."""
    if sys.version_info[0] >= 3 and sys.version_info[1] >= 8:
        return funcdef.end_lineno
    last = funcdef.body[-1]
    while isinstance(last, (ast.For, ast.While, ast.If)):
        last = last.body[-1]
    return last.lineno

class FindExecutableLines(ast.NodeVisitor):
    """
    taken from pedal
        - (https://github.com/pedal-edu/pedal/blob/f3c195a2da9416745ad9122ec0e69d3d75d59866/pedal/sandbox/commands.py#L297)
        - (https://github.com/pedal-edu/pedal/blob/f3c195a2da9416745ad9122ec0e69d3d75d59866/pedal/utilities/ast_tools.py#L147)
    NodeVisitor subclass that visits every statement of a program and tracks
    their line numbers in a list.
    Attributes:
        lines (list[int]): The list of lines that were visited.
    """

    def __init__(self):
        self.lines = []

    def _track_lines(self, node):
        self.lines.append(node.lineno)
        self.generic_visit(node)

    visit_FunctionDef = _track_lines
    visit_AsyncFunctionDef = _track_lines
    visit_ClassDef = _track_lines
    visit_Return = _track_lines
    visit_Delete = _track_lines
    visit_Assign = _track_lines
    visit_AugAssign = _track_lines
    visit_AnnAssign = _track_lines
    visit_For = _track_lines
    visit_AsyncFor = _track_lines
    visit_While = _track_lines
    visit_If = _track_lines
    visit_With = _track_lines
    visit_AsyncWith = _track_lines
    visit_Raise = _track_lines
    visit_Try = _track_lines
    visit_Assert = _track_lines
    visit_Import = _track_lines
    visit_ImportFrom = _track_lines
    visit_Global = _track_lines
    visit_Nonlocal = _track_lines
    visit_Expr = _track_lines
    visit_Pass = _track_lines
    visit_Continue = _track_lines
    visit_Break = _track_lines
