from __future__ import annotations

import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from config import ServerConfig
from daycare_registry import DaycareRegistry
from db import setup_db
from ipfilter import IPFilter
from lti import BOOTSTRAP_ASSIGNMENT_NAME, LTIError, LTIService, compute_oauth_signature, get_config_xml
from sessions import LoginTokens
from signatures import compute_daycare_registration_signature


def _apply_schema(conn) -> None:
    schema_path = Path(__file__).resolve().parents[2] / "setup" / "schema.sql"
    schema = schema_path.read_text(encoding="utf-8")
    conn.executescript(schema)


def _seed(conn) -> None:
    now = "2026-02-15T10:00:00+00:00"
    conn.execute(
        "INSERT INTO problem_sets(problem_set_id, problem_set_note, problem_set_tags, problem_set_created_at, problem_set_updated_at) "
        "VALUES (?, ?, ?, ?, ?)",
        ("set-1", "Set 1", '["a"]', now, now),
    )
    conn.commit()


def _launch_form() -> dict[str, list[str]]:
    return {
        "lis_person_name_full": ["Student A"],
        "lis_person_contact_email_primary": ["student@example.invalid"],
        "user_id": ["u-1"],
        "roles": ["Student"],
        "context_title": ["Course A"],
        "context_label": ["CSE101"],
        "context_id": ["course-1"],
        "resource_link_id": ["asst-1"],
        "lis_result_sourcedid": ["grade-1"],
        "lis_outcome_service_url": ["https://canvas.invalid/outcome"],
        "ext_outcome_data_values_accepted": ["url,text"],
        "custom_canvas_user_login_id": ["student1"],
        "oauth_consumer_key": ["consumer-1"],
        "custom_canvas_assignment_unlock_at": ["2026-02-20T12:00:00Z"],
        "custom_canvas_assignment_due_at": ["2026-02-21T12:00:00Z"],
        "custom_canvas_assignment_lock_at": ["2026-02-22T12:00:00Z"],
    }


class LTITests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        db_path = Path(self.tmp.name) / "db.sqlite"
        self.conn = setup_db(db_path)
        _apply_schema(self.conn)
        _seed(self.conn)
        self.config = ServerConfig(
            hostname="codegrinder.example.com",
            daycare_secret="daycare-secret",
            lti_secret="lti-secret",
            session_secret="session-secret",
            sessions_expire=[
                datetime(2020, 1, 1, 0, 0, 0, tzinfo=UTC),
                datetime(2020, 7, 1, 0, 0, 0, tzinfo=UTC),
            ],
        )
        self.now = datetime(2026, 2, 15, 10, 0, 0, tzinfo=UTC)
        self.login_tokens = LoginTokens()

    def tearDown(self) -> None:
        self.conn.close()
        self.tmp.cleanup()

    def _service(self, ip_filter: IPFilter | None = None) -> LTIService:
        return LTIService(
            conn=self.conn,
            config=self.config,
            login_tokens=self.login_tokens,
            ip_filter=ip_filter or IPFilter.from_entries([]),
            daycare_registry=DaycareRegistry(secret=self.config.daycare_secret, version="2.8.0", now_provider=lambda: self.now),
            now_provider=lambda: self.now,
        )

    def test_get_config_xml_contains_tool_fields(self) -> None:
        raw = get_config_xml(self.config).decode("utf-8")
        self.assertIn("<blti:title>CodeGrinder</blti:title>", raw)
        self.assertIn("<lticm:property name=\"tool_id\">codegrinder</lticm:property>", raw)
        self.assertIn("<lticm:property name=\"domain\">codegrinder.example.com</lticm:property>", raw)

    def test_compute_oauth_signature_round_trip(self) -> None:
        form = _launch_form()
        request_url = "https://codegrinder.example.com/lti/problem_sets/web/set-1"
        form["oauth_signature"] = [compute_oauth_signature("POST", request_url, form, self.config.lti_secret)]
        self._service().validate_oauth_signature("POST", request_url, form)

    def test_lti_signature_rejects_missing_or_bad_signature(self) -> None:
        service = self._service()
        with self.assertRaises(LTIError):
            service.validate_oauth_signature("POST", "https://codegrinder.example.com/lti/problem_sets/web/set-1", _launch_form())
        form = _launch_form()
        form["oauth_signature"] = ["bad"]
        with patch("lti.logging.warning") as log_warning:
            with self.assertRaises(LTIError):
                service.validate_oauth_signature("POST", "https://codegrinder.example.com/lti/problem_sets/web/set-1", form)
            self.assertTrue(log_warning.called)

    def test_lti_launch_creates_user_course_assignment_login_token(self) -> None:
        service = self._service()
        form = _launch_form()
        request_url = "https://codegrinder.example.com/lti/problem_sets/web/set-1"
        form["oauth_signature"] = [compute_oauth_signature("POST", request_url, form, self.config.lti_secret)]
        response = service.launch(
            method="POST",
            request_url=request_url,
            ui="web",
            unique="set-1",
            form=form,
            client_ip="127.0.0.1",
        )
        self.assertEqual(response.status, 303)
        query = parse_qs(urlsplit(response.location or "").query)
        self.assertIn("assignment", query)
        self.assertIn("token", query)
        self.assertEqual(query.get("course"), ["CSE101"])
        self.assertEqual(self.conn.execute("SELECT COUNT(*) AS n FROM user_sessions").fetchone()["n"], 0)
        user = self.conn.execute("SELECT * FROM users WHERE user_id = 'u-1'").fetchone()
        self.assertIsNotNone(user)
        course = self.conn.execute("SELECT * FROM courses WHERE course_id = 'course-1'").fetchone()
        self.assertIsNotNone(course)
        user_course = self.conn.execute(
            "SELECT * FROM user_courses WHERE user_id = 'u-1' AND course_id = 'course-1'"
        ).fetchone()
        self.assertIsNotNone(user_course)
        assignment = self.conn.execute(
            "SELECT * FROM assignments WHERE user_id = 'u-1' AND course_id = 'course-1' AND problem_set_id = 'set-1'"
        ).fetchone()
        self.assertIsNotNone(assignment)
        self.assertEqual(int(assignment["restricted"]), 0)

    def test_lti_launch_restricts_exam_ui_by_ip_for_non_instructor(self) -> None:
        service = self._service(ip_filter=IPFilter.from_entries(["10.0.0.0/24"]))
        form = _launch_form()
        request_url = "https://codegrinder.example.com/lti/problem_sets/exam/set-1"
        form["oauth_signature"] = [compute_oauth_signature("POST", request_url, form, self.config.lti_secret)]
        with self.assertRaises(LTIError) as ctx:
            service.launch("POST", request_url, "exam", "set-1", form, client_ip="127.0.0.1")
        self.assertEqual(ctx.exception.status, 403)

    def test_lti_launch_bootstrap_special_case(self) -> None:
        service = self._service()
        form = _launch_form()
        request_url = f"https://codegrinder.example.com/lti/problem_sets/cli/{BOOTSTRAP_ASSIGNMENT_NAME}"
        form["oauth_signature"] = [compute_oauth_signature("POST", request_url, form, self.config.lti_secret)]
        response = service.launch("POST", request_url, "cli", BOOTSTRAP_ASSIGNMENT_NAME, form, client_ip="127.0.0.1")
        self.assertEqual(response.status, 303)
        self.assertIn("assignment=", response.location or "")

    def test_daycare_registration_round_trip_and_version_payload(self) -> None:
        service = self._service()
        reg = {
            "hostname": "dc-1.example.invalid",
            "problemTypes": ["python3unittest"],
            "capacity": 2,
            "time": self.now.isoformat().replace("+00:00", "Z"),
            "version": "2.8.0",
        }
        reg["signature"] = compute_daycare_registration_signature(
            hostname=reg["hostname"],
            problem_types=list(reg["problemTypes"]),
            capacity=int(reg["capacity"]),
            when=self.now,
            version=reg["version"],
            secret=self.config.daycare_secret,
        )
        response = service.post_daycare_registration(reg)
        self.assertEqual(response.status, 200)
        snapshot = service.get_daycare_registrations()
        self.assertIn("dc-1.example.invalid", snapshot.body.decode("utf-8"))
        version_payload = service.get_version()
        self.assertEqual(version_payload.status, 200)
        self.assertIn("\"version\"", version_payload.body.decode("utf-8"))


if __name__ == "__main__":
    unittest.main()
