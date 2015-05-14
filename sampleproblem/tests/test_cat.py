import unittest
import sys
import StringIO
from cat import *


class TestCat(unittest.TestCase):

    def test_cat1(self):
        c = Cat(3)
        stdout, sys.stdout = sys.stdout, StringIO.StringIO()
        c.meow()
        out, sys.stdout = sys.stdout.getvalue(), stdout
        self.assertEqual(out, 'I have 3 lives\n')

    def test_cat2(self):
        c = Cat(10)
        stdout, sys.stdout = sys.stdout, StringIO.StringIO()
        c.meow()
        out, sys.stdout = sys.stdout.getvalue(), stdout
        self.assertEqual(out, 'I have 10 lives\n')
