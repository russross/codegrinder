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
    prepare_problem,
    save_grading_commit_common,
    save_problem,
    save_problem_set,
    save_runtime_bundle_common,
)
from read_store import (
    get_assignment_list_items_pb,
    get_assignment_summary_pb,
    get_workspace_pb,
    get_problem_type_actions_rows,
    get_problem_types_rows,
    load_user_by_id,
    problem_type_pb,
    search_problem_catalog_pb,
)
from signatures import decode_signed_runtime_bundle, encode_signed_runtime_bundle
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
                except Exception:
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
        is_admin = bool(user_row["admin"]) if "admin" in user_row.keys() else False
        is_author = bool(user_row["author"]) if "author" in user_row.keys() else False
        if is_admin or is_author:
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

    def _problem_type_files(self, problem_type: str) -> dict[str, bytes]:
        files: dict[str, bytes] = {}
        directory = self._root / "files" / problem_type
        if not directory.exists() or not directory.is_dir():
            return files
        for path in directory.rglob("*"):
            if not path.is_file():
                continue
            files[str(path.relative_to(directory))] = path.read_bytes()
        return files

    def _load_problem_type(self, tx: sqlite3.Connection, problem_type: str) -> pb.ProblemType:
        row = tx.execute("SELECT * FROM problem_types WHERE problem_type = ?", (problem_type,)).fetchone()
        if row is None:
            raise sqlite3.Error("not found")
        action_rows = get_problem_type_actions_rows(tx, problem_type)
        return problem_type_pb(
            str(row["problem_type"]),
            str(row["container"]),
            self._problem_type_files(problem_type),
            action_rows,
        )

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
                    user=pb.User(
                        user_id=str(user_row["user_id"]),
                        user_name=str(user_row["user_name"]),
                        user_login=str(user_row["user_login"]),
                        author=bool(user_row["author"]) if "author" in user_row.keys() else False,
                    ),
                    version=version,
                )

            return self._with_tx(fn)

        def fn2(tx: sqlite3.Connection) -> pb.HelloResponse:
            user_row = self._current_user_row(tx, context)
            return pb.HelloResponse(
                user=pb.User(
                    user_id=str(user_row["user_id"]),
                    user_name=str(user_row["user_name"]),
                    user_login=str(user_row["user_login"]),
                    author=bool(user_row["author"]) if "author" in user_row.keys() else False,
                ),
                version=version,
            )

        return self._with_tx(fn2)

    def rpc_list_assignments(
        self, request: pb.ListAssignmentsRequest, context: grpc.ServicerContext
    ) -> pb.ListAssignmentsResponse:
        def fn(tx: sqlite3.Connection) -> pb.ListAssignmentsResponse:
            current_user = self._current_user_row(tx, context)
            try:
                items = get_assignment_list_items_pb(
                    tx,
                    current_user,
                    list(request.search),
                    bool(request.include_student_context),
                    self._ip_allowed(context),
                )
            except sqlite3.Error as exc:
                context.abort(grpc.StatusCode.INTERNAL, f"db error listing assignments: {exc}")
            return pb.ListAssignmentsResponse(items=items)

        return self._with_tx(fn)

    def rpc_search_problem_catalog(
        self, request: pb.SearchProblemCatalogRequest, context: grpc.ServicerContext
    ) -> pb.SearchProblemCatalogResponse:
        def fn(tx: sqlite3.Connection) -> pb.SearchProblemCatalogResponse:
            current_user = self._current_user_row(tx, context)
            try:
                response = search_problem_catalog_pb(tx, current_user, list(request.search))
            except sqlite3.Error as exc:
                context.abort(grpc.StatusCode.INTERNAL, f"db error searching problem catalog: {exc}")
            return response

        return self._with_tx(fn)

    def rpc_problem_types(self, _request: pb.GetProblemTypesRequest, context: grpc.ServicerContext) -> pb.GetProblemTypesResponse:
        def fn(tx: sqlite3.Connection) -> pb.GetProblemTypesResponse:
            try:
                rows = get_problem_types_rows(tx)
                types = [self._load_problem_type(tx, str(row["problem_type"])) for row in rows]
            except sqlite3.Error as exc:
                context.abort(grpc.StatusCode.INTERNAL, f"db error getting problem types: {exc}")
            return pb.GetProblemTypesResponse(problem_types=types)

        return self._with_tx(fn)

    def rpc_problem_type(self, request: pb.GetProblemTypeRequest, context: grpc.ServicerContext) -> pb.GetProblemTypeResponse:
        def fn(tx: sqlite3.Connection) -> pb.GetProblemTypeResponse:
            try:
                problem_type = self._load_problem_type(tx, request.problem_type)
            except sqlite3.Error as exc:
                if _is_db_not_found(exc):
                    context.abort(grpc.StatusCode.NOT_FOUND, "not found")
                    raise AssertionError("unreachable")
                context.abort(grpc.StatusCode.INTERNAL, f"db error getting problem type: {exc}")
            return pb.GetProblemTypeResponse(problem_type=problem_type)

        return self._with_tx(fn)

    def rpc_assignment(self, request: pb.GetAssignmentRequest, context: grpc.ServicerContext) -> pb.GetAssignmentResponse:
        def fn(tx: sqlite3.Connection) -> pb.GetAssignmentResponse:
            current_user = self._current_user_row(tx, context)
            try:
                asst = get_assignment_summary_pb(
                    tx,
                    current_user,
                    request.assignment,
                    self._ip_allowed(context),
                )
            except sqlite3.Error as exc:
                if _is_db_not_found(exc):
                    context.abort(grpc.StatusCode.NOT_FOUND, "not found")
                    raise AssertionError("unreachable")
                context.abort(grpc.StatusCode.INTERNAL, f"db error getting assignment: {exc}")
            return asst

        return self._with_tx(fn)

    def rpc_workspace(self, request: pb.GetWorkspaceRequest, context: grpc.ServicerContext) -> pb.GetWorkspaceResponse:
        def fn(tx: sqlite3.Connection) -> pb.GetWorkspaceResponse:
            current_user = self._current_user_row(tx, context)
            try:
                return get_workspace_pb(
                    tx,
                    current_user,
                    request.assignment,
                    request.problem_id,
                    int(request.step_number),
                    request.file_state,
                    bool(request.include_contents),
                    bool(request.include_solution_files),
                    self._ip_allowed(context),
                    self._problem_type_files,
                )
            except PermissionError as exc:
                context.abort(grpc.StatusCode.PERMISSION_DENIED, str(exc))
            except sqlite3.Error as exc:
                if _is_db_not_found(exc):
                    context.abort(grpc.StatusCode.NOT_FOUND, "not found")
                    raise AssertionError("unreachable")
                context.abort(grpc.StatusCode.INTERNAL, f"db error getting workspace: {exc}")
            raise AssertionError("unreachable")

        return self._with_tx(fn)

    def _select_daycare_host(self, _problem_types: set[str]) -> str:
        if self._daycare_registry is not None:
            try:
                return self._daycare_registry.assign(_problem_types)
            except Exception:
                pass
        return self._config.hostname

    def _problem_count_for_assignment(
        self,
        tx: sqlite3.Connection,
        assignment_user_id: str,
        assignment_course_id: str,
        assignment_problem_set_id: str,
    ) -> int:
        row = tx.execute(
            "SELECT COUNT(1) AS c FROM problem_set_problems "
            "NATURAL JOIN assignments "
            "WHERE assignments.user_id = ? AND assignments.course_id = ? AND assignments.problem_set_id = ?",
            (assignment_user_id, assignment_course_id, assignment_problem_set_id),
        ).fetchone()
        if row is None:
            return 1
        return max(1, int(row["c"]))

    def _build_grade_passback_target(
        self,
        tx: sqlite3.Connection,
        current_user_id: str,
        bundle: pb.RuntimeBundle,
    ) -> GradePassbackTarget | None:
        if not bundle.commit.HasField("report_card"):
            return None
        row = tx.execute(
            "SELECT * FROM assignments WHERE user_id = ? AND course_id = ? AND problem_set_id = ?",
            (
                bundle.commit.assignment.user_id,
                bundle.commit.assignment.course_id,
                bundle.commit.assignment.problem_set_id,
            ),
        ).fetchone()
        if row is None:
            return None
        if str(row["user_id"]) != current_user_id:
            return None
        score = 0.0
        if bundle.commit.HasField("report_card"):
            score = float(bundle.commit.score)
        return GradePassbackTarget(
            user_id=str(row["user_id"]),
            course_id=str(row["course_id"]),
            problem_set_id=str(row["problem_set_id"]),
            grade_id=str(row["grade_id"] or ""),
            outcome_url=str(row["outcome_url"] or ""),
            outcome_ext_accepted=str(row["outcome_ext_accepted"] or ""),
            consumer_key=str(row["consumer_key"] or ""),
            score=score,
        )

    def _log_commit_request(self, current_user: sqlite3.Row, bundle: pb.RuntimeBundle, *, request_signed: bool) -> None:
        note = ""
        if bundle.commit.note != "":
            note = f" ({bundle.commit.note})"
        problem_note = bundle.problem_note
        if bundle.commit.action == "" and bundle.commit.note != "web autosave":
            logging.info(
                "sync request: user %s syncing %s step %d%s",
                current_user["user_name"],
                problem_note,
                int(bundle.commit.step),
                note,
            )
            return
        if bundle.commit.action != "" and not request_signed:
            logging.info(
                "pre-daycare commit: user %s (%s) action %s for %s step %d%s",
                current_user["user_name"],
                str(current_user["user_id"]),
                bundle.commit.action,
                problem_note,
                int(bundle.commit.step),
                note,
            )
            return
        if bundle.commit.action != "":
            logging.info(
                "post-daycare commit: user %s (%s) action %s for %s step %d%s",
                current_user["user_name"],
                str(current_user["user_id"]),
                bundle.commit.action,
                problem_note,
                int(bundle.commit.step),
                note,
            )

    def rpc_prepare_problem(
        self, request: pb.PrepareProblemRequest, context: grpc.ServicerContext
    ) -> pb.PrepareProblemResponse:
        if request is None or not request.HasField("draft"):
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "draft is required")
            raise AssertionError("unreachable")

        def fn(tx: sqlite3.Connection) -> pb.PrepareProblemResponse:
            current_user = self._current_user_row(tx, context)
            self._require_author(current_user, context)
            try:
                bundle = prepare_problem(
                    tx,
                    str(current_user["user_id"]),
                    request.draft,
                    request.action,
                    self._config.daycare_secret,
                    self._select_daycare_host,
                    self._problem_type_files,
                )
            except ValueError as exc:
                context.abort(grpc.StatusCode.INVALID_ARGUMENT, f"invalid problem draft: {exc}")
            except Exception as exc:
                context.abort(grpc.StatusCode.INTERNAL, f"db error preparing problem: {exc}")
            return pb.PrepareProblemResponse(bundle=bundle)

        return self._with_tx(fn)

    def rpc_save_problem(self, request: pb.SaveProblemRequest, context: grpc.ServicerContext) -> pb.SaveProblemResponse:
        if request is None or not request.HasField("bundle"):
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "bundle is required")
            raise AssertionError("unreachable")

        def fn(tx: sqlite3.Connection) -> pb.SaveProblemResponse:
            current_user = self._current_user_row(tx, context)
            self._require_author(current_user, context)
            try:
                bundle = save_problem(
                    tx,
                    str(current_user["user_id"]),
                    request.mode,
                    request.bundle,
                )
            except ValueError as exc:
                context.abort(grpc.StatusCode.INVALID_ARGUMENT, f"invalid problem save: {exc}")
            except Exception as exc:
                context.abort(grpc.StatusCode.INTERNAL, f"db error saving problem: {exc}")
            return pb.SaveProblemResponse(bundle=bundle)

        return self._with_tx(fn)

    def rpc_save_problem_set(
        self, request: pb.SaveProblemSetRequest, context: grpc.ServicerContext
    ) -> pb.SaveProblemSetResponse:
        if request is None or not request.HasField("bundle"):
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "bundle is required")
            raise AssertionError("unreachable")

        def fn(tx: sqlite3.Connection) -> pb.SaveProblemSetResponse:
            current_user = self._current_user_row(tx, context)
            self._require_author(current_user, context)
            try:
                bundle = save_problem_set(
                    tx,
                    request.mode,
                    request.bundle,
                )
            except ValueError as exc:
                context.abort(grpc.StatusCode.INVALID_ARGUMENT, f"invalid problem set save: {exc}")
            except Exception as exc:
                context.abort(grpc.StatusCode.INTERNAL, f"db error saving problem set: {exc}")
            return pb.SaveProblemSetResponse(bundle=bundle)

        return self._with_tx(fn)

    def rpc_save_ungraded_commit(
        self, request: pb.SaveUngradedCommitRequest, context: grpc.ServicerContext
    ) -> pb.SaveUngradedCommitResponse:
        if request is None or not request.HasField("commit"):
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "commit is required")
            raise AssertionError("unreachable")

        passback_target: GradePassbackTarget | None = None
        passback_html = ""

        def fn(tx: sqlite3.Connection) -> pb.SaveUngradedCommitResponse:
            nonlocal passback_target, passback_html
            current_user = self._current_user_row(tx, context)
            working = pb.GradingCommit()
            working.CopyFrom(request.commit)
            working.hostname = ""
            del working.commit.transcript[:]
            working.commit.ClearField("report_card")
            working.commit.score = 0.0
            now = datetime.now(tz=UTC)
            working.commit.created_at.FromDatetime(now)
            working.commit.updated_at.FromDatetime(now)
            try:
                bundle = save_grading_commit_common(
                    tx,
                    str(current_user["user_id"]),
                    working,
                    self._config.daycare_secret,
                    self._ip_allowed(context),
                    self._select_daycare_host,
                    self._problem_type_files,
                    graded=False,
                )
            except Exception as exc:
                context.abort(grpc.StatusCode.INTERNAL, f"db error saving ungraded commit: {exc}")
            self._log_commit_request(current_user, bundle, request_signed=False)
            passback_target = self._build_grade_passback_target(tx, str(current_user["user_id"]), bundle)
            if passback_target is not None:
                passback_html = build_grade_report_html(
                    bundle.commit,
                    bundle.problem_id,
                    bundle.total_steps,
                    self._problem_count_for_assignment(
                        tx,
                        bundle.commit.assignment.user_id,
                        bundle.commit.assignment.course_id,
                        bundle.commit.assignment.problem_set_id,
                    ),
                )
            return pb.SaveUngradedCommitResponse(bundle=encode_signed_runtime_bundle(bundle, self._config.daycare_secret))

        response = self._with_tx(fn)
        if passback_target is not None:
            save_grade_async(passback_target, passback_html, self._config.lti_secret)
        return response

    def rpc_save_graded_commit(
        self, request: pb.SaveGradedCommitRequest, context: grpc.ServicerContext
    ) -> pb.SaveGradedCommitResponse:
        if request is None or not request.HasField("bundle"):
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "bundle is required")
            raise AssertionError("unreachable")

        passback_target: GradePassbackTarget | None = None
        passback_html = ""

        def fn(tx: sqlite3.Connection) -> pb.SaveGradedCommitResponse:
            nonlocal passback_target, passback_html
            current_user = self._current_user_row(tx, context)
            try:
                runtime = decode_signed_runtime_bundle(request.bundle, self._config.daycare_secret)
                bundle = save_runtime_bundle_common(
                    tx,
                    str(current_user["user_id"]),
                    runtime,
                    self._ip_allowed(context),
                    graded=True,
                )
            except ValueError as exc:
                context.abort(grpc.StatusCode.INVALID_ARGUMENT, f"invalid graded commit: {exc}")
            except Exception as exc:
                context.abort(grpc.StatusCode.INTERNAL, f"db error saving graded commit: {exc}")
            self._log_commit_request(current_user, bundle, request_signed=True)
            passback_target = self._build_grade_passback_target(tx, str(current_user["user_id"]), bundle)
            if passback_target is not None:
                passback_html = build_grade_report_html(
                    bundle.commit,
                    bundle.problem_id,
                    bundle.total_steps,
                    self._problem_count_for_assignment(
                        tx,
                        bundle.commit.assignment.user_id,
                        bundle.commit.assignment.course_id,
                        bundle.commit.assignment.problem_set_id,
                    ),
                )
            return pb.SaveGradedCommitResponse()

        response = self._with_tx(fn)
        if passback_target is not None:
            save_grade_async(passback_target, passback_html, self._config.lti_secret)
        return response

    def rpc_daycare_stream(self, request: pb.DaycareRequest, context: grpc.ServicerContext) -> Iterator[pb.DaycareResponse]:
        yield from self._daycare.stream(request, context)

    # protobuf service interface mapping
    def Hello(self, request: pb.HelloRequest, context: grpc.ServicerContext) -> pb.HelloResponse:
        return self.rpc_hello(request, context)

    def ListAssignments(self, request: pb.ListAssignmentsRequest, context: grpc.ServicerContext) -> pb.ListAssignmentsResponse:
        return self.rpc_list_assignments(request, context)

    def SearchProblemCatalog(
        self, request: pb.SearchProblemCatalogRequest, context: grpc.ServicerContext
    ) -> pb.SearchProblemCatalogResponse:
        return self.rpc_search_problem_catalog(request, context)

    def GetProblemTypes(self, request: pb.GetProblemTypesRequest, context: grpc.ServicerContext) -> pb.GetProblemTypesResponse:
        return self.rpc_problem_types(request, context)

    def GetProblemType(self, request: pb.GetProblemTypeRequest, context: grpc.ServicerContext) -> pb.GetProblemTypeResponse:
        return self.rpc_problem_type(request, context)

    def GetAssignment(self, request: pb.GetAssignmentRequest, context: grpc.ServicerContext) -> pb.GetAssignmentResponse:
        return self.rpc_assignment(request, context)

    def GetWorkspace(self, request: pb.GetWorkspaceRequest, context: grpc.ServicerContext) -> pb.GetWorkspaceResponse:
        return self.rpc_workspace(request, context)

    def PrepareProblem(self, request: pb.PrepareProblemRequest, context: grpc.ServicerContext) -> pb.PrepareProblemResponse:
        return self.rpc_prepare_problem(request, context)

    def SaveProblem(self, request: pb.SaveProblemRequest, context: grpc.ServicerContext) -> pb.SaveProblemResponse:
        return self.rpc_save_problem(request, context)

    def SaveProblemSet(self, request: pb.SaveProblemSetRequest, context: grpc.ServicerContext) -> pb.SaveProblemSetResponse:
        return self.rpc_save_problem_set(request, context)

    def SaveUngradedCommit(
        self, request: pb.SaveUngradedCommitRequest, context: grpc.ServicerContext
    ) -> pb.SaveUngradedCommitResponse:
        return self.rpc_save_ungraded_commit(request, context)

    def SaveGradedCommit(
        self, request: pb.SaveGradedCommitRequest, context: grpc.ServicerContext
    ) -> pb.SaveGradedCommitResponse:
        return self.rpc_save_graded_commit(request, context)

    def Daycare(self, request: pb.DaycareRequest, context: grpc.ServicerContext) -> Iterator[pb.DaycareResponse]:
        yield from self.rpc_daycare_stream(request, context)
