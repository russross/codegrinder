from __future__ import annotations

import sqlite3
import tempfile
import unittest
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Sequence, cast

import grpc

import codegrinder_pb2 as pb
from config import ServerConfig
from db import setup_db
from grpc_service import CodeGrinderService
from sessions import LoginRecords, encode_session, new_session


@dataclass(slots=True)
class _Meta:
    key: str
    value: str


class _AbortError(Exception):
    def __init__(self, code: grpc.StatusCode, details: str) -> None:
        super().__init__(details)
        self.code = code
        self.details = details


class _FakeContext:
    def __init__(self, md: Sequence[_Meta] | None = None, peer: str = "ipv4:127.0.0.1:55000") -> None:
        self._md = tuple(md or ())
        self._peer = peer

    def invocation_metadata(self) -> Sequence[_Meta]:
        return self._md

    def peer(self) -> str:
        return self._peer

    def abort(self, code: grpc.StatusCode, details: str) -> None:
        raise _AbortError(code, details)


def _apply_schema(conn: sqlite3.Connection) -> None:
    schema_path = Path(__file__).resolve().parents[2] / "setup" / "schema.sql"
    schema = schema_path.read_text(encoding="utf-8")
    conn.executescript(schema)


def _seed(conn: sqlite3.Connection) -> None:
    now = "2026-02-15T10:00:00+00:00"
    conn.execute("INSERT INTO problem_types(problem_type, container) VALUES (?, ?)", ("python3unittest", "img"))
    conn.execute(
        "INSERT INTO problem_type_actions(problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("python3unittest", "grade", "make grade", "xunit", 10, 100, 10, 256, 20),
    )
    conn.execute("INSERT INTO users(user_id, user_name, user_login) VALUES (?, ?, ?)", ("u1", "Student A", "stud"))
    conn.execute("INSERT INTO users(user_id, user_name, user_login) VALUES (?, ?, ?)", ("u2", "Instructor A", "inst"))
    conn.execute("INSERT INTO authors(user_id) VALUES (?)", ("u2",))
    conn.execute("INSERT INTO courses(course_id, course_name) VALUES (?, ?)", ("c1", "Course 101"))
    conn.execute("INSERT INTO user_courses(user_id, course_id, course_roles) VALUES (?, ?, ?)", ("u1", "c1", "Student"))
    conn.execute("INSERT INTO user_courses(user_id, course_id, course_roles) VALUES (?, ?, ?)", ("u2", "c1", "Instructor"))
    conn.execute(
        "INSERT INTO problems(problem_id, problem_note, problem_tags, problem_options, problem_created_at, problem_updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        ("p1", "Problem Note", '["tag"]', "[]", now, now),
    )
    conn.execute(
        "INSERT INTO problem_steps(problem_id, step_number, problem_type, step_note, step_instructions, step_weight) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        ("p1", 1, "python3unittest", "Step 1", "Step 1 Instructions", 1),
    )
    conn.execute(
        "INSERT INTO problem_steps(problem_id, step_number, problem_type, step_note, step_instructions, step_weight) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        ("p1", 2, "python3unittest", "Step 2", "Step 2 Instructions", 1),
    )
    conn.execute(
        "INSERT INTO problem_step_files(problem_id, step_number, path, content) VALUES (?, ?, ?, ?)",
        ("p1", 1, "main.py", b"print('step1')\n"),
    )
    conn.execute(
        "INSERT INTO problem_step_files(problem_id, step_number, path, content) VALUES (?, ?, ?, ?)",
        ("p1", 2, "helper.py", b"print('helper')\n"),
    )
    conn.execute(
        "INSERT INTO problem_step_files(problem_id, step_number, path, content) VALUES (?, ?, ?, ?)",
        ("p1", 2, "README.md", b"system file\n"),
    )
    conn.execute(
        "INSERT INTO problem_sets(problem_set_id, problem_set_note, problem_set_tags, problem_set_created_at, problem_set_updated_at) "
        "VALUES (?, ?, ?, ?, ?)",
        ("ps1", "Set Note", '["s"]', now, now),
    )
    conn.execute(
        "INSERT INTO problem_set_problems(problem_set_id, problem_id, problem_weight) VALUES (?, ?, ?)",
        ("ps1", "p1", 1),
    )
    conn.execute(
        "INSERT INTO assignments(user_id, course_id, problem_set_id, restricted, grade_id, outcome_url, outcome_ext_accepted, consumer_key, unlock_at, due_at, lock_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)",
        ("u1", "c1", "ps1", 0, "g1", "https://canvas.invalid/outcome", "text", "key"),
    )
    conn.execute(
        "INSERT INTO assignments(user_id, course_id, problem_set_id, restricted, grade_id, outcome_url, outcome_ext_accepted, consumer_key, unlock_at, due_at, lock_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)",
        ("u2", "c1", "ps1", 0, "g2", "https://canvas.invalid/outcome", "text", "key"),
    )
    conn.execute(
        "INSERT INTO commits(user_id, course_id, problem_set_id, problem_id, step_number, action, note, transcript, report_card, score, commit_created_at, commit_updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "u1",
            "c1",
            "ps1",
            "p1",
            1,
            "grade",
            "ok",
            "[]",
            '{"passed": true, "note": "ok", "duration": 0, "results": []}',
            1.0,
            now,
            now,
        ),
    )
    conn.execute(
        "INSERT INTO commit_files(user_id, course_id, problem_set_id, problem_id, step_number, path, content) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("u1", "c1", "ps1", "p1", 1, "main.py", b"print('done')\n"),
    )
    conn.commit()


class GrpcServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        (root / "files" / "python3unittest").mkdir(parents=True)
        (root / "files" / "python3unittest" / "Makefile").write_text("all:\n", encoding="utf-8")
        db_path = root / "db.sqlite"
        self.conn = setup_db(db_path)
        _apply_schema(self.conn)
        _seed(self.conn)
        self.config = ServerConfig(
            hostname="example.invalid",
            daycare_secret="daycare-secret",
            session_secret="session-secret",
            sessions_expire=[
                datetime(2020, 1, 1, 0, 0, 0, tzinfo=UTC),
                datetime(2020, 7, 1, 0, 0, 0, tzinfo=UTC),
            ],
            sqlite3_path=str(db_path),
        )
        self.logins = LoginRecords()
        self.service = CodeGrinderService(self.conn, self.config, root, login_records=self.logins)

    def tearDown(self) -> None:
        self.conn.close()
        self.tmp.cleanup()

    def _auth_context(self, user_id: str = "u1") -> _FakeContext:
        session = new_session(user_id, datetime(2026, 2, 15, 10, 0, 0, tzinfo=UTC), self.config.sessions_expire)
        cookie = encode_session(session, self.config.session_secret)
        return _FakeContext([_Meta("cookie", f"codegrinder={cookie}")])

    def _assignment_key(self) -> pb.AssignmentKey:
        return pb.AssignmentKey(user_id="u1", course_id="c1", problem_set_id="ps1")

    def test_hello_with_key_and_cookie(self) -> None:
        key = self.logins.insert("u1", datetime.now(tz=UTC))
        key_reply = self.service.Hello(pb.HelloRequest(key=key), cast(grpc.ServicerContext, _FakeContext()))
        self.assertIn("codegrinder=", key_reply.cookie)
        self.assertEqual(key_reply.user.user_id, "u1")
        cookie_reply = self.service.Hello(pb.HelloRequest(), cast(grpc.ServicerContext, self._auth_context("u1")))
        self.assertEqual(cookie_reply.user.user_id, "u1")

    def test_auth_required(self) -> None:
        with self.assertRaises(_AbortError) as err:
            self.service.GetAssignments(pb.GetAssignmentsRequest(), cast(grpc.ServicerContext, _FakeContext()))
        self.assertEqual(err.exception.code, grpc.StatusCode.UNAUTHENTICATED)

    def test_list_problems(self) -> None:
        reply = self.service.ListProblems(pb.ListProblemsRequest(), cast(grpc.ServicerContext, self._auth_context()))
        self.assertEqual(reply.user.user_id, "u1")
        self.assertEqual(len(reply.assignments), 1)
        self.assertEqual(reply.assignments[0].problem_set_id, "ps1")
        self.assertEqual(len(reply.courses), 1)
        self.assertEqual(len(reply.problem_sets), 1)

    def test_list_assignments_modes(self) -> None:
        student_ctx = cast(grpc.ServicerContext, self._auth_context("u1"))
        student_reply = self.service.ListAssignments(
            pb.ListAssignmentsRequest(search=[], include_student_context=False),
            student_ctx,
        )
        self.assertEqual(len(student_reply.items), 1)
        self.assertEqual(student_reply.items[0].assignment.user_id, "u1")
        self.assertEqual(student_reply.items[0].course_name, "Course 101")
        self.assertEqual(student_reply.items[0].problem_set_note, "Set Note")
        self.assertEqual(student_reply.items[0].user_name, "")
        self.assertEqual(student_reply.items[0].user_login, "")

        instructor_ctx = cast(grpc.ServicerContext, self._auth_context("u2"))
        instructor_reply = self.service.ListAssignments(
            pb.ListAssignmentsRequest(search=[], include_student_context=True),
            instructor_ctx,
        )
        self.assertEqual(len(instructor_reply.items), 2)
        returned_users = {item.assignment.user_id for item in instructor_reply.items}
        self.assertEqual(returned_users, {"u1", "u2"})
        first = instructor_reply.items[0]
        self.assertNotEqual(first.user_name, "")
        self.assertNotEqual(first.user_login, "")

    def test_search_problem_catalog_returns_nested_set_problem_steps(self) -> None:
        ctx = cast(grpc.ServicerContext, self._auth_context("u1"))
        reply = self.service.SearchProblemCatalog(
            pb.SearchProblemCatalogRequest(search=["set"]),
            ctx,
        )
        self.assertEqual(len(reply.problem_sets), 1)
        pset = reply.problem_sets[0]
        self.assertEqual(pset.problem_set_id, "ps1")
        self.assertEqual(pset.problem_set_note, "Set Note")
        self.assertEqual(len(pset.problems), 1)
        problem = pset.problems[0]
        self.assertEqual(problem.problem_id, "p1")
        self.assertEqual(problem.problem_weight, 1)
        self.assertEqual([step.step_number for step in problem.steps], [1, 2])

    def test_problem_and_step_reads(self) -> None:
        ctx = cast(grpc.ServicerContext, self._auth_context())
        problem = self.service.GetProblem(pb.GetProblemRequest(problem_id="p1"), ctx).problem
        self.assertEqual(problem.problem_id, "p1")
        steps = self.service.GetProblemSteps(pb.GetProblemStepsRequest(problem_id="p1"), ctx).problem_steps
        self.assertEqual(len(steps), 2)
        one_step = self.service.GetProblemStep(pb.GetProblemStepRequest(problem_id="p1", step=1), ctx).problem_step
        self.assertEqual(one_step.step, 1)

    def test_assignment_info_advances_current_step(self) -> None:
        ctx = cast(grpc.ServicerContext, self._auth_context())
        reply = self.service.GetAssignment(pb.GetAssignmentRequest(assignment=self._assignment_key()), ctx)
        self.assertEqual(reply.assignment.problem_set_id, "ps1")
        self.assertEqual(reply.course_name, "Course 101")
        self.assertEqual(reply.problem_set_note, "Set Note")
        self.assertEqual(len(reply.problems), 1)
        self.assertEqual(reply.problems[0].problem_id, "p1")
        self.assertEqual(reply.problems[0].current_step_number, 2)
        self.assertEqual(reply.problems[0].total_steps, 2)

    def test_step_files_current_falls_back_to_starter(self) -> None:
        ctx = cast(grpc.ServicerContext, self._auth_context())
        reply = self.service.GetAssignmentStepFiles(
            pb.GetAssignmentStepFilesRequest(
                assignment=self._assignment_key(),
                problem_id="p1",
                step_number=2,
                reset_to_step_start=False,
                include_contents=True,
            ),
            ctx,
        )
        self.assertEqual(reply.step_number, 2)
        self.assertEqual(reply.total_steps, 2)
        student_files = {item.path: item.content for item in reply.student_owned_files}
        self.assertEqual(student_files.get("main.py"), b"print('done')\n")
        self.assertEqual(student_files.get("helper.py"), b"print('helper')\n")

    def test_step_files_with_zero_step_uses_current_progress(self) -> None:
        ctx = cast(grpc.ServicerContext, self._auth_context())
        reply = self.service.GetAssignmentStepFiles(
            pb.GetAssignmentStepFilesRequest(
                assignment=self._assignment_key(),
                problem_id="p1",
                step_number=0,
                reset_to_step_start=False,
                include_contents=True,
            ),
            ctx,
        )
        self.assertEqual(reply.step_number, 2)

    def test_step_files_can_skip_contents(self) -> None:
        ctx = cast(grpc.ServicerContext, self._auth_context())
        reply = self.service.GetAssignmentStepFiles(
            pb.GetAssignmentStepFilesRequest(
                assignment=self._assignment_key(),
                problem_id="p1",
                step_number=2,
                reset_to_step_start=False,
                include_contents=False,
            ),
            ctx,
        )
        self.assertEqual([item.path for item in reply.system_owned_files], ["Makefile", "doc/index.html"])
        self.assertEqual([item.content for item in reply.system_owned_files], [b"", b""])
        self.assertEqual([item.path for item in reply.student_owned_files], ["README.md", "helper.py", "main.py"])
        self.assertEqual([item.content for item in reply.student_owned_files], [b"", b"", b""])

    def test_step_files_current_uses_saved_commit_when_present(self) -> None:
        now = "2026-02-16T10:00:00+00:00"
        self.conn.execute(
            "INSERT INTO commits(user_id, course_id, problem_set_id, problem_id, step_number, action, note, transcript, report_card, score, commit_created_at, commit_updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("u1", "c1", "ps1", "p1", 2, "", "sync", "[]", "null", 0.0, now, now),
        )
        self.conn.execute(
            "INSERT INTO commit_files(user_id, course_id, problem_set_id, problem_id, step_number, path, content) VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("u1", "c1", "ps1", "p1", 2, "main.py", b"print('step2-commit')\n"),
        )
        self.conn.commit()
        ctx = cast(grpc.ServicerContext, self._auth_context())
        reply = self.service.GetAssignmentStepFiles(
            pb.GetAssignmentStepFilesRequest(
                assignment=self._assignment_key(),
                problem_id="p1",
                step_number=2,
                reset_to_step_start=False,
                include_contents=True,
            ),
            ctx,
        )
        student_files = {item.path: item.content for item in reply.student_owned_files}
        self.assertEqual(student_files, {"main.py": b"print('step2-commit')\n"})

    def test_step_files_reset_uses_step_start_state(self) -> None:
        ctx = cast(grpc.ServicerContext, self._auth_context())
        reply = self.service.GetAssignmentStepFiles(
            pb.GetAssignmentStepFilesRequest(
                assignment=self._assignment_key(),
                problem_id="p1",
                step_number=2,
                reset_to_step_start=True,
                include_contents=True,
            ),
            ctx,
        )
        student_files = {item.path: item.content for item in reply.student_owned_files}
        self.assertEqual(student_files.get("main.py"), b"print('done')\n")
        self.assertEqual(student_files.get("helper.py"), b"print('helper')\n")


if __name__ == "__main__":
    unittest.main()
