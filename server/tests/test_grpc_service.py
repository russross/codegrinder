from __future__ import annotations

import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Sequence, cast

import grpc

import codegrinder_pb2 as pb
from config import ServerConfig
from db import setup_db
from grpc_service import CodeGrinderService, RecoveryInterceptor
from mutations import compute_commit_signature
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


class _InterceptorContext(_FakeContext):
    def __init__(self) -> None:
        super().__init__([])
        self._code: grpc.StatusCode | None = grpc.StatusCode.OK

    def code(self) -> grpc.StatusCode | None:
        return self._code

    def abort(self, code: grpc.StatusCode, details: str) -> None:
        self._code = code
        raise Exception(details)


@dataclass(slots=True)
class _HandlerCallDetails:
    method: str


def _apply_schema(conn: sqlite3.Connection) -> None:
    schema_path = Path(__file__).resolve().parents[2] / "setup" / "schema.sql"
    if not schema_path.exists():
        raise unittest.SkipTest(f"schema fixture not present at {schema_path}")
    schema = schema_path.read_text(encoding="utf-8")
    conn.executescript(schema)


def _seed(conn: sqlite3.Connection) -> None:
    now = "2026-02-15T10:00:00+00:00"
    conn.execute("INSERT INTO problem_types(name, image) VALUES (?, ?)", ("python3unittest", "img"))
    conn.execute(
        "INSERT INTO problem_type_actions(problem_type, action, command, parser, message, interactive, max_cpu, max_session, max_timeout, max_fd, max_file_size, max_memory, max_threads) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("python3unittest", "grade", "make grade", "xunit", "msg", 0, 10, 20, 20, 100, 10, 256, 20),
    )
    conn.execute(
        "INSERT INTO users(id, name, email, lti_id, lti_image_url, canvas_login, canvas_id, author, admin, created_at, updated_at, last_signed_in_at) "
        "VALUES (1, 'Student A', 'student@example.invalid', 'u1', '', 'stud', 11, 0, 0, ?, ?, ?)",
        (now, now, now),
    )
    conn.execute(
        "INSERT INTO users(id, name, email, lti_id, lti_image_url, canvas_login, canvas_id, author, admin, created_at, updated_at, last_signed_in_at) "
        "VALUES (2, 'Instructor A', 'instructor@example.invalid', 'u2', '', 'inst', 12, 1, 0, ?, ?, ?)",
        (now, now, now),
    )
    conn.execute(
        "INSERT INTO courses(id, name, lti_label, lti_id, canvas_id, created_at, updated_at) VALUES (1, 'Course 101', 'C101', 'course-1', 100, ?, ?)",
        (now, now),
    )
    conn.execute(
        "INSERT INTO problems(id, unique_id, note, tags, options, created_at, updated_at) VALUES (1, 'prob-1', 'Problem Note', ?, ?, ?, ?)",
        ('["tag"]', "[]", now, now),
    )
    conn.execute(
        "INSERT INTO problem_steps(problem_id, step, problem_type, note, instructions, weight, whitelist) VALUES (1, 1, 'python3unittest', 'Step Note', 'Step Instructions', 1.0, ?)",
        ('{"main.py": true}',),
    )
    conn.execute(
        "INSERT INTO problem_step_files(problem_id, step, path, content) VALUES (1, 1, 'main.py', ?)",
        (b"print('hello')\n",),
    )
    conn.execute(
        "INSERT INTO problem_sets(id, unique_id, note, tags, created_at, updated_at) VALUES (1, 'set-1', 'Set Note', ?, ?, ?)",
        ('["s"]', now, now),
    )
    conn.execute(
        "INSERT INTO problem_set_problems(problem_set_id, problem_id, weight) VALUES (1, 1, 1.0)"
    )
    conn.execute(
        "INSERT INTO assignments(id, course_id, problem_set_id, user_id, roles, instructor, restricted, raw_scores, score, grade_id, lti_id, canvas_title, canvas_id, canvas_api_domain, outcome_url, outcome_ext_url, outcome_ext_accepted, finished_url, consumer_key, unlock_at, due_at, lock_at, created_at, updated_at) "
        "VALUES (1, 1, 1, 1, 'Student', 0, 0, ?, 1.0, 'g1', 'l1', 'Asst', 201, 'canvas.invalid', '', '', '', '', 'key', NULL, NULL, NULL, ?, ?)",
        ('{"prob-1": [1.0]}', now, now),
    )
    conn.execute(
        "INSERT INTO assignments(id, course_id, problem_set_id, user_id, roles, instructor, restricted, raw_scores, score, grade_id, lti_id, canvas_title, canvas_id, canvas_api_domain, outcome_url, outcome_ext_url, outcome_ext_accepted, finished_url, consumer_key, unlock_at, due_at, lock_at, created_at, updated_at) "
        "VALUES (2, 1, 1, 2, 'Instructor', 1, 0, ?, 1.0, 'g2', 'l2', 'Asst', 202, 'canvas.invalid', '', '', '', '', 'key', NULL, NULL, NULL, ?, ?)",
        ('{"prob-1": [1.0]}', now, now),
    )
    conn.execute(
        "INSERT INTO commits(id, assignment_id, problem_id, step, action, note, transcript, report_card, score, created_at, updated_at) VALUES (1, 1, 1, 1, 'grade', '', '[]', ?, 1.0, ?, ?)",
        ('{"passed": true, "note": "ok", "duration": 0, "results": []}', now, now),
    )
    conn.execute(
        "INSERT INTO commit_files(commit_id, path, content) VALUES (1, 'main.py', ?)",
        (b"print('hello')\n",),
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

    def _auth_context(self, user_id: int = 1) -> _FakeContext:
        session = new_session(user_id, datetime(2026, 2, 15, 10, 0, 0, tzinfo=UTC), self.config.sessions_expire)
        cookie = encode_session(session, self.config.session_secret)
        return _FakeContext([_Meta("cookie", f"codegrinder={cookie}")])

    def _build_problem_bundle(self, unique: str, user_id: int = 2) -> pb.ProblemBundle:
        at = datetime(2026, 2, 15, 10, 0, 0, tzinfo=UTC)
        return pb.ProblemBundle(
            problem=pb.Problem(
                id=0,
                unique=unique,
                note="Problem Draft",
                tags=["tag-b", "tag-a"],
                options=["opt-z", "opt-a"],
                created_at=at,
                updated_at=at,
            ),
            problem_steps=[
                pb.ProblemStep(
                    step=1,
                    problem_type="python3unittest",
                    note="Step Draft",
                    instructions="Run tests",
                    weight=1.0,
                    files={"main.py": b"print('x')\r\n"},
                    whitelist={"main.py": True},
                )
            ],
            user_id=user_id,
            commits=[
                pb.Commit(
                    assignment_id=0,
                    problem_id=0,
                    step=1,
                    action="grade",
                    note="",
                    files={"main.py": b"print('x')\r\n"},
                    score=0.0,
                    created_at=at,
                    updated_at=at,
                )
            ],
        )

    def _sign_problem_bundle_commit(self, bundle: pb.ProblemBundle) -> None:
        now = datetime.now(tz=UTC)
        bundle.commits[0].updated_at.FromDatetime(now)
        bundle.commits[0].report_card.CopyFrom(
            pb.ReportCard(
                passed=True,
                note="ok",
                results=[pb.ReportCardResult(name="check", outcome="passed")],
            )
        )
        bundle.commits[0].score = 1.0
        bundle.commit_signatures[:] = [
            compute_commit_signature(
                bundle.commits[0],
                bundle.problem_type_signatures["python3unittest"],
                bundle.problem_signature,
                bundle.hostname,
                bundle.user_id,
                self.config.daycare_secret,
            )
        ]

    def test_hello_with_key(self) -> None:
        key = self.logins.insert(1, datetime.now(tz=UTC))
        reply = self.service.Hello(pb.HelloRequest(key=key), cast(grpc.ServicerContext, _FakeContext()))
        self.assertIn("codegrinder=", reply.cookie)
        self.assertEqual(reply.user.id, 1)
        self.assertEqual(reply.version.version, "2.8.0")

    def test_hello_with_cookie(self) -> None:
        reply = self.service.Hello(
            pb.HelloRequest(), cast(grpc.ServicerContext, self._auth_context())
        )
        self.assertEqual(reply.user.id, 1)
        self.assertEqual(reply.version.version, "2.8.0")

    def test_get_version(self) -> None:
        reply = self.service.GetVersion(pb.GetVersionRequest(), cast(grpc.ServicerContext, _FakeContext()))
        self.assertEqual(reply.version.version, "2.8.0")

    def test_list_problems(self) -> None:
        reply = self.service.ListProblems(
            pb.ListProblemsRequest(), cast(grpc.ServicerContext, self._auth_context())
        )
        self.assertEqual(reply.user.id, 1)
        self.assertEqual(len(reply.assignments), 1)
        self.assertEqual(len(reply.courses), 1)
        self.assertEqual(len(reply.problem_sets), 1)

    def test_list_problems_tolerates_invalid_assignment_raw_scores_json(self) -> None:
        self.conn.execute("UPDATE assignments SET raw_scores = ? WHERE id = 1", (" ",))
        self.conn.commit()

        reply = self.service.ListProblems(
            pb.ListProblemsRequest(), cast(grpc.ServicerContext, self._auth_context())
        )
        self.assertEqual(len(reply.assignments), 1)
        self.assertEqual(dict(reply.assignments[0].raw_scores), {})

    def test_problem_reads(self) -> None:
        ctx = self._auth_context()
        gctx = cast(grpc.ServicerContext, ctx)
        self.assertEqual(len(self.service.GetProblemTypes(pb.GetProblemTypesRequest(), gctx).problem_types), 1)
        self.assertEqual(self.service.GetProblemType(pb.GetProblemTypeRequest(name="python3unittest"), gctx).problem_type.name, "python3unittest")
        self.assertEqual(len(self.service.GetProblems(pb.GetProblemsRequest(), gctx).problems), 1)
        self.assertEqual(self.service.GetProblem(pb.GetProblemRequest(problem_id=1), gctx).problem.id, 1)
        self.assertEqual(len(self.service.GetProblemSteps(pb.GetProblemStepsRequest(problem_id=1), gctx).problem_steps), 1)
        self.assertEqual(self.service.GetProblemStep(pb.GetProblemStepRequest(problem_id=1, step=1), gctx).problem_step.step, 1)

    def test_problem_reads_tolerate_invalid_json_shapes(self) -> None:
        self.conn.execute("UPDATE problems SET tags = ?, options = ? WHERE id = 1", ('{"bad":true}', '{"x":1}'))
        self.conn.execute("UPDATE problem_steps SET whitelist = ? WHERE problem_id = 1 AND step = 1", ("[]",))
        self.conn.commit()

        gctx = cast(grpc.ServicerContext, self._auth_context())
        problem = self.service.GetProblem(pb.GetProblemRequest(problem_id=1), gctx).problem
        step = self.service.GetProblemStep(pb.GetProblemStepRequest(problem_id=1, step=1), gctx).problem_step
        self.assertEqual(list(problem.tags), [])
        self.assertEqual(list(problem.options), [])
        self.assertEqual(dict(step.whitelist), {})

    def test_get_problem_step_missing_returns_not_found(self) -> None:
        gctx = cast(grpc.ServicerContext, self._auth_context())
        with self.assertRaises(_AbortError) as err:
            _ = self.service.GetProblemStep(pb.GetProblemStepRequest(problem_id=1, step=2), gctx)
        self.assertEqual(err.exception.code, grpc.StatusCode.NOT_FOUND)

    def test_problem_set_reads(self) -> None:
        ctx = self._auth_context()
        gctx = cast(grpc.ServicerContext, ctx)
        self.assertEqual(len(self.service.GetProblemSets(pb.GetProblemSetsRequest(), gctx).problem_sets), 1)
        self.assertEqual(self.service.GetProblemSet(pb.GetProblemSetRequest(problem_set_id=1), gctx).problem_set.id, 1)
        self.assertEqual(len(self.service.GetProblemSetProblems(pb.GetProblemSetProblemsRequest(problem_set_id=1), gctx).problem_set_problems), 1)

    def test_user_course_assignment_reads(self) -> None:
        ctx_student = self._auth_context()
        ctx_instructor = self._auth_context(user_id=2)
        self.assertEqual(
            len(self.service.GetCourses(pb.GetCoursesRequest(), cast(grpc.ServicerContext, ctx_student)).courses), 1
        )
        self.assertEqual(
            self.service.GetCourse(pb.GetCourseRequest(course_id=1), cast(grpc.ServicerContext, ctx_student)).course.id,
            1,
        )
        self.assertEqual(
            len(self.service.GetUsers(pb.GetUsersRequest(), cast(grpc.ServicerContext, ctx_instructor)).users), 2
        )
        self.assertEqual(self.service.GetUserMe(pb.GetUserMeRequest(), cast(grpc.ServicerContext, ctx_student)).user.id, 1)
        self.assertEqual(
            self.service.GetUser(pb.GetUserRequest(user_id=1), cast(grpc.ServicerContext, ctx_student)).user.id, 1
        )
        self.assertEqual(
            len(
                self.service.GetCourseUsers(
                    pb.GetCourseUsersRequest(course_id=1), cast(grpc.ServicerContext, ctx_instructor)
                ).users
            ),
            2,
        )
        self.assertEqual(
            len(
                self.service.GetUserAssignments(
                    pb.GetUserAssignmentsRequest(user_id=1), cast(grpc.ServicerContext, ctx_student)
                ).assignments
            ),
            1,
        )
        self.assertEqual(
            len(
                self.service.GetCourseUserAssignments(
                    pb.GetCourseUserAssignmentsRequest(course_id=1, user_id=1),
                    cast(grpc.ServicerContext, ctx_instructor),
                ).assignments
            ),
            1,
        )
        self.assertEqual(
            len(self.service.GetAssignments(pb.GetAssignmentsRequest(search=[]), cast(grpc.ServicerContext, ctx_student)).assignments),
            1,
        )
        self.assertEqual(
            self.service.GetAssignment(pb.GetAssignmentRequest(assignment_id=1), cast(grpc.ServicerContext, ctx_student)).assignment.id,
            1,
        )

    def test_get_assignment_missing_returns_not_found(self) -> None:
        gctx = cast(grpc.ServicerContext, self._auth_context())
        with self.assertRaises(_AbortError) as err:
            _ = self.service.GetAssignment(pb.GetAssignmentRequest(assignment_id=999999), gctx)
        self.assertEqual(err.exception.code, grpc.StatusCode.NOT_FOUND)

    def test_get_users_rejects_bad_bool_filter(self) -> None:
        with self.assertRaises(_AbortError) as ctx:
            self.service.GetUsers(
                pb.GetUsersRequest(instructor="maybe"),
                cast(grpc.ServicerContext, self._auth_context(user_id=2)),
            )
        self.assertEqual(ctx.exception.code, grpc.StatusCode.INVALID_ARGUMENT)

    def test_last_commit_reads(self) -> None:
        ctx = self._auth_context()
        self.assertEqual(
            self.service.GetAssignmentProblemCommitLast(
                pb.GetAssignmentProblemCommitLastRequest(assignment_id=1, problem_id=1),
                cast(grpc.ServicerContext, ctx),
            ).commit.id,
            1,
        )
        self.assertEqual(
            self.service.GetAssignmentProblemStepCommitLast(
                pb.GetAssignmentProblemStepCommitLastRequest(assignment_id=1, problem_id=1, step=1),
                cast(grpc.ServicerContext, ctx),
            ).commit.id,
            1,
        )

    def test_last_commit_reads_tolerate_invalid_json_shapes(self) -> None:
        self.conn.execute("UPDATE commits SET transcript = ?, report_card = ? WHERE id = 1", ('{"oops":1}', "[]"))
        self.conn.commit()

        ctx = cast(grpc.ServicerContext, self._auth_context())
        commit = self.service.GetAssignmentProblemCommitLast(
            pb.GetAssignmentProblemCommitLastRequest(assignment_id=1, problem_id=1),
            ctx,
        ).commit
        self.assertEqual(commit.id, 1)
        self.assertEqual(len(commit.transcript), 0)
        self.assertFalse(commit.HasField("report_card"))

    def test_get_assignment_problem_step_commit_last_missing_returns_not_found(self) -> None:
        gctx = cast(grpc.ServicerContext, self._auth_context())
        with self.assertRaises(_AbortError) as err:
            _ = self.service.GetAssignmentProblemStepCommitLast(
                pb.GetAssignmentProblemStepCommitLastRequest(assignment_id=1, problem_id=1, step=999),
                gctx,
            )
        self.assertEqual(err.exception.code, grpc.StatusCode.NOT_FOUND)

    def test_get_user_session(self) -> None:
        key = self.logins.insert(1, datetime.now(tz=UTC))
        reply = self.service.GetUserSession(
            pb.GetUserSessionRequest(key=key), cast(grpc.ServicerContext, _FakeContext())
        )
        self.assertIn("codegrinder=", reply.cookie)

    def test_auth_required(self) -> None:
        with self.assertRaises(_AbortError) as err:
            self.service.GetAssignments(
                pb.GetAssignmentsRequest(), cast(grpc.ServicerContext, _FakeContext())
            )
        self.assertEqual(err.exception.code, grpc.StatusCode.UNAUTHENTICATED)

    def test_cookie_header_parsing_with_multiple_cookie_pairs(self) -> None:
        session = new_session(1, datetime(2026, 2, 15, 10, 0, 0, tzinfo=UTC), self.config.sessions_expire)
        cookie = encode_session(session, self.config.session_secret)
        ctx = _FakeContext([_Meta("cookie", f"a=1; codegrinder={cookie}; z=9")])
        reply = self.service.GetUserMe(pb.GetUserMeRequest(), cast(grpc.ServicerContext, ctx))
        self.assertEqual(reply.user.id, 1)

    def test_invalid_cookie_value_rejected(self) -> None:
        ctx = _FakeContext([_Meta("cookie", "codegrinder=not-a-valid-session")])
        with self.assertRaises(_AbortError) as err:
            self.service.GetAssignments(pb.GetAssignmentsRequest(), cast(grpc.ServicerContext, ctx))
        self.assertEqual(err.exception.code, grpc.StatusCode.UNAUTHENTICATED)

    def test_hello_rejects_invalid_login_key(self) -> None:
        with self.assertRaises(_AbortError) as err:
            self.service.Hello(pb.HelloRequest(key="bogus"), cast(grpc.ServicerContext, _FakeContext()))
        self.assertEqual(err.exception.code, grpc.StatusCode.INVALID_ARGUMENT)

    def test_get_user_session_rejects_invalid_login_key(self) -> None:
        with self.assertRaises(_AbortError) as err:
            self.service.GetUserSession(
                pb.GetUserSessionRequest(key="bogus"),
                cast(grpc.ServicerContext, _FakeContext()),
            )
        self.assertEqual(err.exception.code, grpc.StatusCode.INVALID_ARGUMENT)

    def test_problem_bundle_unconfirmed_confirmed_flow(self) -> None:
        ctx = cast(grpc.ServicerContext, self._auth_context(user_id=2))
        unsigned = self.service.PostProblemBundleUnconfirmed(
            pb.PostProblemBundleUnconfirmedRequest(bundle=self._build_problem_bundle("prob-new")),
            ctx,
        ).bundle
        self.assertEqual(unsigned.hostname, "example.invalid")
        self.assertEqual(unsigned.problem_types["python3unittest"].name, "python3unittest")
        self.assertEqual(len(unsigned.commit_signatures), 1)

        self._sign_problem_bundle_commit(unsigned)
        confirmed = self.service.PostProblemBundleConfirmed(
            pb.PostProblemBundleConfirmedRequest(bundle=unsigned),
            ctx,
        ).bundle
        self.assertGreater(confirmed.problem.id, 0)
        self.assertIn("main.py", confirmed.problem_steps[0].solution)
        stored = self.conn.execute("SELECT unique_id FROM problems WHERE id = ?", (confirmed.problem.id,)).fetchone()
        self.assertEqual(str(stored["unique_id"]), "prob-new")

    def test_put_problem_bundle_updates_existing_problem(self) -> None:
        ctx = cast(grpc.ServicerContext, self._auth_context(user_id=2))
        existing = self.conn.execute("SELECT created_at FROM problems WHERE id = 1").fetchone()
        created = str(existing["created_at"])
        bundle = self._build_problem_bundle("prob-1")
        bundle.problem.id = 1
        bundle.problem.created_at.FromDatetime(datetime.fromisoformat(created))
        bundle.problem.note = "Updated Problem Note"
        unsigned = self.service.PostProblemBundleUnconfirmed(
            pb.PostProblemBundleUnconfirmedRequest(bundle=bundle),
            ctx,
        ).bundle
        self._sign_problem_bundle_commit(unsigned)
        updated = self.service.PutProblemBundle(
            pb.PutProblemBundleRequest(problem_id=1, bundle=unsigned),
            ctx,
        ).bundle
        self.assertEqual(updated.problem.id, 1)
        row = self.conn.execute("SELECT note FROM problems WHERE id = 1").fetchone()
        self.assertEqual(str(row["note"]), "Updated Problem Note")

    def test_problem_set_bundle_create_update(self) -> None:
        ctx = cast(grpc.ServicerContext, self._auth_context(user_id=2))
        created = self.service.PostProblemSetBundle(
            pb.PostProblemSetBundleRequest(
                bundle=pb.ProblemSetBundle(
                    problem_set=pb.ProblemSet(unique="set-new", note="Set New", tags=["z", "a"]),
                    problem_set_problems=[pb.ProblemSetProblem(problem_id=1, weight=2.0)],
                )
            ),
            ctx,
        ).bundle
        self.assertGreater(created.problem_set.id, 0)
        created.problem_set.note = "Set Updated"
        updated = self.service.PutProblemSetBundle(
            pb.PutProblemSetBundleRequest(bundle=created),
            ctx,
        ).bundle
        self.assertEqual(updated.problem_set.note, "Set Updated")
        row = self.conn.execute("SELECT note FROM problem_sets WHERE id = ?", (updated.problem_set.id,)).fetchone()
        self.assertEqual(str(row["note"]), "Set Updated")

    def test_commit_bundle_unsigned_signed_flow_updates_scores(self) -> None:
        now = "2026-02-15T11:00:00+00:00"
        self.conn.execute(
            "INSERT INTO assignments(id, course_id, problem_set_id, user_id, roles, instructor, restricted, raw_scores, score, grade_id, lti_id, canvas_title, canvas_id, canvas_api_domain, outcome_url, outcome_ext_url, outcome_ext_accepted, finished_url, consumer_key, unlock_at, due_at, lock_at, created_at, updated_at) "
            "VALUES (3, 1, 1, 1, 'Student', 0, 0, ?, 0.0, 'g3', 'l3', 'Asst', 203, 'canvas.invalid', '', '', '', '', 'key', NULL, NULL, NULL, ?, ?)",
            ('{"prob-1":[0.0]}', now, now),
        )
        self.conn.commit()

        ctx = cast(grpc.ServicerContext, self._auth_context(user_id=1))
        unsigned = self.service.PostCommitBundlesUnsigned(
            pb.PostCommitBundlesUnsignedRequest(
                bundle=pb.CommitBundle(
                    user_id=1,
                    commit=pb.Commit(
                        assignment_id=3,
                        problem_id=1,
                        step=1,
                        action="grade",
                        note="",
                        files={"main.py": b"print('hello')\n"},
                    ),
                )
            ),
            ctx,
        ).bundle
        self.assertTrue(unsigned.commit_signature)
        self.assertEqual(unsigned.hostname, "example.invalid")
        stored_unsigned = self.conn.execute("SELECT action FROM commits WHERE assignment_id = 3 AND problem_id = 1 AND step = 1").fetchone()
        self.assertEqual(str(stored_unsigned["action"] or ""), "")

        graded_commit = pb.Commit()
        graded_commit.CopyFrom(unsigned.commit)
        graded_commit.report_card.CopyFrom(
            pb.ReportCard(
                passed=True,
                note="ok",
                results=[pb.ReportCardResult(name="suite", outcome="passed")],
            )
        )
        graded_commit.score = 1.0
        graded_commit.updated_at.FromDatetime(datetime.now(tz=UTC))
        signed = pb.CommitBundle(
            user_id=1,
            hostname=unsigned.hostname,
            commit=graded_commit,
        )
        signed.commit_signature = compute_commit_signature(
            signed.commit,
            unsigned.problem_type_signature,
            unsigned.problem_signature,
            unsigned.hostname,
            signed.user_id,
            self.config.daycare_secret,
        )
        _ = self.service.PostCommitBundlesSigned(
            pb.PostCommitBundlesSignedRequest(bundle=signed),
            ctx,
        ).bundle
        assignment = self.conn.execute("SELECT score, raw_scores FROM assignments WHERE id = 3").fetchone()
        self.assertAlmostEqual(float(assignment["score"]), 1.0)
        self.assertIn('"prob-1"', str(assignment["raw_scores"]))

    def test_commit_bundle_unsigned_scrubs_transient_fields_before_save(self) -> None:
        ctx = cast(grpc.ServicerContext, self._auth_context(user_id=1))
        unsigned_req = pb.PostCommitBundlesUnsignedRequest(
            bundle=pb.CommitBundle(
                user_id=1,
                commit=pb.Commit(
                    assignment_id=1,
                    problem_id=1,
                    step=1,
                    action="grade",
                    note=" n ",
                    files={"main.py": b"print('x')\r\n"},
                    transcript=[pb.EventMessage(event="stdout", stream_data=b"should-clear")],
                    report_card=pb.ReportCard(passed=True, note="should-clear"),
                    score=1.0,
                ),
            )
        )
        reply = self.service.PostCommitBundlesUnsigned(unsigned_req, ctx).bundle
        self.assertEqual(reply.commit.action, "grade")
        self.assertFalse(reply.commit.HasField("report_card"))
        self.assertEqual(reply.commit.score, 0.0)
        self.assertEqual(len(reply.commit.transcript), 0)

        row = self.conn.execute(
            "SELECT action, transcript, report_card, score, note FROM commits WHERE assignment_id = 1 AND problem_id = 1 AND step = 1"
        ).fetchone()
        self.assertEqual(str(row["action"] or ""), "")
        self.assertEqual(str(row["transcript"]), "[]")
        self.assertEqual(str(row["report_card"]), "null")
        self.assertEqual(float(row["score"] or 0.0), 0.0)
        self.assertEqual(str(row["note"]), "n")

    def test_commit_bundle_unsigned_logs_pre_daycare_commit(self) -> None:
        ctx = cast(grpc.ServicerContext, self._auth_context(user_id=1))
        with patch("grpc_service.logging.info") as info_log:
            _ = self.service.PostCommitBundlesUnsigned(
                pb.PostCommitBundlesUnsignedRequest(
                    bundle=pb.CommitBundle(
                        user_id=1,
                        commit=pb.Commit(
                            assignment_id=1,
                            problem_id=1,
                            step=1,
                            action="grade",
                            note="grind grade",
                            files={"main.py": b"print('hello')\n"},
                        ),
                    )
                ),
                ctx,
            ).bundle
        messages = [str(call.args[0]) for call in info_log.call_args_list if len(call.args) > 0]
        self.assertTrue(any("pre-daycare commit:" in message for message in messages))

    def test_commit_bundle_signed_logs_post_daycare_commit(self) -> None:
        ctx = cast(grpc.ServicerContext, self._auth_context(user_id=1))
        unsigned = self.service.PostCommitBundlesUnsigned(
            pb.PostCommitBundlesUnsignedRequest(
                bundle=pb.CommitBundle(
                    user_id=1,
                    commit=pb.Commit(
                        assignment_id=1,
                        problem_id=1,
                        step=1,
                        action="grade",
                        note="grind grade",
                        files={"main.py": b"print('hello')\n"},
                    ),
                )
            ),
            ctx,
        ).bundle
        graded_commit = pb.Commit()
        graded_commit.CopyFrom(unsigned.commit)
        graded_commit.report_card.CopyFrom(
            pb.ReportCard(
                passed=True,
                note="ok",
                results=[pb.ReportCardResult(name="suite", outcome="passed")],
            )
        )
        graded_commit.score = 1.0
        graded_commit.updated_at.FromDatetime(datetime.now(tz=UTC))
        signed = pb.CommitBundle(user_id=1, hostname=unsigned.hostname, commit=graded_commit)
        signed.commit_signature = compute_commit_signature(
            signed.commit,
            unsigned.problem_type_signature,
            unsigned.problem_signature,
            signed.hostname,
            signed.user_id,
            self.config.daycare_secret,
        )
        with patch("grpc_service.logging.info") as info_log:
            _ = self.service.PostCommitBundlesSigned(pb.PostCommitBundlesSignedRequest(bundle=signed), ctx).bundle
        messages = [str(call.args[0]) for call in info_log.call_args_list if len(call.args) > 0]
        self.assertTrue(any("post-daycare commit:" in message for message in messages))

    def test_commit_bundle_unsigned_tolerates_invalid_raw_scores_json(self) -> None:
        self.conn.execute("UPDATE assignments SET raw_scores = ? WHERE id = 1", (" ",))
        self.conn.commit()

        ctx = cast(grpc.ServicerContext, self._auth_context(user_id=1))
        unsigned = self.service.PostCommitBundlesUnsigned(
            pb.PostCommitBundlesUnsignedRequest(
                bundle=pb.CommitBundle(
                    user_id=1,
                    commit=pb.Commit(
                        assignment_id=1,
                        problem_id=1,
                        step=1,
                        action="grade",
                        note="",
                        files={"main.py": b"print('hello')\n"},
                    ),
                )
            ),
            ctx,
        ).bundle
        self.assertEqual(unsigned.commit.assignment_id, 1)
        self.assertTrue(unsigned.commit_signature)

    def test_commit_bundle_signed_rejects_expired_signature(self) -> None:
        ctx = cast(grpc.ServicerContext, self._auth_context(user_id=1))
        unsigned = self.service.PostCommitBundlesUnsigned(
            pb.PostCommitBundlesUnsignedRequest(
                bundle=pb.CommitBundle(
                    user_id=1,
                    commit=pb.Commit(
                        assignment_id=1,
                        problem_id=1,
                        step=1,
                        action="grade",
                        note="",
                        files={"main.py": b"print('hello')\n"},
                    ),
                )
            ),
            ctx,
        ).bundle

        stale = datetime.now(tz=UTC) - timedelta(minutes=20)
        commit = pb.Commit()
        commit.CopyFrom(unsigned.commit)
        commit.updated_at.FromDatetime(stale)
        signed = pb.CommitBundle(user_id=1, hostname=unsigned.hostname, commit=commit)
        signed.commit_signature = compute_commit_signature(
            signed.commit,
            unsigned.problem_type_signature,
            unsigned.problem_signature,
            signed.hostname,
            signed.user_id,
            self.config.daycare_secret,
        )
        with self.assertRaises(_AbortError) as err:
            self.service.PostCommitBundlesSigned(
                pb.PostCommitBundlesSignedRequest(bundle=signed),
                ctx,
            )
        self.assertEqual(err.exception.code, grpc.StatusCode.INTERNAL)
        self.assertIn("expired", err.exception.details.lower())

    def test_commit_bundle_rejects_step_if_previous_step_not_passed(self) -> None:
        now = "2026-02-15T12:00:00+00:00"
        self.conn.execute(
            "INSERT INTO problem_steps(problem_id, step, problem_type, note, instructions, weight, whitelist) VALUES (1, 2, 'python3unittest', 'Step 2', 'Step Two', 1.0, ?)",
            ('{"main.py": true}',),
        )
        self.conn.execute(
            "INSERT INTO problem_step_files(problem_id, step, path, content) VALUES (1, 2, 'main.py', ?)",
            (b"print('step2')\n",),
        )
        self.conn.execute(
            "UPDATE assignments SET raw_scores = ?, updated_at = ? WHERE id = 1",
            ('{"prob-1":[0.0,0.0]}', now),
        )
        self.conn.commit()

        ctx = cast(grpc.ServicerContext, self._auth_context(user_id=1))
        with self.assertRaises(_AbortError) as err:
            self.service.PostCommitBundlesUnsigned(
                pb.PostCommitBundlesUnsignedRequest(
                    bundle=pb.CommitBundle(
                        user_id=1,
                        commit=pb.Commit(
                            assignment_id=1,
                            problem_id=1,
                            step=2,
                            action="grade",
                            note="",
                            files={"main.py": b"print('step2')\n"},
                        ),
                    )
                ),
                ctx,
            )
        self.assertEqual(err.exception.code, grpc.StatusCode.INTERNAL)
        self.assertIn("has not passed step 1", err.exception.details)

    def test_author_required_for_problem_mutations(self) -> None:
        ctx = cast(grpc.ServicerContext, self._auth_context(user_id=1))
        with self.assertRaises(_AbortError) as err:
            self.service.PostProblemBundleUnconfirmed(
                pb.PostProblemBundleUnconfirmedRequest(bundle=self._build_problem_bundle("prob-forbidden", user_id=1)),
                ctx,
            )
        self.assertEqual(err.exception.code, grpc.StatusCode.PERMISSION_DENIED)

    def test_mutation_bundle_required(self) -> None:
        ctx = cast(grpc.ServicerContext, self._auth_context(user_id=2))
        with self.assertRaises(_AbortError) as err:
            self.service.PostProblemSetBundle(pb.PostProblemSetBundleRequest(), ctx)
        self.assertEqual(err.exception.code, grpc.StatusCode.INVALID_ARGUMENT)

    def test_recovery_interceptor_does_not_log_expected_abort(self) -> None:
        interceptor = RecoveryInterceptor()

        def continuation(_details: grpc.HandlerCallDetails) -> grpc.RpcMethodHandler:
            return grpc.unary_unary_rpc_method_handler(
                lambda _request, ctx: cast(_InterceptorContext, ctx).abort(grpc.StatusCode.INVALID_ARGUMENT, "bad")
            )

        details = cast(grpc.HandlerCallDetails, _HandlerCallDetails(method="/codegrinder.CodeGrinderService/GetProblemStep"))
        handler = interceptor.intercept_service(continuation, details)
        self.assertIsNotNone(handler)
        assert handler is not None
        context = _InterceptorContext()
        with patch("grpc_service.logging.exception") as log_exc:
            with self.assertRaises(Exception):
                assert handler.unary_unary is not None
                _ = handler.unary_unary(object(), cast(grpc.ServicerContext, context))
            log_exc.assert_not_called()

    def test_recovery_interceptor_logs_unexpected_exception(self) -> None:
        interceptor = RecoveryInterceptor()

        def continuation(_details: grpc.HandlerCallDetails) -> grpc.RpcMethodHandler:
            return grpc.unary_unary_rpc_method_handler(
                lambda _request, _ctx: (_ for _ in ()).throw(RuntimeError("boom"))
            )

        details = cast(grpc.HandlerCallDetails, _HandlerCallDetails(method="/codegrinder.CodeGrinderService/GetProblemStep"))
        handler = interceptor.intercept_service(continuation, details)
        self.assertIsNotNone(handler)
        assert handler is not None
        context = _InterceptorContext()
        with patch("grpc_service.logging.exception") as log_exc:
            with self.assertRaises(Exception):
                assert handler.unary_unary is not None
                _ = handler.unary_unary(object(), cast(grpc.ServicerContext, context))
            log_exc.assert_called_once()
            args, _kwargs = log_exc.call_args
            self.assertIn("/codegrinder.CodeGrinderService/GetProblemStep", str(args[1]))
            self.assertEqual(context.code(), grpc.StatusCode.INTERNAL)


if __name__ == "__main__":
    unittest.main()
