import ast
import unittest

class ASTTest(unittest.TestCase):

    def setUp(self, filename, parse_file=True):
        """Stores the raw text of the student submission, the lines that were
        printed when executing the student submission, and the AST tree of the
        submission."""
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

    def get_function_calls(self):
        """Helper to find all of the function calls in the submission."""
        names = []
        for func in self.find_all(ast.Call):
            if isinstance(func.func, ast.Name):
                names.append(func.func.id)
        return names

    def get_method_calls(self):
        """Helper to find all of the function calls in the submission."""
        names = []
        for func in self.find_all(ast.Call):
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
