from __future__ import annotations

import unittest
from datetime import UTC, datetime

from signatures import (
    compute_daycare_registration_signature,
    encode_params,
    escape,
    hmac_sha256_base64,
)


class SignatureTests(unittest.TestCase):
    def test_escape(self) -> None:
        self.assertEqual(escape("abc-_.~"), "abc-_.~")
        self.assertEqual(escape("a b"), "a%20b")
        self.assertEqual(escape("x/y"), "x%2Fy")

    def test_encode_params_sorts_keys(self) -> None:
        got = encode_params({"b": ["2"], "a": ["1", "3"]}).decode("utf-8")
        self.assertEqual(got, "a=1&a=3&b=2")

    def test_hmac_sha256_base64_stable(self) -> None:
        got = hmac_sha256_base64("secret", b"payload")
        self.assertEqual(got, "uC/LeRrOxXhZuYm0MKgmSIzi5Hn9+SMmvQoug3WkK6Q=")

    def test_daycare_registration_signature_stable(self) -> None:
        when = datetime(2026, 2, 15, 10, 11, 12, tzinfo=UTC)
        sig = compute_daycare_registration_signature(
            hostname="example.test",
            problem_types=["python3unittest", "gounittest"],
            capacity=3,
            when=when,
            version="2.8.0",
            secret="secret",
        )
        self.assertEqual(sig, "04Kr9Gg29WeMQdz6yKzFDaB809rmKn9qNpxmLHXcTGg=")


if __name__ == "__main__":
    unittest.main()
