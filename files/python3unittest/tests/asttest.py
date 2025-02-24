import ast
import os
import sys
import trace
from typing import get_origin, get_args, Any
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

    def get_function_calls(self, start_node=None) -> list[str]:
        """Helper to find all of the function calls in the submission."""
        names = []
        for func in self.find_all(ast.Call, start_node):
            if isinstance(func.func, ast.Name):
                names.append(func.func.id)
        return names

    def find_function_calls(self, func_name: str):
        """Finds all of the function calls that match a certain name and
        returns their nodes."""
        calls = []
        for call in self.find_all(ast.Call):
            if isinstance(call.func, ast.Name) and call.func.id == func_name:
                calls.append(call)
        return calls

    def get_method_calls(self, start_node: ast.Call | None = None):
        """Helper to find all of the function calls in the submission."""
        names = []
        for func in self.find_all(ast.Call, start_node):
            if isinstance(func.func, ast.Attribute):
                names.append(func.func.attr)
        return names

    def find_method_calls(self, func_name: str):
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

    def validate_method_param_type_hints(self, student_method: ast.FunctionDef, type_hints) -> None:
        """
        Validates method parameter type hints. Note that `self` should not be included in the list of type hints. It is checked automatically.

        Args:
            student_method: function to validate type hints against
            type_hints: list of parameter type hints, for example `[str, int, list[str]]` or `[list[dict[str, dict[str, list[dict[int, list[list[str]]]]]]]]`
        """
        type_hint_error_message = "Incorrect parameter type hints"
        self.assertTrue(
            len(student_method.args.args) == len(type_hints) + 1, # +1 because they aren't supposed to add `self` to the list to check
            f"The `{student_method.name}` method has the wrong number of parameters"
        )

        expected_param_types: list = [generate_default_value(type_hint) for type_hint in type_hints]

        # Check for `self`
        self.assertTrue(
            student_method.args.args[0].arg == "self",
            f"The `{student_method.name}` method is missing the `self` parameter"
        )

        for i in range(1, len(expected_param_types)):
            param: ast.arg = student_method.args.args[i]
            self.assertIsNotNone(param.annotation, type_hint_error_message)
            self._validate_type_hint(param.annotation, expected_param_types[i-1], type_hint_error_message) # -1 because we are skipping self in the actual args

    def validate_function_param_type_hints(self, student_func: ast.FunctionDef, type_hints: list) -> None:
        """
        Validates function parameter type hints.

        Args:
            student_func: function to validate type hints against
            type_hints: list of parameter type hints, for example `[str, int, list[str]]` or `[list[dict[str, dict[str, list[dict[int, list[list[str]]]]]]]]`
        """
        type_hint_error_message = "Incorrect parameter type hints"
        expected_param_types: list = [generate_default_value(type_hint) for type_hint in type_hints]

        for i in range(len(expected_param_types)):
            param: ast.arg = student_func.args.args[i]
            self.assertIsNotNone(param.annotation, type_hint_error_message)
            self._validate_type_hint(param.annotation, expected_param_types[i], type_hint_error_message)

    def validate_return_type_hint(self, student_func: ast.FunctionDef, return_type: Any) -> None:
        """
        Validates return type hint

        Args:
            student_func: function to validate type hints against
            return_type: return type hint, for example `bool` or `dict[str, int]`
        """
        type_hint_error_message = "Incorrect return type hint"
        expected_return_type = generate_default_value(return_type)
        self.assertIsNotNone(student_func.returns, f"The {student_func.name} function/method is missing a return type.")
        self._validate_type_hint(student_func.returns, expected_return_type, type_hint_error_message)

    def _validate_type_hint(self, hint: Any, expected_type: Any, type_hint_error_message: str) -> None:
        """ Helper method for checking type hints """
        if isinstance(expected_type, list):
            self._validate_list_param(hint, expected_type, type_hint_error_message)
        elif isinstance(expected_type, dict):
            self._validate_dict_param(hint, expected_type, type_hint_error_message)
        else:
            self.assertTrue(isinstance(hint, ast.Name), type_hint_error_message)
            self.assertTrue(hint.id == type(expected_type).__name__, type_hint_error_message)

    def _validate_list_param(self, param: ast.Subscript, expected_list: list, type_hint_error_message: str) -> None:
        """
        A recursive helper function to test list type hints.
        """
        # Check if no type is specified for the list
        if len(expected_list) == 0:
            # There isn't a specific param type for the list, so none should be specified
            self.assertTrue(isinstance(param, ast.Name), type_hint_error_message)
            self.assertTrue(param.id == "list", type_hint_error_message)
            return

        # Make sure param is a list
        self.assertTrue(isinstance(param, ast.Subscript), type_hint_error_message)
        self.assertTrue(param.value.id == "list", type_hint_error_message)

        expected_list_type = expected_list[0]

        # Validate the list type
        if isinstance(expected_list_type, list):
            self._validate_list_param(param.slice, expected_list_type, type_hint_error_message)
        elif isinstance(expected_list_type, dict):
            self._validate_dict_param(param.slice, expected_list_type, type_hint_error_message)
        else:
            self.assertTrue(param.slice.id == type(expected_list_type).__name__, type_hint_error_message)

    def _validate_dict_param(self, actual_dict: ast.Subscript, expected_dict: dict, type_hint_error_message: str) -> None:
        """
        A recursive helper function to test dict type hints.
        """
        # Check if dict has specific types
        if len(expected_dict) == 0:
            self.assertTrue(isinstance(actual_dict, ast.Name), type_hint_error_message)
            self.assertTrue(actual_dict.id == "dict", type_hint_error_message)
            return

        # Make sure param is a dict
        self.assertTrue(isinstance(actual_dict, ast.Subscript), type_hint_error_message)
        self.assertTrue(actual_dict.value.id == "dict", type_hint_error_message)

        # Verify the student param is a dict
        self.assertTrue(isinstance(actual_dict, ast.Subscript), type_hint_error_message)
        self.assertTrue(isinstance(actual_dict.slice, ast.Tuple), type_hint_error_message)

        # Extract the key/value from both expected and student param
        expected_key, expected_value = list(expected_dict.items())[0]
        actual_key, actual_value = actual_dict.slice.dims[0], actual_dict.slice.dims[1]

        # Check the key. Note that since the key has to be hashable, we don't need to do anything complicated.
        self.assertTrue(actual_key.id == type(expected_key).__name__)

        # Check the value
        if isinstance(expected_value, list):
            self._validate_list_param(actual_value, expected_value, type_hint_error_message)
        elif isinstance(expected_value, dict):
            self._validate_dict_param(actual_value, expected_value, type_hint_error_message)
        else:
            self.assertTrue(actual_value.id == type(expected_value).__name__, type_hint_error_message)

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

def generate_default_value(type_hint: Any) -> Any:
    """
    Given a type hint, convert it into a default object for use in type hint validation.

    For example:
    hint = list[dict[str, dict[str, list[dict[int, list[list[str]]]]]]]
    generate_default_value(hint) -> [[{'': {'': [{0: [['']]}]}}]]
    """
    # Handle base types directly
    if type_hint is str:
        return ""
    elif type_hint is int:
        return 0
    elif type_hint is float:
        return 0.0
    elif type_hint is bool:
        return False
    elif type_hint is None or type_hint is type(None):  # Handle NoneType
        return None

    origin = get_origin(type_hint)  # Get the generic type, e.g., list, dict, etc.
    args = get_args(type_hint)      # Get the type arguments, e.g., (dict[str, list[int]])

    # Handle generic types
    if origin is list:
        # Recursively generate a default value for the list's inner type
        return [generate_default_value(args[0])] if args else []
    elif origin is dict:
        # Generate a default key-value pair using inner types
        key_default = generate_default_value(args[0]) if args else ""
        value_default = generate_default_value(args[1]) if len(args) > 1 else None
        return {key_default: value_default}
    elif origin is tuple:
        # Generate a tuple with default values for each argument
        return tuple(generate_default_value(arg) for arg in args)
    elif origin is set:
        # Generate a set with one default value of its inner type
        return {generate_default_value(args[0])} if args else set()
    elif type_hint is list:
        # list is missing specific type
        return []
    elif type_hint is dict:
        # dict is missing specific types
        return {}

    # Fallback for unsupported or unknown types
    return None

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

