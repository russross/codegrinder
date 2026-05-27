from __future__ import annotations

import sqlite3
import tempfile
import unittest
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Sequence, cast
from unittest.mock import patch

import grpc

import codegrinder_pb2 as pb
from config import ServerConfig
from daycare import DaycareRuntime
from db import setup_db
from grpc_service import CodeGrinderService
from problem_files import ProblemStepFileType
from signatures import decode_signed_runtime_bundle, encode_signed_runtime_bundle
from sessions import LoginTokens, create_session


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


def _mark_author_validation_passed(bundle: pb.ProblemBundle) -> None:
    for index, signed in enumerate(bundle.signed_validation_bundles):
        runtime = decode_signed_runtime_bundle(signed, "daycare-secret")
        runtime.commit.report_card.passed = True
        runtime.commit.score = 1.0
        bundle.solution_commits[index].CopyFrom(runtime.commit)
        bundle.signed_validation_bundles[index].CopyFrom(encode_signed_runtime_bundle(runtime, "daycare-secret"))


def _apply_schema(conn: sqlite3.Connection) -> None:
    schema_path = Path(__file__).resolve().parents[2] / "setup" / "schema.sql"
    schema = schema_path.read_text(encoding="utf-8")
    conn.executescript(schema)


def _seed(conn: sqlite3.Connection) -> None:
    now = "2026-02-15T10:00:00+00:00"
    conn.execute("INSERT INTO problem_types(problem_type, container) VALUES (?, ?)", ("python3unittest", "img"))
    conn.execute(
        "INSERT INTO problem_type_files(problem_type, path, content) VALUES (?, ?, ?)",
        ("python3unittest", "Makefile", b"all:\n"),
    )
    conn.execute(
        "INSERT INTO problem_type_actions(problem_type, action, command, parser, max_cpu, max_fd, max_file_size, max_memory, max_threads) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("python3unittest", "grade", "make grade", "xunit", 10, 100, 10, 256, 20),
    )
    conn.execute("INSERT INTO users(user_id, user_name, user_login) VALUES (?, ?, ?)", ("u1", "Student A", "stud"))
    conn.execute("INSERT INTO users(user_id, user_name, user_login) VALUES (?, ?, ?)", ("u2", "Instructor A", "inst"))
    conn.execute("INSERT INTO users(user_id, user_name, user_login, admin) VALUES (?, ?, ?, ?)", ("u-admin", "Admin A", "admin", 1))
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
        "INSERT INTO problem_steps(problem_id, step_number, problem_type, step_note, step_weight) "
        "VALUES (?, ?, ?, ?, ?)",
        ("p1", 1, "python3unittest", "Step 1", 1),
    )
    conn.execute(
        "INSERT INTO problem_steps(problem_id, step_number, problem_type, step_note, step_weight) "
        "VALUES (?, ?, ?, ?, ?)",
        ("p1", 2, "python3unittest", "Step 2", 1),
    )
    conn.execute(
        "INSERT INTO problem_step_files(problem_id, step_number, file_type, path, content) VALUES (?, ?, ?, ?, ?)",
        ("p1", 2, ProblemStepFileType.REGULAR, "README.md", b"system file\n"),
    )
    conn.execute(
        "INSERT INTO problem_step_files(problem_id, step_number, file_type, path, content) VALUES (?, ?, ?, ?, ?)",
        ("p1", 1, ProblemStepFileType.STARTER, "main.py", b"print('step1')\n"),
    )
    conn.execute(
        "INSERT INTO problem_step_files(problem_id, step_number, file_type, path, content) VALUES (?, ?, ?, ?, ?)",
        ("p1", 2, ProblemStepFileType.STARTER, "main.py", b"print('step2-reset')\n"),
    )
    conn.execute(
        "INSERT INTO problem_step_files(problem_id, step_number, file_type, path, content) VALUES (?, ?, ?, ?, ?)",
        ("p1", 2, ProblemStepFileType.STARTER, "helper.py", b"print('helper')\n"),
    )
    conn.execute(
        "INSERT INTO problem_step_files(problem_id, step_number, file_type, path, content) VALUES (?, ?, ?, ?, ?)",
        ("p1", 1, ProblemStepFileType.SOLUTION, "main.py", b"print('step1-solution')\n"),
    )
    conn.execute(
        "INSERT INTO problem_step_files(problem_id, step_number, file_type, path, content) VALUES (?, ?, ?, ?, ?)",
        ("p1", 2, ProblemStepFileType.SOLUTION, "main.py", b"print('step2-main')\n"),
    )
    conn.execute(
        "INSERT INTO problem_step_files(problem_id, step_number, file_type, path, content) VALUES (?, ?, ?, ?, ?)",
        ("p1", 2, ProblemStepFileType.SOLUTION, "helper.py", b"print('helper')\n"),
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
        "INSERT INTO assignments(user_id, course_id, problem_set_id, assignment_title, restricted, grade_id, outcome_url, outcome_ext_accepted, consumer_key, unlock_at, due_at, lock_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)",
        ("u1", "c1", "ps1", "Canvas Set Note", 0, "g1", "https://canvas.invalid/outcome", "text", "key"),
    )
    conn.execute(
        "INSERT INTO assignments(user_id, course_id, problem_set_id, assignment_title, restricted, grade_id, outcome_url, outcome_ext_accepted, consumer_key, unlock_at, due_at, lock_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)",
        ("u2", "c1", "ps1", "Instructor Canvas Set Note", 0, "g2", "https://canvas.invalid/outcome", "text", "key"),
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
            daycare_mount_dir=str(root / "daycare-mounts"),
        )
        self.login_tokens = LoginTokens()
        daycare = DaycareRuntime(self.config, validate_mount=False)
        self.service = CodeGrinderService(self.conn, self.config, login_tokens=self.login_tokens, daycare=daycare)

    def tearDown(self) -> None:
        self.conn.close()
        self.tmp.cleanup()

    def _auth_context(self, user_id: str = "u1") -> _FakeContext:
        session = create_session(
            self.conn,
            user_id,
            datetime(2026, 2, 15, 10, 0, 0, tzinfo=UTC),
            self.config.sessions_expire,
            self.config.session_secret,
        )
        return _FakeContext([_Meta("authorization", f"Bearer {session.session_key}")])

    def _assignment_key(self) -> pb.AssignmentKey:
        return pb.AssignmentKey(user_id="u1", course_id="c1", problem_set_id="ps1")

    def test_hello_with_token_and_session_key(self) -> None:
        token = self.login_tokens.insert("u1", datetime.now(tz=UTC))
        token_reply = self.service.Hello(pb.HelloRequest(token=token), cast(grpc.ServicerContext, _FakeContext()))
        self.assertTrue(token_reply.session_key)
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) AS n FROM user_sessions").fetchone()["n"],
            1,
        )
        self.assertEqual(token_reply.user_id, "u1")
        self.assertFalse(token_reply.is_author)
        self.assertFalse(token_reply.is_instructor)
        self.assertFalse(token_reply.is_admin)
        session_reply = self.service.Hello(pb.HelloRequest(), cast(grpc.ServicerContext, self._auth_context("u1")))
        self.assertEqual(session_reply.user_id, "u1")

        instructor_reply = self.service.Hello(pb.HelloRequest(), cast(grpc.ServicerContext, self._auth_context("u2")))
        self.assertEqual(instructor_reply.user_id, "u2")
        self.assertTrue(instructor_reply.is_author)
        self.assertTrue(instructor_reply.is_instructor)
        self.assertFalse(instructor_reply.is_admin)

        admin_reply = self.service.Hello(pb.HelloRequest(), cast(grpc.ServicerContext, self._auth_context("u-admin")))
        self.assertEqual(admin_reply.user_id, "u-admin")
        self.assertFalse(admin_reply.is_author)
        self.assertFalse(admin_reply.is_instructor)
        self.assertTrue(admin_reply.is_admin)

    def test_auth_required(self) -> None:
        with self.assertRaises(_AbortError) as err:
            self.service.ListAssignments(pb.ListAssignmentsRequest(), cast(grpc.ServicerContext, _FakeContext()))
        self.assertEqual(err.exception.code, grpc.StatusCode.UNAUTHENTICATED)

    def test_save_problem_type_files_requires_admin(self) -> None:
        request = pb.SaveProblemTypeFilesRequest(
            problem_type="python3unittest",
            files={"Makefile": b"updated:\n"},
        )

        with self.assertRaises(_AbortError) as err:
            self.service.SaveProblemTypeFiles(request, cast(grpc.ServicerContext, self._auth_context("u2")))

        self.assertEqual(err.exception.code, grpc.StatusCode.PERMISSION_DENIED)

    def test_save_problem_type_files_replaces_file_set(self) -> None:
        self.conn.execute(
            "INSERT INTO problem_type_files(problem_type, path, content) VALUES (?, ?, ?)",
            ("python3unittest", "old.py", b"old\n"),
        )
        request = pb.SaveProblemTypeFilesRequest(
            problem_type="python3unittest",
            files={
                "Makefile": b"updated:\n",
                "tests/test_example.py": b"def test_example():\n    assert True\n",
            },
        )

        response = self.service.SaveProblemTypeFiles(request, cast(grpc.ServicerContext, self._auth_context("u-admin")))

        self.assertEqual(response.problem_type.files["Makefile"], b"updated:\n")
        self.assertNotIn("old.py", response.problem_type.files)
        self.assertEqual(response.problem_type.files["tests/test_example.py"], b"def test_example():\n    assert True\n")

    def test_save_problem_type_files_rejects_duplicate_normalized_paths(self) -> None:
        request = pb.SaveProblemTypeFilesRequest(
            problem_type="python3unittest",
            files={
                "tests/new.py": b"a\n",
                "tests/./new.py": b"b\n",
            },
        )

        with self.assertRaises(_AbortError) as err:
            self.service.SaveProblemTypeFiles(request, cast(grpc.ServicerContext, self._auth_context("u-admin")))

        self.assertEqual(err.exception.code, grpc.StatusCode.INVALID_ARGUMENT)

    def test_save_problem_type_requires_admin(self) -> None:
        request = pb.SaveProblemTypeRequest(
            problem_type="newtype",
            container="codegrinder/new",
        )

        with self.assertRaises(_AbortError) as err:
            self.service.SaveProblemType(request, cast(grpc.ServicerContext, self._auth_context("u2")))

        self.assertEqual(err.exception.code, grpc.StatusCode.PERMISSION_DENIED)

    def test_save_problem_type_upserts_type_and_replaces_actions(self) -> None:
        create_request = pb.SaveProblemTypeRequest(
            problem_type="newtype",
            container="codegrinder/new",
            actions={
                "grade": pb.ProblemTypeAction(
                        command="make grade",
                        parser="xunit",
                        max_cpu=10,
                        max_fd=100,
                        max_file_size=10,
                        max_memory=256,
                        max_threads=20,
                )
            },
        )

        created = self.service.SaveProblemType(create_request, cast(grpc.ServicerContext, self._auth_context("u-admin")))

        newtype = next(problem_type for problem_type in created.problem_types if problem_type.problem_type == "newtype")
        self.assertEqual(newtype.container, "codegrinder/new")
        self.assertEqual(newtype.actions["grade"].command, "make grade")

        update_request = pb.SaveProblemTypeRequest(
            problem_type="newtype",
            container="codegrinder/newer",
            actions={
                "step": pb.ProblemTypeAction(
                        command="make test",
                        parser="check",
                        max_cpu=20,
                        max_fd=101,
                        max_file_size=11,
                        max_memory=512,
                        max_threads=21,
                )
            },
        )

        updated = self.service.SaveProblemType(update_request, cast(grpc.ServicerContext, self._auth_context("u-admin")))

        newtype = next(problem_type for problem_type in updated.problem_types if problem_type.problem_type == "newtype")
        self.assertEqual(newtype.container, "codegrinder/newer")
        self.assertNotIn("grade", newtype.actions)
        self.assertEqual(newtype.actions["step"].command, "make test")
        self.assertEqual(newtype.actions["step"].parser, "check")

    def test_save_problem_type_update_does_not_delete_referenced_type(self) -> None:
        request = pb.SaveProblemTypeRequest(
            problem_type="python3unittest",
            container="codegrinder/python:new",
            actions={
                "grade": pb.ProblemTypeAction(
                    command="make grade",
                    parser="xunit",
                    max_cpu=11,
                    max_fd=101,
                    max_file_size=11,
                    max_memory=257,
                    max_threads=21,
                )
            },
        )

        response = self.service.SaveProblemType(request, cast(grpc.ServicerContext, self._auth_context("u-admin")))

        problem_type = next(item for item in response.problem_types if item.problem_type == "python3unittest")
        self.assertEqual(problem_type.container, "codegrinder/python:new")
        self.assertEqual(problem_type.actions["grade"].max_cpu, 11)
        cursor = self.conn.execute("SELECT problem_type FROM problem_steps WHERE problem_id = ? AND step_number = ?", ("p1", 1))
        self.assertEqual(cursor.fetchone()[0], "python3unittest")

    def test_list_assignments_modes(self) -> None:
        student_ctx = cast(grpc.ServicerContext, self._auth_context("u1"))
        student_reply = self.service.ListAssignments(
            pb.ListAssignmentsRequest(search=[], include_student_context=False),
            student_ctx,
        )
        self.assertEqual(len(student_reply.items), 1)
        self.assertEqual(student_reply.items[0].assignment.user_id, "u1")
        self.assertEqual(student_reply.items[0].course_name, "Course 101")
        self.assertEqual(student_reply.items[0].assignment_title, "Canvas Set Note")
        self.assertEqual(student_reply.items[0].problem_set_note, "Set Note")
        self.assertAlmostEqual(student_reply.items[0].assignment_score, 0.5)
        self.assertEqual(student_reply.items[0].user_name, "")
        self.assertEqual(student_reply.items[0].user_login, "")
        self.assertEqual(student_reply.items[0].download_status, pb.ASSIGNMENT_DOWNLOAD_STATUS_AVAILABLE)
        self.assertEqual([problem.problem_id for problem in student_reply.items[0].problems], ["p1"])

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



    def test_assignment_info_advances_current_step(self) -> None:
        ctx = cast(grpc.ServicerContext, self._auth_context())
        reply = self.service.GetAssignment(pb.GetAssignmentRequest(assignment=self._assignment_key()), ctx)
        self.assertEqual(reply.assignment.problem_set_id, "ps1")
        self.assertEqual(reply.course_name, "Course 101")
        self.assertEqual(reply.problem_set_note, "Set Note")
        self.assertEqual(reply.download_status, pb.ASSIGNMENT_DOWNLOAD_STATUS_AVAILABLE)
        self.assertEqual(len(reply.problems), 1)
        self.assertEqual(reply.problems[0].problem_id, "p1")
        self.assertEqual(reply.problems[0].current_step_number, 2)
        self.assertEqual(reply.problems[0].first_step_number, 1)
        self.assertEqual(reply.problems[0].last_step_number, 2)

    def test_continuation_problem_set_reports_prereq_not_ready(self) -> None:
        now = "2026-02-15T10:00:00+00:00"
        self.conn.execute(
            "INSERT INTO problem_sets(problem_set_id, problem_set_note, problem_set_tags, problem_set_created_at, problem_set_updated_at) "
            "VALUES (?, ?, ?, ?, ?)",
            ("ps-part-1", "Part 1", "[]", now, now),
        )
        self.conn.execute(
            "INSERT INTO problem_sets(problem_set_id, problem_set_note, problem_set_tags, continues_problem_set_id, problem_set_created_at, problem_set_updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            ("ps-part-2", "Part 2", "[]", "ps-part-1", now, now),
        )
        self.conn.execute(
            "INSERT INTO problem_set_problems(problem_set_id, problem_id, problem_weight, first_step, last_step) VALUES (?, ?, ?, ?, ?)",
            ("ps-part-1", "p1", 1, 1, 1),
        )
        self.conn.execute(
            "INSERT INTO problem_set_problems(problem_set_id, problem_id, problem_weight, first_step, last_step) VALUES (?, ?, ?, ?, ?)",
            ("ps-part-2", "p1", 1, 2, 2),
        )
        self.conn.execute(
            "INSERT INTO assignments(user_id, course_id, problem_set_id, restricted, grade_id, outcome_url, outcome_ext_accepted, consumer_key, unlock_at, due_at, lock_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)",
            ("u1", "c1", "ps-part-2", 0, "g-part-2", "https://canvas.invalid/outcome", "text", "key"),
        )
        self.conn.commit()
        ctx = cast(grpc.ServicerContext, self._auth_context())

        listed = self.service.ListAssignments(pb.ListAssignmentsRequest(search=["part-2"], include_student_context=False), ctx)

        self.assertEqual(listed.items[0].download_status, pb.ASSIGNMENT_DOWNLOAD_STATUS_PREREQ_NOT_READY)
        self.assertEqual(listed.items[0].prerequisite_problem_set_id, "ps-part-1")

        summary = self.service.GetAssignment(
            pb.GetAssignmentRequest(assignment=pb.AssignmentKey(user_id="u1", course_id="c1", problem_set_id="ps-part-2")),
            ctx,
        )
        self.assertEqual(summary.download_status, pb.ASSIGNMENT_DOWNLOAD_STATUS_PREREQ_NOT_READY)
        self.assertEqual(summary.prerequisite_problem_set_id, "ps-part-1")

    def test_continuation_problem_set_reports_missing_intermediate_prereq(self) -> None:
        now = "2026-02-15T10:00:00+00:00"
        self.conn.execute(
            "INSERT INTO problem_steps(problem_id, step_number, problem_type, step_note, step_weight) "
            "VALUES (?, ?, ?, ?, ?)",
            ("p1", 3, "python3unittest", "Step 3", 1),
        )
        for problem_set_id, note, continues in (
            ("ps-part-1", "Part 1", None),
            ("ps-part-2", "Part 2", "ps-part-1"),
            ("ps-part-3", "Part 3", "ps-part-2"),
        ):
            self.conn.execute(
                "INSERT INTO problem_sets(problem_set_id, problem_set_note, problem_set_tags, continues_problem_set_id, problem_set_created_at, problem_set_updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (problem_set_id, note, "[]", continues, now, now),
            )
        for problem_set_id, step_number in (("ps-part-1", 1), ("ps-part-2", 2), ("ps-part-3", 3)):
            self.conn.execute(
                "INSERT INTO problem_set_problems(problem_set_id, problem_id, problem_weight, first_step, last_step) VALUES (?, ?, ?, ?, ?)",
                (problem_set_id, "p1", 1, step_number, step_number),
            )
        for problem_set_id, grade_id in (("ps-part-1", "g-part-1"), ("ps-part-3", "g-part-3")):
            self.conn.execute(
                "INSERT INTO assignments(user_id, course_id, problem_set_id, restricted, grade_id, outcome_url, outcome_ext_accepted, consumer_key, unlock_at, due_at, lock_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)",
                ("u1", "c1", problem_set_id, 0, grade_id, "https://canvas.invalid/outcome", "text", "key"),
            )
        self.conn.execute(
            "INSERT INTO commits(user_id, course_id, problem_set_id, problem_id, step_number, action, note, transcript, report_card, score, commit_created_at, commit_updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("u1", "c1", "ps-part-1", "p1", 1, "grade", "ok", "[]", '{"passed": true}', 1.0, now, now),
        )
        self.conn.commit()
        ctx = cast(grpc.ServicerContext, self._auth_context())

        listed = self.service.ListAssignments(pb.ListAssignmentsRequest(search=["part-3"], include_student_context=False), ctx)

        self.assertEqual(len(listed.items), 1)
        self.assertEqual(listed.items[0].assignment.problem_set_id, "ps-part-3")
        self.assertEqual(listed.items[0].download_status, pb.ASSIGNMENT_DOWNLOAD_STATUS_PREREQ_NOT_READY)
        self.assertEqual(listed.items[0].prerequisite_problem_set_id, "ps-part-2")

    def test_continuation_problem_set_uses_previous_slice_commit_as_start(self) -> None:
        now = "2026-02-15T10:00:00+00:00"
        self.conn.execute(
            "INSERT INTO problem_step_files(problem_id, step_number, file_type, path, content) VALUES (?, ?, ?, ?, ?)",
            ("p1", 2, ProblemStepFileType.SOLUTION, "carry.py", b"print('carry solution')\n"),
        )
        self.conn.execute(
            "INSERT INTO problem_sets(problem_set_id, problem_set_note, problem_set_tags, problem_set_created_at, problem_set_updated_at) "
            "VALUES (?, ?, ?, ?, ?)",
            ("ps-part-1", "Part 1", "[]", now, now),
        )
        self.conn.execute(
            "INSERT INTO problem_sets(problem_set_id, problem_set_note, problem_set_tags, continues_problem_set_id, problem_set_created_at, problem_set_updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            ("ps-part-2", "Part 2", "[]", "ps-part-1", now, now),
        )
        self.conn.execute(
            "INSERT INTO problem_set_problems(problem_set_id, problem_id, problem_weight, first_step, last_step) VALUES (?, ?, ?, ?, ?)",
            ("ps-part-1", "p1", 1, 1, 1),
        )
        self.conn.execute(
            "INSERT INTO problem_set_problems(problem_set_id, problem_id, problem_weight, first_step, last_step) VALUES (?, ?, ?, ?, ?)",
            ("ps-part-2", "p1", 1, 2, 2),
        )
        for problem_set_id, grade_id in (("ps-part-1", "g-part-1"), ("ps-part-2", "g-part-2")):
            self.conn.execute(
                "INSERT INTO assignments(user_id, course_id, problem_set_id, restricted, grade_id, outcome_url, outcome_ext_accepted, consumer_key, unlock_at, due_at, lock_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)",
                ("u1", "c1", problem_set_id, 0, grade_id, "https://canvas.invalid/outcome", "text", "key"),
            )
        self.conn.execute(
            "INSERT INTO commits(user_id, course_id, problem_set_id, problem_id, step_number, action, note, transcript, report_card, score, commit_created_at, commit_updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("u1", "c1", "ps-part-1", "p1", 1, "grade", "ok", "[]", '{"passed": true}', 1.0, now, now),
        )
        self.conn.execute(
            "INSERT INTO commit_files(user_id, course_id, problem_set_id, problem_id, step_number, path, content) VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("u1", "c1", "ps-part-1", "p1", 1, "carry.py", b"print('carried')\n"),
        )
        self.conn.commit()
        ctx = cast(grpc.ServicerContext, self._auth_context())

        reply = self.service.GetWorkspace(
            pb.GetWorkspaceRequest(
                assignment=pb.AssignmentKey(user_id="u1", course_id="c1", problem_set_id="ps-part-2"),
                problem_id="p1",
                step_number=0,
                file_state=pb.WORKSPACE_FILE_STATE_CURRENT,
                include_contents=True,
                include_solution_files=False,
            ),
            ctx,
        )

        self.assertEqual(reply.step_number, 2)
        self.assertEqual(reply.first_step_number, 2)
        self.assertEqual(reply.last_step_number, 2)
        student_files = dict(reply.student_owned_files)
        self.assertEqual(student_files.get("carry.py"), b"print('carried')\n")
        self.assertEqual(student_files.get("main.py"), b"print('step2-reset')\n")

    def test_step_files_current_falls_back_to_starter(self) -> None:
        ctx = cast(grpc.ServicerContext, self._auth_context())
        reply = self.service.GetWorkspace(
            pb.GetWorkspaceRequest(
                assignment=self._assignment_key(),
                problem_id="p1",
                step_number=2,
                file_state=pb.WORKSPACE_FILE_STATE_CURRENT,
                include_contents=True,
                include_solution_files=False,
            ),
            ctx,
        )
        self.assertEqual(reply.step_number, 2)
        self.assertEqual(reply.first_step_number, 1)
        self.assertEqual(reply.last_step_number, 2)
        student_files = dict(reply.student_owned_files)
        self.assertEqual(student_files.get("main.py"), b"print('step2-reset')\n")
        self.assertEqual(student_files.get("helper.py"), b"print('helper')\n")

    def test_step_files_with_zero_step_uses_current_progress(self) -> None:
        ctx = cast(grpc.ServicerContext, self._auth_context())
        reply = self.service.GetWorkspace(
            pb.GetWorkspaceRequest(
                assignment=self._assignment_key(),
                problem_id="p1",
                step_number=0,
                file_state=pb.WORKSPACE_FILE_STATE_CURRENT,
                include_contents=True,
                include_solution_files=False,
            ),
            ctx,
        )
        self.assertEqual(reply.step_number, 2)

    def test_step_files_rejects_invalid_file_state(self) -> None:
        ctx = cast(grpc.ServicerContext, self._auth_context())
        with self.assertRaises(_AbortError) as err:
            self.service.GetWorkspace(
                pb.GetWorkspaceRequest(
                    assignment=self._assignment_key(),
                    problem_id="p1",
                    step_number=2,
                    file_state=cast(pb.WorkspaceFileState.ValueType, 99),
                    include_contents=True,
                    include_solution_files=False,
                ),
                ctx,
            )
        self.assertEqual(err.exception.code, grpc.StatusCode.INVALID_ARGUMENT)

    def test_step_files_can_skip_contents(self) -> None:
        ctx = cast(grpc.ServicerContext, self._auth_context())
        reply = self.service.GetWorkspace(
            pb.GetWorkspaceRequest(
                assignment=self._assignment_key(),
                problem_id="p1",
                step_number=2,
                file_state=pb.WORKSPACE_FILE_STATE_CURRENT,
                include_contents=False,
                include_solution_files=False,
            ),
            ctx,
        )
        self.assertEqual(dict(reply.system_owned_files), {"Makefile": b"", "README.md": b""})
        self.assertEqual(dict(reply.student_owned_files), {"helper.py": b"", "main.py": b""})

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
        reply = self.service.GetWorkspace(
            pb.GetWorkspaceRequest(
                assignment=self._assignment_key(),
                problem_id="p1",
                step_number=2,
                file_state=pb.WORKSPACE_FILE_STATE_CURRENT,
                include_contents=True,
                include_solution_files=False,
            ),
            ctx,
        )
        student_files = dict(reply.student_owned_files)
        self.assertEqual(student_files, {"main.py": b"print('step2-commit')\n"})

    def test_step_files_reset_uses_step_start_state(self) -> None:
        ctx = cast(grpc.ServicerContext, self._auth_context())
        reply = self.service.GetWorkspace(
            pb.GetWorkspaceRequest(
                assignment=self._assignment_key(),
                problem_id="p1",
                step_number=2,
                file_state=pb.WORKSPACE_FILE_STATE_STEP_START,
                include_contents=True,
                include_solution_files=False,
            ),
            ctx,
        )
        student_files = dict(reply.student_owned_files)
        self.assertEqual(student_files.get("main.py"), b"print('step2-reset')\n")
        self.assertEqual(student_files.get("helper.py"), b"print('helper')\n")

    def test_instructor_can_request_solution_files_for_course_assignment(self) -> None:
        ctx = cast(grpc.ServicerContext, self._auth_context("u2"))

        reply = self.service.GetWorkspace(
            pb.GetWorkspaceRequest(
                assignment=self._assignment_key(),
                problem_id="p1",
                step_number=2,
                file_state=pb.WORKSPACE_FILE_STATE_CURRENT,
                include_contents=True,
                include_solution_files=True,
            ),
            ctx,
        )

        self.assertEqual(dict(reply.solution_files), {"helper.py": b"print('helper')\n", "main.py": b"print('step2-main')\n"})

    def test_save_workspace_commit_persists_student_files_without_grading_artifacts(self) -> None:
        now = datetime(2026, 2, 16, 10, 0, 0, tzinfo=UTC)
        commit = pb.Commit(
            assignment=self._assignment_key(),
            problem_id="p1",
            step=2,
            note="grind sync",
            files={"main.py": b"print('sync')\n", "helper.py": b"print('helper')\n"},
            transcript=[pb.EventMessage(event="reportcard")],
            report_card=pb.ReportCard(passed=True, note="should be ignored"),
            score=1.0,
            created_at=now,
            updated_at=now,
        )

        reply = self.service.SaveWorkspaceCommit(
            pb.SaveWorkspaceCommitRequest(commit=commit),
            cast(grpc.ServicerContext, self._auth_context()),
        )

        self.assertEqual(reply.save_status, pb.COMMIT_SAVE_STATUS_SAVED)
        row = self.conn.execute(
            "SELECT action, note, transcript, report_card, score FROM commits "
            "WHERE user_id = ? AND course_id = ? AND problem_set_id = ? AND problem_id = ? AND step_number = ?",
            ("u1", "c1", "ps1", "p1", 2),
        ).fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(dict(row), {"action": "", "note": "grind sync", "transcript": "[]", "report_card": "null", "score": 0.0})
        files = self.conn.execute(
            "SELECT path, content FROM commit_files "
            "WHERE user_id = ? AND course_id = ? AND problem_set_id = ? AND problem_id = ? AND step_number = ? "
            "ORDER BY path",
            ("u1", "c1", "ps1", "p1", 2),
        ).fetchall()
        self.assertEqual([(row["path"], row["content"]) for row in files], [("helper.py", b"print('helper')\n"), ("main.py", b"print('sync')\n")])

    def test_save_workspace_commit_rejects_action_requests(self) -> None:
        commit = pb.Commit(
            assignment=self._assignment_key(),
            problem_id="p1",
            step=2,
            action="grade",
            note="bad sync",
            files={"main.py": b"print('bad')\n", "helper.py": b"print('helper')\n"},
        )

        with self.assertRaises(_AbortError) as err:
            self.service.SaveWorkspaceCommit(
                pb.SaveWorkspaceCommitRequest(commit=commit),
                cast(grpc.ServicerContext, self._auth_context()),
            )

        self.assertEqual(err.exception.code, grpc.StatusCode.INVALID_ARGUMENT)

    def test_save_graded_commit_returns_empty_success_response(self) -> None:
        now = datetime(2026, 2, 16, 10, 0, 0, tzinfo=UTC)
        commit = pb.Commit(
            assignment=self._assignment_key(),
            problem_id="p1",
            step=1,
            action="grade",
            note="graded",
            files={"main.py": b"print('graded')\n"},
            report_card=pb.ReportCard(passed=True, note="ok"),
            score=1.0,
            created_at=now,
            updated_at=now,
        )
        runtime = pb.RuntimeBundle(
            hostname="example.invalid",
            user_id="u1",
            assignment=self._assignment_key(),
            problem_id="p1",
            problem_note="Problem Note",
            problem_options=[],
            step_number=1,
            total_steps=2,
            action="grade",
            container="img",
            command="make grade",
            parser="xunit",
            limits=pb.RuntimeLimits(max_cpu=10, max_fd=100, max_file_size=10, max_memory=256, max_threads=20),
            files={"Makefile": b"all:\n", "main.py": b"print('graded')\n"},
            commit=commit,
        )
        signed = encode_signed_runtime_bundle(runtime, "daycare-secret")
        ctx = cast(grpc.ServicerContext, self._auth_context())
        reply = self.service.SaveGradedCommit(pb.SaveGradedCommitRequest(bundle=signed), ctx)
        self.assertEqual(reply.save_status, pb.COMMIT_SAVE_STATUS_SAVED)

    def test_non_owner_student_cannot_save_to_another_students_assignment(self) -> None:
        self.conn.execute("INSERT INTO users(user_id, user_name, user_login) VALUES (?, ?, ?)", ("u3", "Student B", "stud-b"))
        self.conn.execute("INSERT INTO user_courses(user_id, course_id, course_roles) VALUES (?, ?, ?)", ("u3", "c1", "Student"))
        self.conn.commit()
        commit = pb.Commit(
            assignment=self._assignment_key(),
            problem_id="p1",
            step=2,
            action="",
            note="student attempt",
            files={"main.py": b"print('bad')\n", "helper.py": b"print('helper')\n"},
        )

        with self.assertRaises(_AbortError):
            self.service.SaveUngradedCommit(
                pb.SaveUngradedCommitRequest(commit=pb.GradingCommit(user_id="u3", commit=commit)),
                cast(grpc.ServicerContext, self._auth_context("u3")),
            )
        row = self.conn.execute(
            "SELECT COUNT(1) AS c FROM commits WHERE user_id = ? AND course_id = ? AND problem_set_id = ? AND problem_id = ? AND step_number = ?",
            ("u1", "c1", "ps1", "p1", 2),
        ).fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(int(row["c"]), 0)

    def test_ungraded_commit_does_not_post_grade_passback(self) -> None:
        commit = pb.Commit(
            assignment=self._assignment_key(),
            problem_id="p1",
            step=2,
            action="grade",
            note="pre-grade save",
            files={"main.py": b"print('attempt')\n", "helper.py": b"print('helper')\n"},
        )
        with patch("grpc_service.save_grade_async") as save_grade:
            reply = self.service.SaveUngradedCommit(
                pb.SaveUngradedCommitRequest(commit=pb.GradingCommit(user_id="u1", commit=commit)),
                cast(grpc.ServicerContext, self._auth_context("u1")),
            )

        self.assertEqual(reply.save_status, pb.COMMIT_SAVE_STATUS_SAVED)
        save_grade.assert_not_called()

    def test_instructor_can_grade_student_assignment_without_persisting_commit(self) -> None:
        now = datetime(2026, 2, 16, 10, 0, 0, tzinfo=UTC)
        assignment = self._assignment_key()
        ungraded_commit = pb.Commit(
            assignment=assignment,
            problem_id="p1",
            step=2,
            action="grade",
            note="instructor run",
            files={"main.py": b"print('instructor')\n", "helper.py": b"print('helper')\n"},
            created_at=now,
            updated_at=now,
        )
        ctx = cast(grpc.ServicerContext, self._auth_context("u2"))
        ungraded = self.service.SaveUngradedCommit(
            pb.SaveUngradedCommitRequest(commit=pb.GradingCommit(user_id="u2", commit=ungraded_commit)),
            ctx,
        )
        self.assertTrue(ungraded.HasField("bundle"))

        graded_commit = pb.Commit()
        graded_commit.CopyFrom(ungraded_commit)
        graded_commit.report_card.CopyFrom(pb.ReportCard(passed=True, note="ok"))
        graded_commit.score = 1.0
        runtime = pb.RuntimeBundle(
            hostname="example.invalid",
            user_id="u2",
            assignment=assignment,
            problem_id="p1",
            problem_note="Problem Note",
            problem_options=[],
            step_number=2,
            total_steps=2,
            action="grade",
            container="img",
            command="make grade",
            parser="xunit",
            limits=pb.RuntimeLimits(max_cpu=10, max_fd=100, max_file_size=10, max_memory=256, max_threads=20),
            files={"Makefile": b"all:\n", "main.py": b"print('instructor')\n", "helper.py": b"print('helper')\n"},
            commit=graded_commit,
        )
        signed = encode_signed_runtime_bundle(runtime, "daycare-secret")
        reply = self.service.SaveGradedCommit(pb.SaveGradedCommitRequest(bundle=signed), ctx)
        self.assertEqual(reply.save_status, pb.COMMIT_SAVE_STATUS_NOT_SAVED_NOT_OWNER)

        commit_row = self.conn.execute(
            "SELECT COUNT(1) AS c FROM commits WHERE user_id = ? AND course_id = ? AND problem_set_id = ? AND problem_id = ? AND step_number = ?",
            ("u1", "c1", "ps1", "p1", 2),
        ).fetchone()
        file_row = self.conn.execute(
            "SELECT COUNT(1) AS c FROM commit_files WHERE user_id = ? AND course_id = ? AND problem_set_id = ? AND problem_id = ? AND step_number = ?",
            ("u1", "c1", "ps1", "p1", 2),
        ).fetchone()
        self.assertIsNotNone(commit_row)
        self.assertIsNotNone(file_row)
        self.assertEqual(int(commit_row["c"]), 0)
        self.assertEqual(int(file_row["c"]), 0)

    def test_future_unlock_marks_assignment_unavailable_and_blocks_workspace_download(self) -> None:
        self.conn.execute(
            "UPDATE assignments SET unlock_at = ? WHERE user_id = ? AND course_id = ? AND problem_set_id = ?",
            ("2999-02-15T10:00:00Z", "u1", "c1", "ps1"),
        )
        self.conn.commit()
        ctx = cast(grpc.ServicerContext, self._auth_context())
        listed = self.service.ListAssignments(pb.ListAssignmentsRequest(search=[], include_student_context=False), ctx)
        self.assertEqual(len(listed.items), 1)
        self.assertEqual(listed.items[0].download_status, pb.ASSIGNMENT_DOWNLOAD_STATUS_NOT_OPEN)
        summary = self.service.GetAssignment(pb.GetAssignmentRequest(assignment=self._assignment_key()), ctx)
        self.assertEqual(summary.download_status, pb.ASSIGNMENT_DOWNLOAD_STATUS_NOT_OPEN)

        with self.assertRaises(_AbortError) as err:
            self.service.GetWorkspace(
                pb.GetWorkspaceRequest(
                    assignment=self._assignment_key(),
                    problem_id="p1",
                    step_number=2,
                    file_state=pb.WORKSPACE_FILE_STATE_CURRENT,
                    include_contents=True,
                    include_solution_files=False,
                ),
                ctx,
            )
        self.assertEqual(err.exception.code, grpc.StatusCode.PERMISSION_DENIED)

    def test_locked_assignment_can_run_daycare_but_does_not_persist(self) -> None:
        self.conn.execute(
            "UPDATE assignments SET lock_at = ? WHERE user_id = ? AND course_id = ? AND problem_set_id = ?",
            ("2020-02-15T10:00:00Z", "u1", "c1", "ps1"),
        )
        self.conn.commit()
        assignment = self._assignment_key()
        ungraded_commit = pb.Commit(
            assignment=assignment,
            problem_id="p1",
            step=2,
            action="grade",
            note="locked run",
            files={"main.py": b"print('locked')\n", "helper.py": b"print('helper')\n"},
        )
        ctx = cast(grpc.ServicerContext, self._auth_context("u1"))
        ungraded = self.service.SaveUngradedCommit(
            pb.SaveUngradedCommitRequest(commit=pb.GradingCommit(user_id="u1", commit=ungraded_commit)),
            ctx,
        )
        self.assertEqual(ungraded.save_status, pb.COMMIT_SAVE_STATUS_NOT_SAVED_LOCKED)
        self.assertTrue(ungraded.HasField("bundle"))

        graded_commit = pb.Commit()
        graded_commit.CopyFrom(ungraded_commit)
        graded_commit.report_card.CopyFrom(pb.ReportCard(passed=True, note="ok"))
        graded_commit.score = 1.0
        runtime = pb.RuntimeBundle(
            hostname="example.invalid",
            user_id="u1",
            assignment=assignment,
            problem_id="p1",
            problem_note="Problem Note",
            problem_options=[],
            step_number=2,
            total_steps=2,
            action="grade",
            container="img",
            command="make grade",
            parser="xunit",
            limits=pb.RuntimeLimits(max_cpu=10, max_fd=100, max_file_size=10, max_memory=256, max_threads=20),
            files={"Makefile": b"all:\n", "main.py": b"print('locked')\n", "helper.py": b"print('helper')\n"},
            commit=graded_commit,
        )
        signed = encode_signed_runtime_bundle(runtime, "daycare-secret")
        graded = self.service.SaveGradedCommit(pb.SaveGradedCommitRequest(bundle=signed), ctx)
        self.assertEqual(graded.save_status, pb.COMMIT_SAVE_STATUS_NOT_SAVED_LOCKED)

        commit_row = self.conn.execute(
            "SELECT COUNT(1) AS c FROM commits WHERE user_id = ? AND course_id = ? AND problem_set_id = ? AND problem_id = ? AND step_number = ?",
            ("u1", "c1", "ps1", "p1", 2),
        ).fetchone()
        file_row = self.conn.execute(
            "SELECT COUNT(1) AS c FROM commit_files WHERE user_id = ? AND course_id = ? AND problem_set_id = ? AND problem_id = ? AND step_number = ?",
            ("u1", "c1", "ps1", "p1", 2),
        ).fetchone()
        self.assertIsNotNone(commit_row)
        self.assertIsNotNone(file_row)
        self.assertEqual(int(commit_row["c"]), 0)
        self.assertEqual(int(file_row["c"]), 0)

    def test_instructor_own_assignment_persists_like_student_flow(self) -> None:
        now = datetime(2026, 2, 16, 10, 0, 0, tzinfo=UTC)
        assignment = pb.AssignmentKey(user_id="u2", course_id="c1", problem_set_id="ps1")
        commit = pb.Commit(
            assignment=assignment,
            problem_id="p1",
            step=2,
            action="grade",
            note="instructor own grade",
            files={"main.py": b"print('own')\n", "helper.py": b"print('helper')\n"},
            report_card=pb.ReportCard(passed=True, note="ok"),
            score=1.0,
            created_at=now,
            updated_at=now,
        )
        runtime = pb.RuntimeBundle(
            hostname="example.invalid",
            user_id="u2",
            assignment=assignment,
            problem_id="p1",
            problem_note="Problem Note",
            problem_options=[],
            step_number=2,
            total_steps=2,
            action="grade",
            container="img",
            command="make grade",
            parser="xunit",
            limits=pb.RuntimeLimits(max_cpu=10, max_fd=100, max_file_size=10, max_memory=256, max_threads=20),
            files={"Makefile": b"all:\n", "main.py": b"print('own')\n", "helper.py": b"print('helper')\n"},
            commit=commit,
        )
        signed = encode_signed_runtime_bundle(runtime, "daycare-secret")
        ctx = cast(grpc.ServicerContext, self._auth_context("u2"))
        self.service.SaveGradedCommit(pb.SaveGradedCommitRequest(bundle=signed), ctx)

        row = self.conn.execute(
            "SELECT note, score FROM commits WHERE user_id = ? AND course_id = ? AND problem_set_id = ? AND problem_id = ? AND step_number = ?",
            ("u2", "c1", "ps1", "p1", 2),
        ).fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(str(row["note"]), "instructor own grade")
        self.assertEqual(float(row["score"]), 1.0)


    def test_prepare_problem_overlays_type_files_then_filters_gitignore(self) -> None:
        self.conn.execute(
            "INSERT INTO problem_type_files(problem_type, path, content) VALUES (?, ?, ?)",
            ("python3unittest", ".gitignore", b"ignored.txt\n"),
        )
        author_ctx = cast(grpc.ServicerContext, self._auth_context("u2"))
        reply = self.service.PrepareProblem(
            pb.PrepareProblemRequest(
                draft=pb.AuthorProblemDraft(
                    problem_id="overlay-problem",
                    problem_note="Overlay Problem",
                    problem_tags=["author"],
                    problem_options=[],
                    steps=[
                        pb.AuthorProblemStepDraft(
                            step_number=1,
                            problem_type="python3unittest",
                            note="Step 1",
                            weight=1.0,
                            files=[
                                pb.AuthorFile(path="Makefile", content=b"stale author copy\n"),
                                pb.AuthorFile(path="README.md", content=b"keep me\n"),
                                pb.AuthorFile(path="ignored.txt", content=b"drop me\n"),
                                pb.AuthorFile(path="subdir/.gitignore", content=b"*.tmp\n"),
                                pb.AuthorFile(path="subdir/keep.txt", content=b"keep\n"),
                                pb.AuthorFile(path="subdir/skip.tmp", content=b"drop\n"),
                                pb.AuthorFile(path="main.py", content=b"print('solution')\n"),
                            ],
                            starter_files=[pb.AuthorFile(path="main.py", content=b"print('starter')\n")],
                        )
                    ],
                )
            ),
            author_ctx,
        )
        step = reply.bundle.problem_steps[0]
        self.assertEqual(
            dict(step.files),
            {
                "README.md": b"keep me\n",
                "subdir/.gitignore": b"*.tmp\n",
                "subdir/keep.txt": b"keep\n",
            },
        )
        self.assertEqual(dict(step.starter_files), {"main.py": b"print('starter')\n"})
        self.assertEqual(dict(reply.bundle.solution_commits[0].files), {"main.py": b"print('solution')\n"})
        self.assertEqual(reply.bundle.problem_types["python3unittest"].files["Makefile"], b"all:\n")

    def test_prepare_problem_allows_later_step_starter_reset_for_existing_student_file(self) -> None:
        author_ctx = cast(grpc.ServicerContext, self._auth_context("u2"))
        reply = self.service.PrepareProblem(
            pb.PrepareProblemRequest(
                draft=pb.AuthorProblemDraft(
                    problem_id="reset-problem",
                    problem_note="Reset Problem",
                    problem_tags=[],
                    problem_options=[],
                    steps=[
                        pb.AuthorProblemStepDraft(
                            step_number=1,
                            problem_type="python3unittest",
                            note="Step 1",
                            weight=1.0,
                            files=[pb.AuthorFile(path="main.py", content=b"print('step1-solution')\n")],
                            starter_files=[pb.AuthorFile(path="main.py", content=b"print('step1-starter')\n")],
                        ),
                        pb.AuthorProblemStepDraft(
                            step_number=2,
                            problem_type="python3unittest",
                            note="Step 2",
                            weight=1.0,
                            files=[pb.AuthorFile(path="main.py", content=b"print('step2-solution')\n")],
                            starter_files=[pb.AuthorFile(path="main.py", content=b"print('step2-reset')\n")],
                        ),
                    ],
                )
            ),
            author_ctx,
        )
        step_two = reply.bundle.problem_steps[1]
        self.assertEqual(dict(step_two.starter_files), {"main.py": b"print('step2-reset')\n"})
        self.assertEqual(dict(step_two.whitelist), {"main.py": True})
        self.assertEqual(dict(reply.bundle.solution_commits[1].files), {"main.py": b"print('step2-solution')\n"})

    def test_prepare_and_save_problem_persist_starter_and_solution_files(self) -> None:
        author_ctx = cast(grpc.ServicerContext, self._auth_context("u2"))
        prepared = self.service.PrepareProblem(
            pb.PrepareProblemRequest(
                draft=pb.AuthorProblemDraft(
                    problem_id="prepared-problem",
                    problem_note="Prepared Problem",
                    problem_tags=[],
                    problem_options=[],
                    steps=[
                        pb.AuthorProblemStepDraft(
                            step_number=1,
                            problem_type="python3unittest",
                            note="Step 1",
                            weight=1.0,
                            files=[
                                pb.AuthorFile(path="README.md", content=b"system file\n"),
                                pb.AuthorFile(path="main.py", content=b"print('solution')\n"),
                            ],
                            starter_files=[pb.AuthorFile(path="main.py", content=b"print('starter')\n")],
                        )
                    ],
                )
            ),
            author_ctx,
        )
        _mark_author_validation_passed(prepared.bundle)
        saved = self.service.SaveProblem(
            pb.SaveProblemRequest(mode=pb.SAVE_MODE_CREATE, bundle=prepared.bundle),
            author_ctx,
        )
        self.assertEqual(saved.bundle.problem.problem_id, "prepared-problem")
        file_rows = self.conn.execute(
            "SELECT file_type, path, content FROM problem_step_files WHERE problem_id = ?",
            ("prepared-problem",),
        ).fetchall()
        self.assertEqual(
            sorted(
                [(str(row["file_type"]), str(row["path"]), bytes(row["content"])) for row in file_rows],
                key=lambda item: (item[1], {"regular": 0, "starter": 1, "solution": 2}[item[0]]),
            ),
            [
                ("regular", "README.md", b"system file\n"),
                ("starter", "main.py", b"print('starter')\n"),
                ("solution", "main.py", b"print('solution')\n"),
            ],
        )
        with self.assertRaises(_AbortError) as err:
            self.service.SaveProblem(
                pb.SaveProblemRequest(mode=pb.SAVE_MODE_CREATE, bundle=prepared.bundle),
                author_ctx,
            )
        self.assertEqual(err.exception.code, grpc.StatusCode.INVALID_ARGUMENT)

    def test_save_problem_create_persists_matching_problem_set(self) -> None:
        author_ctx = cast(grpc.ServicerContext, self._auth_context("u2"))
        prepared = self.service.PrepareProblem(
            pb.PrepareProblemRequest(
                draft=pb.AuthorProblemDraft(
                    problem_id="default-set-problem",
                    problem_note="Default Set Problem",
                    problem_tags=["auto"],
                    problem_options=[],
                    steps=[
                        pb.AuthorProblemStepDraft(
                            step_number=1,
                            problem_type="python3unittest",
                            note="Step 1",
                            weight=1.0,
                            files=[pb.AuthorFile(path="main.py", content=b"print('solution')\n")],
                            starter_files=[pb.AuthorFile(path="main.py", content=b"print('starter')\n")],
                        )
                    ],
                )
            ),
            author_ctx,
        )
        _mark_author_validation_passed(prepared.bundle)

        self.service.SaveProblem(
            pb.SaveProblemRequest(mode=pb.SAVE_MODE_CREATE, bundle=prepared.bundle),
            author_ctx,
        )

        problem_set = self.conn.execute(
            "SELECT problem_set_id, problem_set_note, problem_set_tags FROM problem_sets WHERE problem_set_id = ?",
            ("default-set-problem",),
        ).fetchone()
        problem_set_problem = self.conn.execute(
            "SELECT problem_set_id, problem_id, problem_weight, first_step, last_step "
            "FROM problem_set_problems WHERE problem_set_id = ?",
            ("default-set-problem",),
        ).fetchone()
        self.assertIsNotNone(problem_set)
        self.assertEqual(str(problem_set["problem_set_note"]), "Default Set Problem")
        self.assertEqual(str(problem_set["problem_set_tags"]), '["auto"]')
        self.assertIsNotNone(problem_set_problem)
        self.assertEqual(str(problem_set_problem["problem_id"]), "default-set-problem")
        self.assertEqual(int(problem_set_problem["problem_weight"]), 1)
        self.assertIsNone(problem_set_problem["first_step"])
        self.assertIsNone(problem_set_problem["last_step"])

    def test_save_problem_rejects_unvalidated_author_bundle(self) -> None:
        author_ctx = cast(grpc.ServicerContext, self._auth_context("u2"))
        prepared = self.service.PrepareProblem(
            pb.PrepareProblemRequest(
                draft=pb.AuthorProblemDraft(
                    problem_id="unvalidated-problem",
                    problem_note="Unvalidated Problem",
                    steps=[
                        pb.AuthorProblemStepDraft(
                            step_number=1,
                            problem_type="python3unittest",
                            note="Step 1",
                            weight=1.0,
                            files=[pb.AuthorFile(path="main.py", content=b"print('solution')\n")],
                            starter_files=[pb.AuthorFile(path="main.py", content=b"print('starter')\n")],
                        )
                    ],
                )
            ),
            author_ctx,
        )

        with self.assertRaises(_AbortError) as err:
            self.service.SaveProblem(
                pb.SaveProblemRequest(mode=pb.SAVE_MODE_CREATE, bundle=prepared.bundle),
                author_ctx,
            )

        self.assertEqual(err.exception.code, grpc.StatusCode.INVALID_ARGUMENT)
        self.assertIn("validation has no report card", err.exception.details)
        row = self.conn.execute("SELECT COUNT(1) AS c FROM problems WHERE problem_id = ?", ("unvalidated-problem",)).fetchone()
        self.assertEqual(int(row["c"]), 0)

    def test_save_problem_rejects_files_changed_after_validation(self) -> None:
        author_ctx = cast(grpc.ServicerContext, self._auth_context("u2"))
        prepared = self.service.PrepareProblem(
            pb.PrepareProblemRequest(
                draft=pb.AuthorProblemDraft(
                    problem_id="tampered-problem",
                    problem_note="Tampered Problem",
                    steps=[
                        pb.AuthorProblemStepDraft(
                            step_number=1,
                            problem_type="python3unittest",
                            note="Step 1",
                            weight=1.0,
                            files=[
                                pb.AuthorFile(path="README.md", content=b"validated docs\n"),
                                pb.AuthorFile(path="main.py", content=b"print('solution')\n"),
                            ],
                            starter_files=[pb.AuthorFile(path="main.py", content=b"print('starter')\n")],
                        )
                    ],
                )
            ),
            author_ctx,
        )
        _mark_author_validation_passed(prepared.bundle)
        prepared.bundle.problem_steps[0].files["README.md"] = b"changed after validation\n"

        with self.assertRaises(_AbortError) as err:
            self.service.SaveProblem(
                pb.SaveProblemRequest(mode=pb.SAVE_MODE_CREATE, bundle=prepared.bundle),
                author_ctx,
            )

        self.assertEqual(err.exception.code, grpc.StatusCode.INVALID_ARGUMENT)
        self.assertIn("validated runtime files mismatch", err.exception.details)
        row = self.conn.execute("SELECT COUNT(1) AS c FROM problems WHERE problem_id = ?", ("tampered-problem",)).fetchone()
        self.assertEqual(int(row["c"]), 0)

    def test_save_problem_rejects_starter_files_changed_after_validation(self) -> None:
        author_ctx = cast(grpc.ServicerContext, self._auth_context("u2"))
        prepared = self.service.PrepareProblem(
            pb.PrepareProblemRequest(
                draft=pb.AuthorProblemDraft(
                    problem_id="tampered-starter-problem",
                    problem_note="Tampered Starter Problem",
                    steps=[
                        pb.AuthorProblemStepDraft(
                            step_number=1,
                            problem_type="python3unittest",
                            note="Step 1",
                            weight=1.0,
                            files=[pb.AuthorFile(path="main.py", content=b"print('solution')\n")],
                            starter_files=[pb.AuthorFile(path="main.py", content=b"print('starter')\n")],
                        )
                    ],
                )
            ),
            author_ctx,
        )
        _mark_author_validation_passed(prepared.bundle)
        prepared.bundle.problem_steps[0].starter_files["main.py"] = b"changed starter\n"

        with self.assertRaises(_AbortError) as err:
            self.service.SaveProblem(
                pb.SaveProblemRequest(mode=pb.SAVE_MODE_CREATE, bundle=prepared.bundle),
                author_ctx,
            )

        self.assertEqual(err.exception.code, grpc.StatusCode.INVALID_ARGUMENT)
        self.assertIn("validated starter files mismatch", err.exception.details)
        row = self.conn.execute(
            "SELECT COUNT(1) AS c FROM problems WHERE problem_id = ?",
            ("tampered-starter-problem",),
        ).fetchone()
        self.assertEqual(int(row["c"]), 0)

    def test_save_problem_update_preserves_created_at(self) -> None:
        author_ctx = cast(grpc.ServicerContext, self._auth_context("u2"))
        prepared = self.service.PrepareProblem(
            pb.PrepareProblemRequest(
                draft=pb.AuthorProblemDraft(
                    problem_id="update-problem",
                    problem_note="Original Note",
                    problem_tags=[],
                    problem_options=[],
                    steps=[
                        pb.AuthorProblemStepDraft(
                            step_number=1,
                            problem_type="python3unittest",
                            note="Step 1",
                            weight=1.0,
                            files=[pb.AuthorFile(path="main.py", content=b"print('solution')\n")],
                            starter_files=[pb.AuthorFile(path="main.py", content=b"print('starter')\n")],
                        )
                    ],
                )
            ),
            author_ctx,
        )
        _mark_author_validation_passed(prepared.bundle)
        saved = self.service.SaveProblem(
            pb.SaveProblemRequest(mode=pb.SAVE_MODE_CREATE, bundle=prepared.bundle),
            author_ctx,
        )
        original_created_at = saved.bundle.problem.created_at.ToDatetime(tzinfo=UTC)

        prepared = self.service.PrepareProblem(
            pb.PrepareProblemRequest(
                draft=pb.AuthorProblemDraft(
                    problem_id="update-problem",
                    problem_note="Updated Note",
                    problem_tags=[],
                    problem_options=[],
                    steps=[
                        pb.AuthorProblemStepDraft(
                            step_number=1,
                            problem_type="python3unittest",
                            note="Updated Step 1",
                            weight=1.0,
                            files=[pb.AuthorFile(path="main.py", content=b"print('solution')\n")],
                            starter_files=[pb.AuthorFile(path="main.py", content=b"print('starter')\n")],
                        )
                    ],
                )
            ),
            author_ctx,
        )
        _mark_author_validation_passed(prepared.bundle)

        updated = self.service.SaveProblem(
            pb.SaveProblemRequest(mode=pb.SAVE_MODE_UPDATE, bundle=prepared.bundle),
            author_ctx,
        )
        self.assertEqual(updated.bundle.problem.problem_note, "Updated Note")
        self.assertEqual(
            updated.bundle.problem.created_at.ToDatetime(tzinfo=UTC).replace(microsecond=0),
            original_created_at.replace(microsecond=0),
        )
        row = self.conn.execute(
            "SELECT problem_note, problem_created_at FROM problems WHERE problem_id = ?",
            ("update-problem",),
        ).fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(str(row["problem_note"]), "Updated Note")
        self.assertEqual(datetime.fromisoformat(str(row["problem_created_at"])), original_created_at.replace(microsecond=0))

    def test_problem_step_file_type_constraint_rejects_invalid_value(self) -> None:
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute(
                "INSERT INTO problem_step_files(problem_id, step_number, file_type, path, content) VALUES (?, ?, ?, ?, ?)",
                ("p1", 1, "bogus", "bad.txt", b"bad\n"),
            )


if __name__ == "__main__":
    unittest.main()
