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
            if call.func.id == func_name:
                calls.append(call)
        return calls

    def get_method_calls(self, start_node=None):
        """Helper to find all of the function calls in the submission."""
        names = []
        for func in self.find_all(ast.Call, start_node):
            if isinstance(func.func, ast.Attribute):
                names.append(func.func.attr)
        return names

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

    def ensure_coverage(self, min_coverage):
        """Checks whether the student has written enough unit tests to cover a
        significant portion of their solution. Note: super hacky... Also, you
        might want to patch stdout for tests that use this."""
        basename = self.filename.split('.')[0]
        # build a tracer to trace the execution of the student's solution
        tracer = trace.Trace(count=True, trace=True,
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
        # count how many lines were executed vs skipped
        skipped_lines = []
        total_lines = 0
        f = open(basename+".cover")
        for line in f:
            if line[4].isdigit() and int(line[4]) > 1:
                total_lines += 1
            if line[:6] == ">>>>>>":
                skipped_lines.append(line[8:])
        f.close()
        # clean up cover file
        os.remove(basename+".cover")
        self.assertGreater((total_lines-len(skipped_lines))/total_lines, min_coverage,
                "Your test coverage is not adequate. Write tests that cover "
                "all possible outcomes of your function. Here are the lines "
                "that weren't covered:\n\n" + '\n'.join(skipped_lines))
