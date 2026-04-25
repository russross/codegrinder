from __future__ import annotations

import contextvars
import logging
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable, Iterator, NoReturn, TypeVar

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
    save_graded_runtime_bundle,
    save_problem,
    save_problem_set,
    save_ungraded_commit,
    save_workspace_commit,
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


@dataclass(frozen=True, slots=True)
class RpcState:
    tx: sqlite3.Connection
    current_user: sqlite3.Row | None = None
    ip_allowed: bool = True


@dataclass(frozen=True, slots=True)
class _PassbackWork:
    response: pb.SaveGradedCommitResponse
    target: GradePassbackTarget | None = None
    html: str = ""


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

    def _with_tx(self, label: str, fn: Callable[[sqlite3.Connection], T]) -> T:
        with transaction(self._conn, label=label) as tx:
            return fn(tx)

    def _run_rpc(
        self,
        context: grpc.ServicerContext,
        *,
        label: str,
        load_user: bool = False,
        require_author: bool = False,
        include_ip: bool = False,
        fn: Callable[[RpcState], T],
    ) -> T:
        ip_allowed = self._ip_allowed(context) if include_ip else True

        def run(tx: sqlite3.Connection) -> T:
            current_user = self._current_user_row(tx, context) if load_user or require_author else None
            if require_author and current_user is not None:
                self._require_author(current_user, context)
            return fn(RpcState(tx=tx, current_user=current_user, ip_allowed=ip_allowed))

        return self._with_tx(label, run)

    def _abort(self, context: grpc.ServicerContext, code: grpc.StatusCode, details: str) -> NoReturn:
        context.abort(code, details)
        raise AssertionError("unreachable")

    def _abort_sqlite(
        self,
        context: grpc.ServicerContext,
        exc: sqlite3.Error,
        *,
        internal: str,
        not_found: str | None = None,
    ) -> NoReturn:
        if not_found is not None and _is_db_not_found(exc):
            self._abort(context, grpc.StatusCode.NOT_FOUND, not_found)
        self._abort(context, grpc.StatusCode.INTERNAL, f"{internal}: {exc}")

    def _require_author(self, user_row: sqlite3.Row, context: grpc.ServicerContext) -> None:
        is_admin = bool(user_row["admin"]) if "admin" in user_row.keys() else False
        is_author = bool(user_row["author"]) if "author" in user_row.keys() else False
        if is_admin or is_author:
            return
        self._abort(context, grpc.StatusCode.PERMISSION_DENIED, "user is not an author")

    def _get_cookie_value(self, context: grpc.ServicerContext) -> str:
        md = context.invocation_metadata()
        cookies: list[str] = []
        for item in md:
            if item.key.lower() == "cookie":
                cookies.append(item.value)
        if not cookies:
            self._abort(context, grpc.StatusCode.UNAUTHENTICATED, "missing session cookie")
        for cookie_header in cookies:
            for part in cookie_header.split(";"):
                chunk = part.strip()
                if chunk.startswith(COOKIE_NAME + "="):
                    return chunk[len(COOKIE_NAME) + 1 :]
        self._abort(context, grpc.StatusCode.UNAUTHENTICATED, "missing session cookie")

    def _current_user_row(self, tx: sqlite3.Connection, context: grpc.ServicerContext) -> sqlite3.Row:
        cookie_value = self._get_cookie_value(context)
        try:
            session = decode_session(cookie_value, self._config.session_secret, datetime.now(tz=UTC))
        except SessionError as exc:
            self._abort(context, grpc.StatusCode.UNAUTHENTICATED, str(exc))
        try:
            return load_user_by_id(tx, session.user_id)
        except sqlite3.Error as exc:
            self._abort(context, grpc.StatusCode.INTERNAL, f"db error loading user: {exc}")

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

    def _user_pb(self, user_row: sqlite3.Row) -> pb.User:
        return pb.User(
            user_id=str(user_row["user_id"]),
            user_name=str(user_row["user_name"]),
            user_login=str(user_row["user_login"]),
            author=bool(user_row["author"]) if "author" in user_row.keys() else False,
        )

    def _require_field(
        self,
        request: Any,
        *,
        field: str,
        label: str,
        context: grpc.ServicerContext,
    ) -> None:
        if request is None or not request.HasField(field):
            self._abort(context, grpc.StatusCode.INVALID_ARGUMENT, f"{label} is required")

    # gRPC-native names
    def Hello(self, request: pb.HelloRequest, context: grpc.ServicerContext) -> pb.HelloResponse:
        version = self._version.to_pb()
        if request.key:
            try:
                user_id = self._login_records.get(request.key, datetime.now(tz=UTC))
            except SessionError as exc:
                self._abort(context, grpc.StatusCode.INVALID_ARGUMENT, str(exc))
            session = new_session(user_id, datetime.now(tz=UTC), self._config.sessions_expire)
            cookie_value = encode_session(session, self._config.session_secret)

            def fn(state: RpcState) -> pb.HelloResponse:
                try:
                    user_row = load_user_by_id(state.tx, user_id)
                except sqlite3.Error as exc:
                    self._abort_sqlite(context, exc, internal="db error getting user me")
                return pb.HelloResponse(
                    cookie=f"{COOKIE_NAME}={cookie_value}",
                    user=self._user_pb(user_row),
                    version=version,
                )

            return self._run_rpc(context, label="Hello", fn=fn)

        def fn(state: RpcState) -> pb.HelloResponse:
            current_user = state.current_user
            assert current_user is not None
            return pb.HelloResponse(user=self._user_pb(current_user), version=version)

        return self._run_rpc(context, label="Hello", load_user=True, fn=fn)

    def ListAssignments(
        self, request: pb.ListAssignmentsRequest, context: grpc.ServicerContext
    ) -> pb.ListAssignmentsResponse:
        def fn(state: RpcState) -> pb.ListAssignmentsResponse:
            current_user = state.current_user
            assert current_user is not None
            try:
                items = get_assignment_list_items_pb(
                    state.tx,
                    current_user,
                    list(request.search),
                    bool(request.include_student_context),
                    state.ip_allowed,
                )
            except sqlite3.Error as exc:
                self._abort_sqlite(context, exc, internal="db error listing assignments")
            return pb.ListAssignmentsResponse(items=items)

        return self._run_rpc(context, label="ListAssignments", load_user=True, include_ip=True, fn=fn)

    def SearchProblemCatalog(
        self, request: pb.SearchProblemCatalogRequest, context: grpc.ServicerContext
    ) -> pb.SearchProblemCatalogResponse:
        def fn(state: RpcState) -> pb.SearchProblemCatalogResponse:
            current_user = state.current_user
            assert current_user is not None
            try:
                return search_problem_catalog_pb(state.tx, current_user, list(request.search))
            except sqlite3.Error as exc:
                self._abort_sqlite(context, exc, internal="db error searching problem catalog")

        return self._run_rpc(context, label="SearchProblemCatalog", load_user=True, fn=fn)

    def GetProblemTypes(self, request: pb.GetProblemTypesRequest, context: grpc.ServicerContext) -> pb.GetProblemTypesResponse:
        def fn(state: RpcState) -> pb.GetProblemTypesResponse:
            try:
                rows = get_problem_types_rows(state.tx)
                return pb.GetProblemTypesResponse(
                    problem_types=[self._load_problem_type(state.tx, str(row["problem_type"])) for row in rows]
                )
            except sqlite3.Error as exc:
                self._abort_sqlite(context, exc, internal="db error getting problem types")

        return self._run_rpc(context, label="GetProblemTypes", fn=fn)

    def GetProblemType(self, request: pb.GetProblemTypeRequest, context: grpc.ServicerContext) -> pb.GetProblemTypeResponse:
        def fn(state: RpcState) -> pb.GetProblemTypeResponse:
            try:
                problem_type = self._load_problem_type(state.tx, request.problem_type)
            except sqlite3.Error as exc:
                self._abort_sqlite(context, exc, internal="db error getting problem type", not_found="not found")
            return pb.GetProblemTypeResponse(problem_type=problem_type)

        return self._run_rpc(context, label="GetProblemType", fn=fn)

    def GetAssignment(self, request: pb.GetAssignmentRequest, context: grpc.ServicerContext) -> pb.GetAssignmentResponse:
        def fn(state: RpcState) -> pb.GetAssignmentResponse:
            current_user = state.current_user
            assert current_user is not None
            try:
                return get_assignment_summary_pb(
                    state.tx,
                    current_user,
                    request.assignment,
                    state.ip_allowed,
                )
            except sqlite3.Error as exc:
                self._abort_sqlite(context, exc, internal="db error getting assignment", not_found="not found")

        return self._run_rpc(context, label="GetAssignment", load_user=True, include_ip=True, fn=fn)

    def GetWorkspace(self, request: pb.GetWorkspaceRequest, context: grpc.ServicerContext) -> pb.GetWorkspaceResponse:
        def fn(state: RpcState) -> pb.GetWorkspaceResponse:
            current_user = state.current_user
            assert current_user is not None
            try:
                return get_workspace_pb(
                    state.tx,
                    current_user,
                    request.assignment,
                    request.problem_id,
                    int(request.step_number),
                    request.file_state,
                    bool(request.include_contents),
                    bool(request.include_solution_files),
                    state.ip_allowed,
                    self._problem_type_files,
                )
            except PermissionError as exc:
                self._abort(context, grpc.StatusCode.PERMISSION_DENIED, str(exc))
            except ValueError as exc:
                self._abort(context, grpc.StatusCode.INVALID_ARGUMENT, str(exc))
            except sqlite3.Error as exc:
                self._abort_sqlite(context, exc, internal="db error getting workspace", not_found="not found")

        return self._run_rpc(context, label="GetWorkspace", load_user=True, include_ip=True, fn=fn)

    def _select_daycare_host(self, _problem_types: set[str]) -> str:
        if self._daycare_registry is not None:
            try:
                return self._daycare_registry.assign(_problem_types)
            except Exception:
                logging.exception("daycare registry assignment failed")
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

    def PrepareProblem(
        self, request: pb.PrepareProblemRequest, context: grpc.ServicerContext
    ) -> pb.PrepareProblemResponse:
        self._require_field(request, field="draft", label="draft", context=context)

        def fn(state: RpcState) -> pb.PrepareProblemResponse:
            current_user = state.current_user
            assert current_user is not None
            try:
                bundle = prepare_problem(
                    state.tx,
                    str(current_user["user_id"]),
                    request.draft,
                    request.action,
                    self._config.daycare_secret,
                    self._select_daycare_host,
                    self._problem_type_files,
                )
            except ValueError as exc:
                self._abort(context, grpc.StatusCode.INVALID_ARGUMENT, f"invalid problem draft: {exc}")
            except Exception as exc:
                self._abort(context, grpc.StatusCode.INTERNAL, f"db error preparing problem: {exc}")
            return pb.PrepareProblemResponse(bundle=bundle)

        return self._run_rpc(context, label="PrepareProblem", require_author=True, fn=fn)

    def SaveProblem(self, request: pb.SaveProblemRequest, context: grpc.ServicerContext) -> pb.SaveProblemResponse:
        self._require_field(request, field="bundle", label="bundle", context=context)

        def fn(state: RpcState) -> pb.SaveProblemResponse:
            current_user = state.current_user
            assert current_user is not None
            try:
                bundle = save_problem(
                    state.tx,
                    str(current_user["user_id"]),
                    self._config.daycare_secret,
                    request.mode,
                    request.bundle,
                )
            except ValueError as exc:
                self._abort(context, grpc.StatusCode.INVALID_ARGUMENT, f"invalid problem save: {exc}")
            except Exception as exc:
                self._abort(context, grpc.StatusCode.INTERNAL, f"db error saving problem: {exc}")
            return pb.SaveProblemResponse(bundle=bundle)

        return self._run_rpc(context, label="SaveProblem", require_author=True, fn=fn)

    def SaveProblemSet(
        self, request: pb.SaveProblemSetRequest, context: grpc.ServicerContext
    ) -> pb.SaveProblemSetResponse:
        self._require_field(request, field="bundle", label="bundle", context=context)

        def fn(state: RpcState) -> pb.SaveProblemSetResponse:
            try:
                bundle = save_problem_set(
                    state.tx,
                    request.mode,
                    request.bundle,
                )
            except ValueError as exc:
                self._abort(context, grpc.StatusCode.INVALID_ARGUMENT, f"invalid problem set save: {exc}")
            except Exception as exc:
                self._abort(context, grpc.StatusCode.INTERNAL, f"db error saving problem set: {exc}")
            return pb.SaveProblemSetResponse(bundle=bundle)

        return self._run_rpc(context, label="SaveProblemSet", require_author=True, fn=fn)

    def SaveUngradedCommit(
        self, request: pb.SaveUngradedCommitRequest, context: grpc.ServicerContext
    ) -> pb.SaveUngradedCommitResponse:
        self._require_field(request, field="commit", label="commit", context=context)

        def fn(state: RpcState) -> pb.SaveUngradedCommitResponse:
            current_user = state.current_user
            assert current_user is not None
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
                result = save_ungraded_commit(
                    state.tx,
                    str(current_user["user_id"]),
                    working,
                    state.ip_allowed,
                    self._select_daycare_host,
                    self._problem_type_files,
                )
            except ValueError as exc:
                self._abort(context, grpc.StatusCode.INVALID_ARGUMENT, f"invalid ungraded commit: {exc}")
            except sqlite3.Error as exc:
                self._abort_sqlite(
                    context,
                    exc,
                    internal="db error saving ungraded commit",
                    not_found="commit target not found",
                )
            except Exception as exc:
                self._abort(context, grpc.StatusCode.INTERNAL, f"db error saving ungraded commit: {exc}")
            bundle = result.bundle
            self._log_commit_request(current_user, bundle, request_signed=False)
            return pb.SaveUngradedCommitResponse(
                bundle=encode_signed_runtime_bundle(bundle, self._config.daycare_secret),
                save_status=result.save_status,
            )

        return self._run_rpc(context, label="SaveUngradedCommit", load_user=True, include_ip=True, fn=fn)

    def SaveWorkspaceCommit(
        self, request: pb.SaveWorkspaceCommitRequest, context: grpc.ServicerContext
    ) -> pb.SaveWorkspaceCommitResponse:
        self._require_field(request, field="commit", label="commit", context=context)

        def fn(state: RpcState) -> pb.SaveWorkspaceCommitResponse:
            current_user = state.current_user
            assert current_user is not None
            working = pb.Commit()
            working.CopyFrom(request.commit)
            now = datetime.now(tz=UTC)
            working.created_at.FromDatetime(now)
            working.updated_at.FromDatetime(now)
            try:
                result = save_workspace_commit(
                    state.tx,
                    str(current_user["user_id"]),
                    working,
                    state.ip_allowed,
                )
            except ValueError as exc:
                self._abort(context, grpc.StatusCode.INVALID_ARGUMENT, f"invalid workspace commit: {exc}")
            except sqlite3.Error as exc:
                self._abort_sqlite(
                    context,
                    exc,
                    internal="db error saving workspace commit",
                    not_found="commit target not found",
                )
            except Exception as exc:
                self._abort(context, grpc.StatusCode.INTERNAL, f"db error saving workspace commit: {exc}")
            note = ""
            if result.commit.note != "":
                note = f" ({result.commit.note})"
            logging.info(
                "sync request: user %s syncing %s step %d%s",
                current_user["user_name"],
                result.problem_note,
                int(result.commit.step),
                note,
            )
            return pb.SaveWorkspaceCommitResponse(save_status=result.save_status)

        return self._run_rpc(context, label="SaveWorkspaceCommit", load_user=True, include_ip=True, fn=fn)

    def SaveGradedCommit(
        self, request: pb.SaveGradedCommitRequest, context: grpc.ServicerContext
    ) -> pb.SaveGradedCommitResponse:
        self._require_field(request, field="bundle", label="bundle", context=context)

        def fn(state: RpcState) -> _PassbackWork:
            current_user = state.current_user
            assert current_user is not None
            try:
                runtime = decode_signed_runtime_bundle(request.bundle, self._config.daycare_secret)
                result = save_graded_runtime_bundle(
                    state.tx,
                    str(current_user["user_id"]),
                    runtime,
                    state.ip_allowed,
                )
            except ValueError as exc:
                self._abort(context, grpc.StatusCode.INVALID_ARGUMENT, f"invalid graded commit: {exc}")
            except sqlite3.Error as exc:
                self._abort_sqlite(
                    context,
                    exc,
                    internal="db error saving graded commit",
                    not_found="commit target not found",
                )
            except Exception as exc:
                self._abort(context, grpc.StatusCode.INTERNAL, f"db error saving graded commit: {exc}")
            bundle = result.bundle
            self._log_commit_request(current_user, bundle, request_signed=True)
            passback_target = (
                self._build_grade_passback_target(state.tx, str(current_user["user_id"]), bundle)
                if result.save_status == pb.COMMIT_SAVE_STATUS_SAVED
                else None
            )
            if passback_target is None:
                return _PassbackWork(response=pb.SaveGradedCommitResponse(save_status=result.save_status))
            return _PassbackWork(
                response=pb.SaveGradedCommitResponse(save_status=result.save_status),
                target=passback_target,
                html=build_grade_report_html(
                    bundle.commit,
                    bundle.problem_id,
                    bundle.total_steps,
                    self._problem_count_for_assignment(
                        state.tx,
                        bundle.commit.assignment.user_id,
                        bundle.commit.assignment.course_id,
                        bundle.commit.assignment.problem_set_id,
                    ),
                ),
            )

        work = self._run_rpc(context, label="SaveGradedCommit", load_user=True, include_ip=True, fn=fn)
        if work.target is not None:
            save_grade_async(work.target, work.html, self._config.lti_secret)
        return work.response

    def Daycare(self, request: pb.DaycareRequest, context: grpc.ServicerContext) -> Iterator[pb.DaycareResponse]:
        yield from self._daycare.stream(request, context)
