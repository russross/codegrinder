import unittest

from smoke import smoke_answer


class SmokeTest(unittest.TestCase):
    def test_answer(self) -> None:
        self.assertEqual(smoke_answer(), 42)


if __name__ == "__main__":
    unittest.main()
