import ast
import unittest

import asttest
import {{ .FileName }} as student


class Test{{ .TestClassName }}(asttest.ASTTest):
    def setUp(self):
        super().setUp("{{ .FileName }}.py")
        self.function_name = "{{ .FuncToTest }}"

    def test_provided_code(self):
        script_section = 'if __name__ == "__main__":\n    main()'

        self.assertIn(
            script_section,
            self.file,
            "You should not edit/remove the instructor provided section at the bottom of the file.",
        )

        self.assertFalse(
            len(self.find_function_calls("main")) == 0,
            "You should not touch the call to the `main` function.",
        )
        self.assertTrue(
            len(self.find_function_calls("main")) == 1,
            "You should not be calling `main` in your solution code. It should only be in the section at the bottom. Which you should not touch.",
        )

    def test_required_syntax(self):
        type_hints = {{ .ParamTypeHint }}
        return_type = {{ .ReturnTypeHint }}

        student_func: ast.FunctionDef | None = self.match_signature(self.function_name, len(type_hints))
        self.assertIsNotNone(
            student_func,
            f"The `{self.function_name}` function is missing. Did you change/remove it? Do you have all of the parameters defined?"
        )

        self.validate_type_hints(student_func, type_hints, return_type)

    def test_correct_output(self):
        pass


if __name__ == "__main__":
    unittest.main()
