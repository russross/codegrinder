from __future__ import annotations

import unittest
from typing import Any, cast
from unittest.mock import patch

from grade_passback import GradePassbackTarget, save_grade


class _FakeResponse:
    def __init__(self, status: int = 200, reason: str = "OK") -> None:
        self.status = status
        self.reason = reason

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


class GradePassbackTests(unittest.TestCase):
    def test_save_grade_posts_signed_request(self) -> None:
        target = GradePassbackTarget(
            assignment_id=1,
            user_id=7,
            grade_id="grade-1",
            outcome_url="https://canvas.invalid/outcome",
            outcome_ext_url="",
            outcome_ext_accepted="text",
            consumer_key="consumer-1",
            score=0.75,
            canvas_title="A1",
        )
        captured: dict[str, object] = {}

        def fake_urlopen(req: Any, timeout: float = 0.0) -> _FakeResponse:
            captured["url"] = req.full_url
            captured["auth"] = req.get_header("Authorization")
            captured["ctype"] = req.headers.get("Content-type")
            captured["body"] = req.data
            captured["timeout"] = timeout
            return _FakeResponse()

        with patch("grade_passback.urlrequest.urlopen", new=fake_urlopen):
            save_grade(target, "<h1>ok</h1>", "lti-secret")

        self.assertEqual(captured.get("url"), "https://canvas.invalid/outcome")
        self.assertEqual(captured.get("ctype"), "application/xml")
        self.assertIn("OAuth realm=", str(captured.get("auth")))
        body = cast(bytes, captured.get("body", b"")).decode("utf-8")
        self.assertIn("<textString>0.75000</textString>", body)
        self.assertIn("<text>&lt;h1&gt;ok&lt;/h1&gt;</text>", body)

    def test_save_grade_skips_missing_lti_fields(self) -> None:
        target = GradePassbackTarget(
            assignment_id=1,
            user_id=7,
            grade_id="",
            outcome_url="",
            outcome_ext_url="",
            outcome_ext_accepted="",
            consumer_key="consumer-1",
            score=0.0,
            canvas_title="A1",
        )
        with patch("grade_passback.urlrequest.urlopen") as mocked:
            save_grade(target, "ignored", "lti-secret")
        mocked.assert_not_called()


if __name__ == "__main__":
    unittest.main()
