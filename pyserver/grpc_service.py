from __future__ import annotations

import contextvars
import logging
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable, Iterator, TypeVar

import grpc

import codegrinder_pb2 as pb
import codegrinder_pb2_grpc as pb_grpc
from config import ServerConfig
from daycare_registry import DaycareRegistry
from daycare import DaycareRuntime
from db import transaction
from grade_passback import GradePassbackTarget, build_grade_report_html, save_grade_async
from ipfilter import IPFilter, extract_ip_from_peer
from mutations import (
    create_problem_set_bundle,
    save_commit_bundle_common,
    save_problem_bundle_common,
    sign_problem_bundle_unconfirmed,
    update_problem_bundle,
    update_problem_set_bundle,
)
from read_store import (
    get_assignment_pb,
    get_assignment_problem_commit_last_pb,
    get_assignment_problem_step_commit_last_pb,
    get_assignments_pb,
    get_course_pb,
    get_course_user_assignments_pb,
    get_course_users_pb,
    get_courses_pb,
    get_list_problems_bundle,
    get_problem_pb,
    get_problem_set_pb,
    get_problem_set_problems_pb,
    get_problem_sets_pb,
    get_problem_step_pb,
    get_problem_steps_pb,
    get_problem_type_actions_rows,
    get_problem_types_rows,
    get_problems_pb,
    get_user_assignments_pb,
    get_user_me_pb,
    get_user_pb,
    get_users_pb,
    load_user_by_id,
    problem_type_pb,
)
from sessions import COOKIE_NAME, LoginRecords, SessionError, decode_session, encode_session, new_session

IP_ALLOWED_VAR: contextvars.ContextVar[bool] = contextvars.ContextVar("ip_allowed", default=True)
T = TypeVar("T")


def _extract_ip_for_filter(context: grpc.ServicerContext) -> str | None:
    try:
        md = context.invocation_metadata()
    except Exception:
        md = ()
    for item in md:
        key = item.key.lower()
        if key == "x-real-ip" and item.value.strip() != "":
            return item.value.strip()
        if key == "x-forwarded-for" and item.value.strip() != "":
            return item.value.split(",", 1)[0].strip()
    return extract_ip_from_peer(context.peer() or "")


def _is_db_not_found(exc: sqlite3.Error) -> bool:
    return str(exc).strip().lower() == "not found"


def _context_has_grpc_status(context: grpc.ServicerContext) -> bool:
    if not hasattr(context, "code"):
        return False
    try:
        code = context.code()
    except Exception:
        return False
    return code is not None and code != grpc.StatusCode.OK


@dataclass(slots=True)
class VersionInfo:
    version: str = "2.8.0"
    grind_version_required: str = "2.7.0"
    grind_version_recommended: str = "2.7.0"
    thonny_version_required: str = "2.7.0"
    thonny_version_recommended: str = "2.7.0"

    def to_pb(self) -> pb.Version:
        return pb.Version(
            version=self.version,
            grind_version_required=self.grind_version_required,
            grind_version_recommended=self.grind_version_recommended,
            thonny_version_required=self.thonny_version_required,
            thonny_version_recommended=self.thonny_version_recommended,
        )


class IPFilterInterceptor(grpc.ServerInterceptor):
    def __init__(self, ip_filter: IPFilter) -> None:
        self._ip_filter = ip_filter

    def intercept_service(
        self,
        continuation: Callable[[grpc.HandlerCallDetails], Any],
        handler_call_details: grpc.HandlerCallDetails,
    ) -> Any:
        handler = continuation(handler_call_details)
        if handler is None:
            return None
        if handler.unary_unary is not None:
            original = handler.unary_unary

            def unary_unary(request: object, context: grpc.ServicerContext) -> object:
                allowed = True
                if self._ip_filter.enabled():
                    ip = _extract_ip_for_filter(context)
                    allowed = bool(ip and self._ip_filter.allows_ip(ip))
                token = IP_ALLOWED_VAR.set(allowed)
                try:
                    return original(request, context)
                finally:
                    IP_ALLOWED_VAR.reset(token)

            return grpc.unary_unary_rpc_method_handler(
                unary_unary,
                request_deserializer=handler.request_deserializer,
                response_serializer=handler.response_serializer,
            )

        if handler.unary_stream is not None:
            original_stream = handler.unary_stream

            def unary_stream(request: object, context: grpc.ServicerContext) -> Iterator[object]:
                allowed = True
                if self._ip_filter.enabled():
                    ip = _extract_ip_for_filter(context)
                    allowed = bool(ip and self._ip_filter.allows_ip(ip))
                token = IP_ALLOWED_VAR.set(allowed)
                try:
                    yield from original_stream(request, context)
                finally:
                    IP_ALLOWED_VAR.reset(token)

            return grpc.unary_stream_rpc_method_handler(
                unary_stream,
                request_deserializer=handler.request_deserializer,
                response_serializer=handler.response_serializer,
            )

        return handler


class RecoveryInterceptor(grpc.ServerInterceptor):
    def intercept_service(
        self,
        continuation: Callable[[grpc.HandlerCallDetails], Any],
        handler_call_details: grpc.HandlerCallDetails,
    ) -> Any:
        handler = continuation(handler_call_details)
        if handler is None:
            return None
        method_attr = getattr(handler_call_details, "method", "")
        method_name = method_attr if isinstance(method_attr, str) and method_attr != "" else "<unknown>"

        if handler.unary_unary is not None:
            original = handler.unary_unary

            def wrapped(request: object, context: grpc.ServicerContext) -> object:
                try:
                    return original(request, context)
                except grpc.RpcError:
                    raise
                except Exception as exc:
                    if _context_has_grpc_status(context):
                        raise
                    logging.exception("panic in gRPC unary handler %s", method_name)
                    context.abort(grpc.StatusCode.INTERNAL, "internal server error")

            return grpc.unary_unary_rpc_method_handler(
                wrapped,
                request_deserializer=handler.request_deserializer,
                response_serializer=handler.response_serializer,
            )
        if handler.unary_stream is not None:
            original_stream = handler.unary_stream

            def wrapped_stream(request: object, context: grpc.ServicerContext) -> Iterator[object]:
                try:
                    yield from original_stream(request, context)
                except grpc.RpcError:
                    raise
                except Exception:
                    if _context_has_grpc_status(context):
                        raise
                    logging.exception("panic in gRPC stream handler %s", method_name)
                    context.abort(grpc.StatusCode.INTERNAL, "internal server error")

            return grpc.unary_stream_rpc_method_handler(
                wrapped_stream,
                request_deserializer=handler.request_deserializer,
                response_serializer=handler.response_serializer,
            )
        return handler


class CodeGrinderService(pb_grpc.CodeGrinderServiceServicer):
    def __init__(
        self,
        conn: sqlite3.Connection,
        config: ServerConfig,
        root: Path,
        login_records: LoginRecords | None = None,
        version: VersionInfo | None = None,
        daycare_registry: DaycareRegistry | None = None,
    ) -> None:
        self._conn = conn
        self._config = config
        self._root = root
        self._login_records = login_records or LoginRecords()
        self._version = version or VersionInfo()
        self._daycare_registry = daycare_registry
        whitelist = config.ip_filter.whitelist if config.ip_filter is not None else []
        self.ip_filter = IPFilter.from_entries(whitelist)
        self._daycare = DaycareRuntime(config)

    @property
    def conn(self) -> sqlite3.Connection:
        return self._conn

    @property
    def login_records(self) -> LoginRecords:
        return self._login_records

    @property
    def version_info(self) -> VersionInfo:
        return self._version

    def _ip_allowed(self, context: grpc.ServicerContext) -> bool:
        try:
            return IP_ALLOWED_VAR.get()
        except LookupError:
            if not self.ip_filter.enabled():
                return True
            ip = _extract_ip_for_filter(context)
            return bool(ip and self.ip_filter.allows_ip(ip))

    def _with_tx(self, fn: Callable[[sqlite3.Connection], T]) -> T:
        with transaction(self._conn) as tx:
            return fn(tx)

    def _require_author(self, user_row: sqlite3.Row, context: grpc.ServicerContext) -> None:
        if bool(user_row["admin"]) or bool(user_row["author"]):
            return
        context.abort(grpc.StatusCode.PERMISSION_DENIED, "user is not an author")

    def _get_cookie_value(self, context: grpc.ServicerContext) -> str:
        md = context.invocation_metadata()
        cookies: list[str] = []
        for item in md:
            if item.key.lower() == "cookie":
                cookies.append(item.value)
        if not cookies:
            context.abort(grpc.StatusCode.UNAUTHENTICATED, "missing session cookie")
        for cookie_header in cookies:
            for part in cookie_header.split(";"):
                chunk = part.strip()
                if chunk.startswith(COOKIE_NAME + "="):
                    return chunk[len(COOKIE_NAME) + 1 :]
        context.abort(grpc.StatusCode.UNAUTHENTICATED, "missing session cookie")
        raise AssertionError("unreachable")

    def _current_user_row(self, tx: sqlite3.Connection, context: grpc.ServicerContext) -> sqlite3.Row:
        cookie_value = self._get_cookie_value(context)
        try:
            session = decode_session(cookie_value, self._config.session_secret, datetime.now(tz=UTC))
        except SessionError as exc:
            context.abort(grpc.StatusCode.UNAUTHENTICATED, str(exc))
            raise AssertionError("unreachable")
        try:
            return load_user_by_id(tx, session.user_id)
        except sqlite3.Error as exc:
            context.abort(grpc.StatusCode.INTERNAL, f"db error loading user: {exc}")
            raise AssertionError("unreachable")

    def _problem_type_files(self, name: str) -> dict[str, bytes]:
        files: dict[str, bytes] = {}
        directory = self._root / "files" / name
        if not directory.exists() or not directory.is_dir():
            return files
        for path in directory.rglob("*"):
            if not path.is_file():
                continue
            files[str(path.relative_to(directory))] = path.read_bytes()
        return files

    def _load_problem_type(self, tx: sqlite3.Connection, name: str) -> pb.ProblemType:
        row = tx.execute("SELECT * FROM problem_types WHERE name = ?", (name,)).fetchone()
        if row is None:
            raise sqlite3.Error("not found")
        action_rows = get_problem_type_actions_rows(tx, name)
        return problem_type_pb(str(row["name"]), str(row["image"]), self._problem_type_files(name), action_rows)

    # gRPC-native names
    def rpc_hello(self, request: pb.HelloRequest, context: grpc.ServicerContext) -> pb.HelloResponse:
        version = self._version.to_pb()
        if request.key:
            try:
                user_id = self._login_records.get(request.key, datetime.now(tz=UTC))
            except SessionError as exc:
                context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))
            session = new_session(user_id, datetime.now(tz=UTC), self._config.sessions_expire)
            cookie_value = encode_session(session, self._config.session_secret)

            def fn(tx: sqlite3.Connection) -> pb.HelloResponse:
                try:
                    user_row = load_user_by_id(tx, user_id)
                except sqlite3.Error as exc:
                    context.abort(grpc.StatusCode.INTERNAL, f"db error getting user me: {exc}")
                return pb.HelloResponse(
                    cookie=f"{COOKIE_NAME}={cookie_value}",
                    user=get_user_me_pb(user_row),
                    version=version,
                )

            return self._with_tx(fn)

        def fn2(tx: sqlite3.Connection) -> pb.HelloResponse:
            user_row = self._current_user_row(tx, context)
            return pb.HelloResponse(user=get_user_me_pb(user_row), version=version)

        return self._with_tx(fn2)

    def rpc_list_problems(self, _request: pb.ListProblemsRequest, context: grpc.ServicerContext) -> pb.ListProblemsResponse:
        def fn(tx: sqlite3.Connection) -> pb.ListProblemsResponse:
            user_row = self._current_user_row(tx, context)
            user, assignments, courses, problem_sets = get_list_problems_bundle(
                tx, int(user_row["id"]), user_row, self._ip_allowed(context)
            )
            return pb.ListProblemsResponse(
                user=user, assignments=assignments, courses=courses, problem_sets=problem_sets
            )

        return self._with_tx(fn)

    def rpc_version(self, _request: pb.GetVersionRequest, _context: grpc.ServicerContext) -> pb.GetVersionResponse:
        return pb.GetVersionResponse(version=self._version.to_pb())

    def rpc_problem_types(self, _request: pb.GetProblemTypesRequest, context: grpc.ServicerContext) -> pb.GetProblemTypesResponse:
        def fn(tx: sqlite3.Connection) -> pb.GetProblemTypesResponse:
            try:
                rows = get_problem_types_rows(tx)
                types = [self._load_problem_type(tx, str(row["name"])) for row in rows]
            except sqlite3.Error as exc:
                context.abort(grpc.StatusCode.INTERNAL, f"db error getting problem types: {exc}")
            return pb.GetProblemTypesResponse(problem_types=types)

        return self._with_tx(fn)

    def rpc_problem_type(self, request: pb.GetProblemTypeRequest, context: grpc.ServicerContext) -> pb.GetProblemTypeResponse:
        def fn(tx: sqlite3.Connection) -> pb.GetProblemTypeResponse:
            try:
                problem_type = self._load_problem_type(tx, request.name)
            except sqlite3.Error as exc:
                if _is_db_not_found(exc):
                    context.abort(grpc.StatusCode.NOT_FOUND, "not found")
                    raise AssertionError("unreachable")
                context.abort(grpc.StatusCode.INTERNAL, f"db error getting problem type: {exc}")
            return pb.GetProblemTypeResponse(problem_type=problem_type)

        return self._with_tx(fn)

    def rpc_problems(self, request: pb.GetProblemsRequest, context: grpc.ServicerContext) -> pb.GetProblemsResponse:
        def fn(tx: sqlite3.Connection) -> pb.GetProblemsResponse:
            current_user = self._current_user_row(tx, context)
            try:
                problems = get_problems_pb(tx, current_user, request.unique, request.problem_type, request.note)
            except sqlite3.Error as exc:
                context.abort(grpc.StatusCode.INTERNAL, f"db error getting problems: {exc}")
            return pb.GetProblemsResponse(problems=problems)

        return self._with_tx(fn)

    def rpc_problem(self, request: pb.GetProblemRequest, context: grpc.ServicerContext) -> pb.GetProblemResponse:
        def fn(tx: sqlite3.Connection) -> pb.GetProblemResponse:
            current_user = self._current_user_row(tx, context)
            try:
                problem = get_problem_pb(tx, current_user, int(request.problem_id))
            except sqlite3.Error as exc:
                if _is_db_not_found(exc):
                    context.abort(grpc.StatusCode.NOT_FOUND, "not found")
                    raise AssertionError("unreachable")
                context.abort(grpc.StatusCode.INTERNAL, f"db error getting problem: {exc}")
            return pb.GetProblemResponse(problem=problem)

        return self._with_tx(fn)

    def rpc_problem_steps(self, request: pb.GetProblemStepsRequest, context: grpc.ServicerContext) -> pb.GetProblemStepsResponse:
        def fn(tx: sqlite3.Connection) -> pb.GetProblemStepsResponse:
            current_user = self._current_user_row(tx, context)
            try:
                steps = get_problem_steps_pb(tx, current_user, int(request.problem_id))
            except sqlite3.Error as exc:
                if _is_db_not_found(exc):
                    context.abort(grpc.StatusCode.NOT_FOUND, "not found")
                    raise AssertionError("unreachable")
                context.abort(grpc.StatusCode.INTERNAL, f"db error getting problem steps: {exc}")
            return pb.GetProblemStepsResponse(problem_steps=steps)

        return self._with_tx(fn)

    def rpc_problem_step(self, request: pb.GetProblemStepRequest, context: grpc.ServicerContext) -> pb.GetProblemStepResponse:
        def fn(tx: sqlite3.Connection) -> pb.GetProblemStepResponse:
            current_user = self._current_user_row(tx, context)
            try:
                step = get_problem_step_pb(tx, current_user, int(request.problem_id), int(request.step))
            except sqlite3.Error as exc:
                if _is_db_not_found(exc):
                    context.abort(grpc.StatusCode.NOT_FOUND, "not found")
                    raise AssertionError("unreachable")
                context.abort(grpc.StatusCode.INTERNAL, f"db error getting problem step: {exc}")
            return pb.GetProblemStepResponse(problem_step=step)

        return self._with_tx(fn)

    def rpc_problem_sets(self, request: pb.GetProblemSetsRequest, context: grpc.ServicerContext) -> pb.GetProblemSetsResponse:
        def fn(tx: sqlite3.Connection) -> pb.GetProblemSetsResponse:
            current_user = self._current_user_row(tx, context)
            try:
                problem_sets = get_problem_sets_pb(tx, current_user, request.unique, request.note, list(request.search))
            except sqlite3.Error as exc:
                context.abort(grpc.StatusCode.INTERNAL, f"db error getting problem sets: {exc}")
            return pb.GetProblemSetsResponse(problem_sets=problem_sets)

        return self._with_tx(fn)

    def rpc_problem_set(self, request: pb.GetProblemSetRequest, context: grpc.ServicerContext) -> pb.GetProblemSetResponse:
        def fn(tx: sqlite3.Connection) -> pb.GetProblemSetResponse:
            current_user = self._current_user_row(tx, context)
            try:
                problem_set = get_problem_set_pb(tx, current_user, int(request.problem_set_id))
            except sqlite3.Error as exc:
                if _is_db_not_found(exc):
                    context.abort(grpc.StatusCode.NOT_FOUND, "not found")
                    raise AssertionError("unreachable")
                context.abort(grpc.StatusCode.INTERNAL, f"db error getting problem set: {exc}")
            return pb.GetProblemSetResponse(problem_set=problem_set)

        return self._with_tx(fn)

    def rpc_problem_set_problems(
        self, request: pb.GetProblemSetProblemsRequest, context: grpc.ServicerContext
    ) -> pb.GetProblemSetProblemsResponse:
        def fn(tx: sqlite3.Connection) -> pb.GetProblemSetProblemsResponse:
            current_user = self._current_user_row(tx, context)
            try:
                entries = get_problem_set_problems_pb(tx, current_user, int(request.problem_set_id))
            except sqlite3.Error as exc:
                if _is_db_not_found(exc):
                    context.abort(grpc.StatusCode.NOT_FOUND, "not found")
                    raise AssertionError("unreachable")
                context.abort(grpc.StatusCode.INTERNAL, f"db error getting problem set problems: {exc}")
            return pb.GetProblemSetProblemsResponse(problem_set_problems=entries)

        return self._with_tx(fn)

    def rpc_courses(self, request: pb.GetCoursesRequest, context: grpc.ServicerContext) -> pb.GetCoursesResponse:
        def fn(tx: sqlite3.Connection) -> pb.GetCoursesResponse:
            current_user = self._current_user_row(tx, context)
            try:
                courses = get_courses_pb(tx, current_user, request.lti_label, request.name)
            except sqlite3.Error as exc:
                context.abort(grpc.StatusCode.INTERNAL, f"db error getting courses: {exc}")
            return pb.GetCoursesResponse(courses=courses)

        return self._with_tx(fn)

    def rpc_course(self, request: pb.GetCourseRequest, context: grpc.ServicerContext) -> pb.GetCourseResponse:
        def fn(tx: sqlite3.Connection) -> pb.GetCourseResponse:
            current_user = self._current_user_row(tx, context)
            try:
                course = get_course_pb(tx, current_user, int(request.course_id))
            except sqlite3.Error as exc:
                if _is_db_not_found(exc):
                    context.abort(grpc.StatusCode.NOT_FOUND, "not found")
                    raise AssertionError("unreachable")
                context.abort(grpc.StatusCode.INTERNAL, f"db error getting course: {exc}")
            return pb.GetCourseResponse(course=course)

        return self._with_tx(fn)

    def rpc_users(self, request: pb.GetUsersRequest, context: grpc.ServicerContext) -> pb.GetUsersResponse:
        def fn(tx: sqlite3.Connection) -> pb.GetUsersResponse:
            current_user = self._current_user_row(tx, context)
            try:
                users = get_users_pb(tx, current_user, request.name, request.email, request.instructor, request.admin)
            except ValueError as exc:
                context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))
            except sqlite3.Error as exc:
                context.abort(grpc.StatusCode.INTERNAL, f"db error getting users: {exc}")
            return pb.GetUsersResponse(users=users)

        return self._with_tx(fn)

    def rpc_current_user(self, _request: pb.GetUserMeRequest, context: grpc.ServicerContext) -> pb.GetUserMeResponse:
        def fn(tx: sqlite3.Connection) -> pb.GetUserMeResponse:
            current_user = self._current_user_row(tx, context)
            return pb.GetUserMeResponse(user=get_user_me_pb(current_user))

        return self._with_tx(fn)

    def rpc_exchange_user_session(
        self, request: pb.GetUserSessionRequest, context: grpc.ServicerContext
    ) -> pb.GetUserSessionResponse:
        try:
            user_id = self._login_records.get(request.key, datetime.now(tz=UTC))
        except SessionError as exc:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))
        session = new_session(user_id, datetime.now(tz=UTC), self._config.sessions_expire)
        cookie_value = encode_session(session, self._config.session_secret)
        return pb.GetUserSessionResponse(cookie=f"{COOKIE_NAME}={cookie_value}")

    def rpc_user(self, request: pb.GetUserRequest, context: grpc.ServicerContext) -> pb.GetUserResponse:
        def fn(tx: sqlite3.Connection) -> pb.GetUserResponse:
            current_user = self._current_user_row(tx, context)
            try:
                user = get_user_pb(tx, current_user, int(request.user_id))
            except sqlite3.Error as exc:
                if _is_db_not_found(exc):
                    context.abort(grpc.StatusCode.NOT_FOUND, "not found")
                    raise AssertionError("unreachable")
                context.abort(grpc.StatusCode.INTERNAL, f"db error getting user: {exc}")
            return pb.GetUserResponse(user=user)

        return self._with_tx(fn)

    def rpc_course_users(self, request: pb.GetCourseUsersRequest, context: grpc.ServicerContext) -> pb.GetCourseUsersResponse:
        def fn(tx: sqlite3.Connection) -> pb.GetCourseUsersResponse:
            current_user = self._current_user_row(tx, context)
            try:
                users = get_course_users_pb(tx, current_user, int(request.course_id))
            except sqlite3.Error as exc:
                if _is_db_not_found(exc):
                    context.abort(grpc.StatusCode.NOT_FOUND, "not found")
                    raise AssertionError("unreachable")
                context.abort(grpc.StatusCode.INTERNAL, f"db error getting course users: {exc}")
            return pb.GetCourseUsersResponse(users=users)

        return self._with_tx(fn)

    def rpc_user_assignments(
        self, request: pb.GetUserAssignmentsRequest, context: grpc.ServicerContext
    ) -> pb.GetUserAssignmentsResponse:
        def fn(tx: sqlite3.Connection) -> pb.GetUserAssignmentsResponse:
            current_user = self._current_user_row(tx, context)
            try:
                assts = get_user_assignments_pb(tx, current_user, int(request.user_id), self._ip_allowed(context))
            except sqlite3.Error as exc:
                context.abort(grpc.StatusCode.INTERNAL, f"db error getting user assignments: {exc}")
            return pb.GetUserAssignmentsResponse(assignments=assts)

        return self._with_tx(fn)

    def rpc_course_user_assignments(
        self, request: pb.GetCourseUserAssignmentsRequest, context: grpc.ServicerContext
    ) -> pb.GetCourseUserAssignmentsResponse:
        def fn(tx: sqlite3.Connection) -> pb.GetCourseUserAssignmentsResponse:
            current_user = self._current_user_row(tx, context)
            try:
                assts = get_course_user_assignments_pb(
                    tx, current_user, int(request.course_id), int(request.user_id), self._ip_allowed(context)
                )
            except sqlite3.Error as exc:
                if _is_db_not_found(exc):
                    context.abort(grpc.StatusCode.NOT_FOUND, "not found")
                    raise AssertionError("unreachable")
                context.abort(grpc.StatusCode.INTERNAL, f"db error getting course user assignments: {exc}")
            return pb.GetCourseUserAssignmentsResponse(assignments=assts)

        return self._with_tx(fn)

    def rpc_assignments(self, request: pb.GetAssignmentsRequest, context: grpc.ServicerContext) -> pb.GetAssignmentsResponse:
        def fn(tx: sqlite3.Connection) -> pb.GetAssignmentsResponse:
            current_user = self._current_user_row(tx, context)
            try:
                assts = get_assignments_pb(tx, current_user, list(request.search), self._ip_allowed(context))
            except sqlite3.Error as exc:
                context.abort(grpc.StatusCode.INTERNAL, f"db error getting assignments: {exc}")
            return pb.GetAssignmentsResponse(assignments=assts)

        return self._with_tx(fn)

    def rpc_assignment(self, request: pb.GetAssignmentRequest, context: grpc.ServicerContext) -> pb.GetAssignmentResponse:
        def fn(tx: sqlite3.Connection) -> pb.GetAssignmentResponse:
            current_user = self._current_user_row(tx, context)
            try:
                asst = get_assignment_pb(tx, current_user, int(request.assignment_id), self._ip_allowed(context))
            except sqlite3.Error as exc:
                if _is_db_not_found(exc):
                    context.abort(grpc.StatusCode.NOT_FOUND, "not found")
                    raise AssertionError("unreachable")
                context.abort(grpc.StatusCode.INTERNAL, f"db error getting assignment: {exc}")
            return pb.GetAssignmentResponse(assignment=asst)

        return self._with_tx(fn)

    def rpc_assignment_problem_latest_commit(
        self, request: pb.GetAssignmentProblemCommitLastRequest, context: grpc.ServicerContext
    ) -> pb.GetAssignmentProblemCommitLastResponse:
        def fn(tx: sqlite3.Connection) -> pb.GetAssignmentProblemCommitLastResponse:
            current_user = self._current_user_row(tx, context)
            try:
                commit = get_assignment_problem_commit_last_pb(
                    tx, current_user, int(request.assignment_id), int(request.problem_id), self._ip_allowed(context)
                )
            except sqlite3.Error as exc:
                if _is_db_not_found(exc):
                    context.abort(grpc.StatusCode.NOT_FOUND, "not found")
                    raise AssertionError("unreachable")
                context.abort(grpc.StatusCode.INTERNAL, f"db error getting assignment problem commit last: {exc}")
            return pb.GetAssignmentProblemCommitLastResponse(commit=commit)

        return self._with_tx(fn)

    def rpc_assignment_problem_step_latest_commit(
        self, request: pb.GetAssignmentProblemStepCommitLastRequest, context: grpc.ServicerContext
    ) -> pb.GetAssignmentProblemStepCommitLastResponse:
        def fn(tx: sqlite3.Connection) -> pb.GetAssignmentProblemStepCommitLastResponse:
            current_user = self._current_user_row(tx, context)
            try:
                commit = get_assignment_problem_step_commit_last_pb(
                    tx,
                    current_user,
                    int(request.assignment_id),
                    int(request.problem_id),
                    int(request.step),
                    self._ip_allowed(context),
                )
            except sqlite3.Error as exc:
                if _is_db_not_found(exc):
                    context.abort(grpc.StatusCode.NOT_FOUND, "not found")
                    raise AssertionError("unreachable")
                context.abort(grpc.StatusCode.INTERNAL, f"db error getting assignment problem step commit last: {exc}")
            return pb.GetAssignmentProblemStepCommitLastResponse(commit=commit)

        return self._with_tx(fn)

    def _select_daycare_host(self, _problem_types: set[str]) -> str:
        if self._daycare_registry is not None:
            try:
                return self._daycare_registry.assign(_problem_types)
            except Exception:
                pass
        return self._config.hostname

    def _problem_count_for_assignment(self, tx: sqlite3.Connection, assignment_id: int) -> int:
        row = tx.execute(
            "SELECT COUNT(1) AS c FROM problem_set_problems "
            "JOIN assignments ON assignments.problem_set_id = problem_set_problems.problem_set_id "
            "WHERE assignments.id = ?",
            (assignment_id,),
        ).fetchone()
        if row is None:
            return 1
        return max(1, int(row["c"]))

    def _build_grade_passback_target(
        self,
        tx: sqlite3.Connection,
        current_user_id: int,
        bundle: pb.CommitBundle,
    ) -> GradePassbackTarget | None:
        if not bundle.commit.HasField("report_card"):
            return None
        row = tx.execute("SELECT * FROM assignments WHERE id = ?", (int(bundle.commit.assignment_id),)).fetchone()
        if row is None:
            return None
        if int(row["user_id"]) != current_user_id:
            return None
        return GradePassbackTarget(
            assignment_id=int(row["id"]),
            user_id=int(row["user_id"]),
            grade_id=str(row["grade_id"] or ""),
            outcome_url=str(row["outcome_url"] or ""),
            outcome_ext_url=str(row["outcome_ext_url"] or ""),
            outcome_ext_accepted=str(row["outcome_ext_accepted"] or ""),
            consumer_key=str(row["consumer_key"] or ""),
            score=float(row["score"] or 0.0),
            canvas_title=str(row["canvas_title"] or ""),
        )

    def _log_commit_request(self, current_user: sqlite3.Row, bundle: pb.CommitBundle, *, request_signed: bool) -> None:
        note = ""
        if bundle.commit.note != "":
            note = f" ({bundle.commit.note})"
        problem_note = bundle.problem.note
        if bundle.commit.action == "" and bundle.commit_signature == "" and bundle.commit.note != "web autosave":
            logging.info(
                "sync request: user %s syncing %s step %d%s",
                current_user["name"],
                problem_note,
                int(bundle.commit.step),
                note,
            )
            return
        if bundle.commit.action != "" and not request_signed:
            logging.info(
                "pre-daycare commit: user %s (%d) action %s for %s step %d%s",
                current_user["name"],
                int(current_user["id"]),
                bundle.commit.action,
                problem_note,
                int(bundle.commit.step),
                note,
            )
            return
        if bundle.commit.action != "":
            logging.info(
                "post-daycare commit: user %s (%d) action %s for %s step %d%s",
                current_user["name"],
                int(current_user["id"]),
                bundle.commit.action,
                problem_note,
                int(bundle.commit.step),
                note,
            )

    def rpc_problem_bundle_unconfirmed(
        self, request: pb.PostProblemBundleUnconfirmedRequest, context: grpc.ServicerContext
    ) -> pb.PostProblemBundleUnconfirmedResponse:
        if request is None or not request.HasField("bundle"):
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "bundle is required")
            raise AssertionError("unreachable")

        def fn(tx: sqlite3.Connection) -> pb.PostProblemBundleUnconfirmedResponse:
            current_user = self._current_user_row(tx, context)
            self._require_author(current_user, context)
            try:
                bundle = sign_problem_bundle_unconfirmed(
                    tx,
                    int(current_user["id"]),
                    request.bundle,
                    self._config.daycare_secret,
                    str(self._root / "files"),
                    self._select_daycare_host,
                )
            except Exception as exc:
                context.abort(grpc.StatusCode.INTERNAL, f"db error posting problem bundle unconfirmed: {exc}")
            return pb.PostProblemBundleUnconfirmedResponse(bundle=bundle)

        return self._with_tx(fn)

    def rpc_problem_bundle_confirmed(
        self, request: pb.PostProblemBundleConfirmedRequest, context: grpc.ServicerContext
    ) -> pb.PostProblemBundleConfirmedResponse:
        if request is None or not request.HasField("bundle"):
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "bundle is required")
            raise AssertionError("unreachable")

        def fn(tx: sqlite3.Connection) -> pb.PostProblemBundleConfirmedResponse:
            current_user = self._current_user_row(tx, context)
            self._require_author(current_user, context)
            try:
                bundle = save_problem_bundle_common(
                    tx,
                    int(current_user["id"]),
                    request.bundle,
                    self._config.daycare_secret,
                    str(self._root / "files"),
                )
            except Exception as exc:
                context.abort(grpc.StatusCode.INTERNAL, f"db error posting problem bundle confirmed: {exc}")
            return pb.PostProblemBundleConfirmedResponse(bundle=bundle)

        return self._with_tx(fn)

    def rpc_update_problem_bundle(
        self, request: pb.PutProblemBundleRequest, context: grpc.ServicerContext
    ) -> pb.PutProblemBundleResponse:
        if request is None or not request.HasField("bundle"):
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "bundle is required")
            raise AssertionError("unreachable")

        def fn(tx: sqlite3.Connection) -> pb.PutProblemBundleResponse:
            current_user = self._current_user_row(tx, context)
            self._require_author(current_user, context)
            try:
                bundle = update_problem_bundle(
                    tx,
                    int(current_user["id"]),
                    int(request.problem_id),
                    request.bundle,
                    self._config.daycare_secret,
                    str(self._root / "files"),
                )
            except Exception as exc:
                context.abort(grpc.StatusCode.INTERNAL, f"db error putting problem bundle: {exc}")
            return pb.PutProblemBundleResponse(bundle=bundle)

        return self._with_tx(fn)

    def rpc_create_problem_set_bundle(
        self, request: pb.PostProblemSetBundleRequest, context: grpc.ServicerContext
    ) -> pb.PostProblemSetBundleResponse:
        if request is None or not request.HasField("bundle"):
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "bundle is required")
            raise AssertionError("unreachable")

        def fn(tx: sqlite3.Connection) -> pb.PostProblemSetBundleResponse:
            try:
                bundle = create_problem_set_bundle(tx, request.bundle)
            except Exception as exc:
                context.abort(grpc.StatusCode.INTERNAL, f"db error posting problem set bundle: {exc}")
            return pb.PostProblemSetBundleResponse(bundle=bundle)

        return self._with_tx(fn)

    def rpc_update_problem_set_bundle(
        self, request: pb.PutProblemSetBundleRequest, context: grpc.ServicerContext
    ) -> pb.PutProblemSetBundleResponse:
        if request is None or not request.HasField("bundle"):
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "bundle is required")
            raise AssertionError("unreachable")

        def fn(tx: sqlite3.Connection) -> pb.PutProblemSetBundleResponse:
            try:
                bundle = update_problem_set_bundle(tx, request.bundle)
            except Exception as exc:
                context.abort(grpc.StatusCode.INTERNAL, f"db error putting problem set bundle: {exc}")
            return pb.PutProblemSetBundleResponse(bundle=bundle)

        return self._with_tx(fn)

    def rpc_commit_bundle_unsigned(
        self, request: pb.PostCommitBundlesUnsignedRequest, context: grpc.ServicerContext
    ) -> pb.PostCommitBundlesUnsignedResponse:
        if request is None or not request.HasField("bundle"):
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "bundle is required")
            raise AssertionError("unreachable")

        passback_target: GradePassbackTarget | None = None
        passback_html = ""

        def fn(tx: sqlite3.Connection) -> pb.PostCommitBundlesUnsignedResponse:
            nonlocal passback_target, passback_html
            current_user = self._current_user_row(tx, context)
            working = pb.CommitBundle()
            working.CopyFrom(request.bundle)
            working.hostname = ""
            working.commit_signature = ""
            del working.commit.transcript[:]
            working.commit.ClearField("report_card")
            working.commit.score = 0.0
            now = datetime.now(tz=UTC)
            working.commit.created_at.FromDatetime(now)
            working.commit.updated_at.FromDatetime(now)
            try:
                bundle = save_commit_bundle_common(
                    tx,
                    int(current_user["id"]),
                    working,
                    self._config.daycare_secret,
                    str(self._root / "files"),
                    self._ip_allowed(context),
                    self._select_daycare_host,
                )
            except Exception as exc:
                context.abort(grpc.StatusCode.INTERNAL, f"db error posting commit bundles unsigned: {exc}")
            self._log_commit_request(current_user, bundle, request_signed=False)
            passback_target = self._build_grade_passback_target(tx, int(current_user["id"]), bundle)
            if passback_target is not None:
                passback_html = build_grade_report_html(
                    bundle.commit,
                    bundle.problem.unique,
                    len(bundle.problem_steps),
                    self._problem_count_for_assignment(tx, int(bundle.commit.assignment_id)),
                )
            return pb.PostCommitBundlesUnsignedResponse(bundle=bundle)

        response = self._with_tx(fn)
        if passback_target is not None:
            save_grade_async(passback_target, passback_html, self._config.lti_secret)
        return response

    def rpc_commit_bundle_signed(
        self, request: pb.PostCommitBundlesSignedRequest, context: grpc.ServicerContext
    ) -> pb.PostCommitBundlesSignedResponse:
        if request is None or not request.HasField("bundle"):
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "bundle is required")
            raise AssertionError("unreachable")

        passback_target: GradePassbackTarget | None = None
        passback_html = ""

        def fn(tx: sqlite3.Connection) -> pb.PostCommitBundlesSignedResponse:
            nonlocal passback_target, passback_html
            current_user = self._current_user_row(tx, context)
            try:
                bundle = save_commit_bundle_common(
                    tx,
                    int(current_user["id"]),
                    request.bundle,
                    self._config.daycare_secret,
                    str(self._root / "files"),
                    self._ip_allowed(context),
                    self._select_daycare_host,
                )
            except Exception as exc:
                context.abort(grpc.StatusCode.INTERNAL, f"db error posting commit bundles signed: {exc}")
            self._log_commit_request(current_user, bundle, request_signed=True)
            passback_target = self._build_grade_passback_target(tx, int(current_user["id"]), bundle)
            if passback_target is not None:
                passback_html = build_grade_report_html(
                    bundle.commit,
                    bundle.problem.unique,
                    len(bundle.problem_steps),
                    self._problem_count_for_assignment(tx, int(bundle.commit.assignment_id)),
                )
            return pb.PostCommitBundlesSignedResponse(bundle=bundle)

        response = self._with_tx(fn)
        if passback_target is not None:
            save_grade_async(passback_target, passback_html, self._config.lti_secret)
        return response

    def rpc_daycare_stream(self, request: pb.DaycareRequest, context: grpc.ServicerContext) -> Iterator[pb.DaycareResponse]:
        yield from self._daycare.stream(request, context)

    # protobuf service interface mapping
    def Hello(self, request: pb.HelloRequest, context: grpc.ServicerContext) -> pb.HelloResponse:
        return self.rpc_hello(request, context)

    def ListProblems(self, request: pb.ListProblemsRequest, context: grpc.ServicerContext) -> pb.ListProblemsResponse:
        return self.rpc_list_problems(request, context)

    def GetVersion(self, request: pb.GetVersionRequest, context: grpc.ServicerContext) -> pb.GetVersionResponse:
        return self.rpc_version(request, context)

    def GetProblemTypes(self, request: pb.GetProblemTypesRequest, context: grpc.ServicerContext) -> pb.GetProblemTypesResponse:
        return self.rpc_problem_types(request, context)

    def GetProblemType(self, request: pb.GetProblemTypeRequest, context: grpc.ServicerContext) -> pb.GetProblemTypeResponse:
        return self.rpc_problem_type(request, context)

    def GetProblems(self, request: pb.GetProblemsRequest, context: grpc.ServicerContext) -> pb.GetProblemsResponse:
        return self.rpc_problems(request, context)

    def GetProblem(self, request: pb.GetProblemRequest, context: grpc.ServicerContext) -> pb.GetProblemResponse:
        return self.rpc_problem(request, context)

    def GetProblemSteps(self, request: pb.GetProblemStepsRequest, context: grpc.ServicerContext) -> pb.GetProblemStepsResponse:
        return self.rpc_problem_steps(request, context)

    def GetProblemStep(self, request: pb.GetProblemStepRequest, context: grpc.ServicerContext) -> pb.GetProblemStepResponse:
        return self.rpc_problem_step(request, context)

    def GetProblemSets(self, request: pb.GetProblemSetsRequest, context: grpc.ServicerContext) -> pb.GetProblemSetsResponse:
        return self.rpc_problem_sets(request, context)

    def GetProblemSet(self, request: pb.GetProblemSetRequest, context: grpc.ServicerContext) -> pb.GetProblemSetResponse:
        return self.rpc_problem_set(request, context)

    def GetProblemSetProblems(
        self, request: pb.GetProblemSetProblemsRequest, context: grpc.ServicerContext
    ) -> pb.GetProblemSetProblemsResponse:
        return self.rpc_problem_set_problems(request, context)

    def GetCourses(self, request: pb.GetCoursesRequest, context: grpc.ServicerContext) -> pb.GetCoursesResponse:
        return self.rpc_courses(request, context)

    def GetCourse(self, request: pb.GetCourseRequest, context: grpc.ServicerContext) -> pb.GetCourseResponse:
        return self.rpc_course(request, context)

    def GetUsers(self, request: pb.GetUsersRequest, context: grpc.ServicerContext) -> pb.GetUsersResponse:
        return self.rpc_users(request, context)

    def GetUserMe(self, request: pb.GetUserMeRequest, context: grpc.ServicerContext) -> pb.GetUserMeResponse:
        return self.rpc_current_user(request, context)

    def GetUserSession(self, request: pb.GetUserSessionRequest, context: grpc.ServicerContext) -> pb.GetUserSessionResponse:
        return self.rpc_exchange_user_session(request, context)

    def GetUser(self, request: pb.GetUserRequest, context: grpc.ServicerContext) -> pb.GetUserResponse:
        return self.rpc_user(request, context)

    def GetCourseUsers(self, request: pb.GetCourseUsersRequest, context: grpc.ServicerContext) -> pb.GetCourseUsersResponse:
        return self.rpc_course_users(request, context)

    def GetUserAssignments(
        self, request: pb.GetUserAssignmentsRequest, context: grpc.ServicerContext
    ) -> pb.GetUserAssignmentsResponse:
        return self.rpc_user_assignments(request, context)

    def GetCourseUserAssignments(
        self, request: pb.GetCourseUserAssignmentsRequest, context: grpc.ServicerContext
    ) -> pb.GetCourseUserAssignmentsResponse:
        return self.rpc_course_user_assignments(request, context)

    def GetAssignments(self, request: pb.GetAssignmentsRequest, context: grpc.ServicerContext) -> pb.GetAssignmentsResponse:
        return self.rpc_assignments(request, context)

    def GetAssignment(self, request: pb.GetAssignmentRequest, context: grpc.ServicerContext) -> pb.GetAssignmentResponse:
        return self.rpc_assignment(request, context)

    def GetAssignmentProblemCommitLast(
        self, request: pb.GetAssignmentProblemCommitLastRequest, context: grpc.ServicerContext
    ) -> pb.GetAssignmentProblemCommitLastResponse:
        return self.rpc_assignment_problem_latest_commit(request, context)

    def GetAssignmentProblemStepCommitLast(
        self, request: pb.GetAssignmentProblemStepCommitLastRequest, context: grpc.ServicerContext
    ) -> pb.GetAssignmentProblemStepCommitLastResponse:
        return self.rpc_assignment_problem_step_latest_commit(request, context)

    def PostProblemBundleUnconfirmed(
        self, request: pb.PostProblemBundleUnconfirmedRequest, context: grpc.ServicerContext
    ) -> pb.PostProblemBundleUnconfirmedResponse:
        return self.rpc_problem_bundle_unconfirmed(request, context)

    def PostProblemBundleConfirmed(
        self, request: pb.PostProblemBundleConfirmedRequest, context: grpc.ServicerContext
    ) -> pb.PostProblemBundleConfirmedResponse:
        return self.rpc_problem_bundle_confirmed(request, context)

    def PutProblemBundle(self, request: pb.PutProblemBundleRequest, context: grpc.ServicerContext) -> pb.PutProblemBundleResponse:
        return self.rpc_update_problem_bundle(request, context)

    def PostProblemSetBundle(
        self, request: pb.PostProblemSetBundleRequest, context: grpc.ServicerContext
    ) -> pb.PostProblemSetBundleResponse:
        return self.rpc_create_problem_set_bundle(request, context)

    def PutProblemSetBundle(
        self, request: pb.PutProblemSetBundleRequest, context: grpc.ServicerContext
    ) -> pb.PutProblemSetBundleResponse:
        return self.rpc_update_problem_set_bundle(request, context)

    def PostCommitBundlesUnsigned(
        self, request: pb.PostCommitBundlesUnsignedRequest, context: grpc.ServicerContext
    ) -> pb.PostCommitBundlesUnsignedResponse:
        return self.rpc_commit_bundle_unsigned(request, context)

    def PostCommitBundlesSigned(
        self, request: pb.PostCommitBundlesSignedRequest, context: grpc.ServicerContext
    ) -> pb.PostCommitBundlesSignedResponse:
        return self.rpc_commit_bundle_signed(request, context)

    def Daycare(self, request: pb.DaycareRequest, context: grpc.ServicerContext) -> Iterator[pb.DaycareResponse]:
        yield from self.rpc_daycare_stream(request, context)
