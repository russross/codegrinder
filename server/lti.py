from __future__ import annotations

import logging
import gzip
import hmac
import json
import base64
import re
import sqlite3
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha1
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable
from urllib.parse import parse_qs, quote_plus, urlsplit
from xml.sax.saxutils import escape as xml_escape

from config import ServerConfig
from daycare_registry import DaycareRegistration, DaycareRegistry
from db import transaction
from ipfilter import IPFilter
from sessions import LoginTokens
from signatures import encode_params, escape

BOOTSTRAP_ASSIGNMENT_NAME = "bootstrap-codegrinder"
CANVAS_DATE_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
_LAUNCH_PATH_RE = re.compile(r"^/lti/problem_sets/([^/]+)/([^/]+)$")


class LTIError(ValueError):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass(slots=True)
class LTIResponse:
    status: int
    content_type: str
    body: bytes
    location: str | None = None


def compute_oauth_signature(method: str, request_url: str, parameters: dict[str, list[str]], secret: str) -> str:
    normalized_method = method.upper()
    parsed = urlsplit(request_url)
    normalized_url = f"{parsed.scheme.lower()}://{parsed.netloc.lower()}{parsed.path}"
    params_copy = {k: list(v) for k, v in parameters.items()}
    params_copy.pop("oauth_signature", None)
    param_string = encode_params(params_copy).decode("utf-8")
    base_string = f"{escape(normalized_method)}&{escape(normalized_url)}&{escape(param_string)}"
    key = f"{escape(secret)}&".encode("utf-8")
    mac = hmac.new(key, base_string.encode("utf-8"), sha1)
    return base64.b64encode(mac.digest()).decode("ascii")


def _parse_canvas_datetime(value: str) -> datetime | None:
    raw = value.strip()
    if raw == "":
        return None
    try:
        dt = datetime.strptime(raw, CANVAS_DATE_FORMAT).replace(tzinfo=UTC)
    except ValueError:
        return None
    return dt.astimezone()


def _to_sql_dt(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone().isoformat(timespec="seconds")


def _coerce_row_dt(value: object) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.astimezone()
        return value
    raw = str(value)
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.astimezone()
    return parsed


def _form_first(form: dict[str, list[str]], key: str) -> str:
    vals = form.get(key)
    if vals is None or len(vals) == 0:
        return ""
    return vals[0]


def _form_int(form: dict[str, list[str]], key: str) -> int:
    raw = _form_first(form, key).strip()
    if raw == "":
        return 0
    try:
        return int(raw)
    except ValueError:
        try:
            return int(float(raw))
        except ValueError:
            return 0


def _required_lastrowid(value: int | None) -> int:
    if value is None:
        raise RuntimeError("sqlite lastrowid missing")
    return int(value)


def _is_instructor_role(roles: str) -> bool:
    for role in roles.split(","):
        if role == "Instructor" or role == "urn:lti:role:ims/lis/TeachingAssistant":
            return True
    return False


def _date_mismatch(old_value: object, incoming: str) -> bool:
    old_dt = _coerce_row_dt(old_value)
    if old_dt is None:
        return incoming != ""
    if incoming == "":
        return True
    incoming_dt = _parse_canvas_datetime(incoming)
    if incoming_dt is None:
        return False
    return incoming_dt != old_dt


def get_config_xml(config: ServerConfig) -> bytes:
    title = xml_escape(config.tool_name)
    description = xml_escape(config.tool_description)
    tool_id = xml_escape(config.tool_id)
    domain = xml_escape(config.hostname)
    payload = f"""<?xml version="1.0" encoding="UTF-8"?>
<cartridge_basiclti_link
  xmlns="http://www.imsglobal.org/xsd/imslticc_v1p0"
  xmlns:blti="http://www.imsglobal.org/xsd/imsbasiclti_v1p0"
  xmlns:lticm="http://www.imsglobal.org/xsd/imslticm_v1p0"
  xmlns:lticp="http://www.imsglobal.org/xsd/imslticp_v1p0"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imslticc_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imslticc_v1p0.xsd http://www.imsglobal.org/xsd/imsbasiclti_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imsbasiclti_v1p0.xsd http://www.imsglobal.org/xsd/imslticm_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imslticm_v1p0.xsd http://www.imsglobal.org/xsd/imslticp_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imslticp_v1p0.xsd">
  <blti:title>{title}</blti:title>
  <blti:description>{description}</blti:description>
  <blti:icon></blti:icon>
  <blti:extensions platform="canvas.instructure.com">
    <lticm:property name="tool_id">{tool_id}</lticm:property>
    <lticm:property name="privacy_level">public</lticm:property>
    <lticm:property name="domain">{domain}</lticm:property>
    <lticm:options name="custom_fields">
      <lticm:property name="canvas_assignment_unlock_at">$Canvas.assignment.unlockAt.iso8601</lticm:property>
      <lticm:property name="canvas_assignment_due_at">$Canvas.assignment.dueAt.iso8601</lticm:property>
      <lticm:property name="canvas_assignment_lock_at">$Canvas.assignment.lockAt.iso8601</lticm:property>
    </lticm:options>
  </blti:extensions>
  <cartridge_bundle identifierref="BLTI001_Bundle"></cartridge_bundle>
  <cartridge_icon identifierref="BLTI001_Icon"></cartridge_icon>
</cartridge_basiclti_link>
"""
    return payload.encode("utf-8")


class LTIService:
    def __init__(
        self,
        conn: sqlite3.Connection,
        config: ServerConfig,
        login_tokens: LoginTokens,
        ip_filter: IPFilter,
        daycare_registry: DaycareRegistry | None = None,
        version_payload: dict[str, str] | None = None,
        now_provider: Callable[[], datetime] | None = None,
    ) -> None:
        self._conn = conn
        self._config = config
        self._login_tokens = login_tokens
        self._ip_filter = ip_filter
        self._daycare_registry = daycare_registry
        self._version_payload = version_payload or {
            "version": "2.8.0",
            "grindVersionRequired": "2.7.0",
            "grindVersionRecommended": "2.7.0",
            "thonnyVersionRequired": "2.7.0",
            "thonnyVersionRecommended": "2.7.0",
        }
        self._now = now_provider or (lambda: datetime.now(tz=UTC))

    def get_config(self) -> LTIResponse:
        return LTIResponse(status=HTTPStatus.OK, content_type="application/xml", body=get_config_xml(self._config))

    def get_version(self) -> LTIResponse:
        return LTIResponse(
            status=HTTPStatus.OK,
            content_type="application/json",
            body=json.dumps(self._version_payload, separators=(",", ":")).encode("utf-8"),
        )

    def get_daycare_registrations(self) -> LTIResponse:
        if self._daycare_registry is None:
            payload: dict[str, dict[str, object]] = {}
        else:
            payload = self._daycare_registry.snapshot()
        return LTIResponse(
            status=HTTPStatus.OK,
            content_type="application/json",
            body=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        )

    def post_daycare_registration(self, payload: dict[str, object]) -> LTIResponse:
        if self._daycare_registry is None:
            raise LTIError(HTTPStatus.BAD_REQUEST, "bad daycare registration: registry unavailable")
        when_raw = str(payload.get("time", ""))
        if when_raw.endswith("Z"):
            when_raw = when_raw[:-1] + "+00:00"
        try:
            when = datetime.fromisoformat(when_raw)
        except ValueError as exc:
            raise LTIError(HTTPStatus.BAD_REQUEST, f"bad daycare registration: invalid time: {exc}") from exc
        if when.tzinfo is None:
            when = when.replace(tzinfo=UTC)
        raw_problem_types = payload.get("problemTypes", [])
        if isinstance(raw_problem_types, list):
            problem_types = [str(x) for x in raw_problem_types]
        else:
            problem_types = []
        raw_capacity = payload.get("capacity", 0)
        try:
            capacity = int(str(raw_capacity))
        except Exception:
            capacity = 0
        reg = DaycareRegistration(
            hostname=str(payload.get("hostname", "")),
            problem_types=problem_types,
            capacity=capacity,
            time=when,
            version=str(payload.get("version", "")),
            signature=str(payload.get("signature", "")),
        )
        try:
            self._daycare_registry.insert(reg)
        except Exception as exc:
            raise LTIError(HTTPStatus.BAD_REQUEST, f"bad daycare registration: {exc}") from exc
        return LTIResponse(status=HTTPStatus.OK, content_type="application/json", body=b"")

    def validate_oauth_signature(self, method: str, request_url: str, form: dict[str, list[str]]) -> None:
        expected = _form_first(form, "oauth_signature")
        if expected == "":
            raise LTIError(HTTPStatus.UNAUTHORIZED, "Missing oauth_signature form field")
        got = compute_oauth_signature(method, request_url, form, self._config.lti_secret)
        if got != expected:
            context = ""
            oauth_consumer_key = _form_first(form, "oauth_consumer_key")
            context_title = _form_first(form, "context_title")
            contact_email = _form_first(form, "lis_person_contact_email_primary")
            if oauth_consumer_key != "":
                context += f" oauth_consumer_key={oauth_consumer_key}"
            if context_title != "":
                context += f" context_title={context_title}"
            if contact_email != "":
                context += f" lis_person_contact_email_primary={contact_email}"
            logging.warning("failed LTI signature on request:%s", context)
            raise LTIError(
                HTTPStatus.UNAUTHORIZED,
                (
                    "Signature mismatch. This is usually due to an error in the external app setup for "
                    f"CodeGrinder in Canvas. Got {got} but expected {expected}"
                ),
            )

    def launch(
        self,
        method: str,
        request_url: str,
        ui: str,
        unique: str,
        form: dict[str, list[str]],
        client_ip: str | None,
    ) -> LTIResponse:
        self.validate_oauth_signature(method, request_url, form)
        if ui not in ("cli", "web", "exam"):
            raise LTIError(HTTPStatus.BAD_REQUEST, f'UI type must be cli, web, or exam, not "{ui}"')
        if unique == "":
            raise LTIError(HTTPStatus.BAD_REQUEST, "malformed URL: missing unique ID for problem")
        escaped = quote_plus(unique)
        if unique != escaped:
            raise LTIError(
                HTTPStatus.BAD_REQUEST,
                f"unique ID must be URL friendly: {unique} is escaped as {escaped}",
            )

        roles = _form_first(form, "roles")
        restricted = ui == "exam"
        ip_allowed = not self._ip_filter.enabled()
        if self._ip_filter.enabled() and client_ip is not None:
            ip_allowed = self._ip_filter.allows_ip(client_ip)
        if restricted and not ip_allowed and not _is_instructor_role(roles):
            raise LTIError(HTTPStatus.FORBIDDEN, "exam access is restricted to approved IP ranges")

        now = self._now()
        with transaction(self._conn) as tx:
            problem_set_id = ""
            if unique != BOOTSTRAP_ASSIGNMENT_NAME:
                row = tx.execute("SELECT problem_set_id FROM problem_sets WHERE problem_set_id = ?", (unique,)).fetchone()
                if row is None:
                    raise LTIError(HTTPStatus.NOT_FOUND, "problem set not found")
                problem_set_id = str(row["problem_set_id"])

            course_id, course_label = self._get_update_course(tx, form, now)
            user_id = self._get_update_user(tx, form, now)
            self._get_update_user_course(tx, form, user_id, course_id)
            assignment_key = ""
            if unique != BOOTSTRAP_ASSIGNMENT_NAME:
                assignment_key = self._get_update_assignment(
                    tx=tx,
                    form=form,
                    course_id=course_id,
                    user_id=user_id,
                    problem_set_id=problem_set_id,
                    restricted=restricted,
                )

        login_token = self._login_tokens.insert(user_id, now)
        location = f"/{ui}/?assignment={quote_plus(assignment_key)}&token={login_token}&course={quote_plus(course_label)}"
        return LTIResponse(
            status=HTTPStatus.SEE_OTHER,
            content_type="text/plain; charset=utf-8",
            body=b"",
            location=location,
        )

    def _get_update_user(self, tx: sqlite3.Connection, form: dict[str, list[str]], _now: datetime) -> str:
        user_id = _form_first(form, "user_id")
        row = tx.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone()
        user_name = _form_first(form, "lis_person_name_full")
        user_login = _form_first(form, "custom_canvas_user_login_id")
        if row is None:
            tx.execute(
                "INSERT INTO users(user_id, user_name, user_login) VALUES (?, ?, ?)",
                (user_id, user_name, user_login),
            )
            return user_id

        changed = (
            str(row["user_name"]) != user_name
            or str(row["user_login"]) != user_login
        )
        if changed:
            tx.execute("UPDATE users SET user_name = ?, user_login = ? WHERE user_id = ?", (user_name, user_login, user_id))
        return user_id

    def _get_update_course(self, tx: sqlite3.Connection, form: dict[str, list[str]], _now: datetime) -> tuple[str, str]:
        course_id = _form_first(form, "context_id")
        row = tx.execute("SELECT * FROM courses WHERE course_id = ?", (course_id,)).fetchone()
        course_name = _form_first(form, "context_title")
        course_label = _form_first(form, "context_label")
        if row is None:
            tx.execute("INSERT INTO courses(course_id, course_name) VALUES (?, ?)", (course_id, course_name))
            return course_id, course_label

        changed = str(row["course_name"]) != course_name
        if changed:
            tx.execute("UPDATE courses SET course_name = ? WHERE course_id = ?", (course_name, course_id))
        return course_id, course_label

    def _get_update_user_course(
        self,
        tx: sqlite3.Connection,
        form: dict[str, list[str]],
        user_id: str,
        course_id: str,
    ) -> None:
        roles = _form_first(form, "roles")
        row = tx.execute("SELECT * FROM user_courses WHERE user_id = ? AND course_id = ?", (user_id, course_id)).fetchone()
        if row is None:
            tx.execute(
                "INSERT INTO user_courses(user_id, course_id, course_roles) VALUES (?, ?, ?)",
                (user_id, course_id, roles),
            )
            return
        if str(row["course_roles"]) != roles:
            tx.execute("UPDATE user_courses SET course_roles = ? WHERE user_id = ? AND course_id = ?", (roles, user_id, course_id))

    def _get_update_assignment(
        self,
        tx: sqlite3.Connection,
        form: dict[str, list[str]],
        course_id: str,
        user_id: str,
        problem_set_id: str,
        restricted: bool,
    ) -> str:
        row = tx.execute(
            "SELECT * FROM assignments WHERE user_id = ? AND course_id = ? AND problem_set_id = ?",
            (user_id, course_id, problem_set_id),
        ).fetchone()
        person_sourced_id = _form_first(form, "lis_result_sourcedid")
        outcome_url = _form_first(form, "lis_outcome_service_url")
        outcome_ext_accepted = _form_first(form, "ext_outcome_data_values_accepted")
        consumer_key = _form_first(form, "oauth_consumer_key")
        unlock_raw = _form_first(form, "custom_canvas_assignment_unlock_at")
        due_raw = _form_first(form, "custom_canvas_assignment_due_at")
        lock_raw = _form_first(form, "custom_canvas_assignment_lock_at")

        unlock_dt = _parse_canvas_datetime(unlock_raw)
        due_dt = _parse_canvas_datetime(due_raw)
        lock_dt = _parse_canvas_datetime(lock_raw)
        if row is None:
            grade_id = person_sourced_id if person_sourced_id != "" else None
            tx.execute(
                "INSERT INTO assignments(user_id, course_id, problem_set_id, restricted, grade_id, outcome_url, outcome_ext_accepted, consumer_key, unlock_at, due_at, lock_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    user_id,
                    course_id,
                    problem_set_id,
                    1 if restricted else 0,
                    grade_id,
                    outcome_url,
                    outcome_ext_accepted,
                    consumer_key,
                    _to_sql_dt(unlock_dt),
                    _to_sql_dt(due_dt),
                    _to_sql_dt(lock_dt),
                ),
            )
            return f"{user_id}:{course_id}:{problem_set_id}"

        old_grade_id = str(row["grade_id"] or "")
        new_grade_id = person_sourced_id if person_sourced_id != "" else old_grade_id
        changed = (
            str(row["course_id"]) != course_id
            or str(row["problem_set_id"]) != problem_set_id
            or str(row["user_id"]) != user_id
            or bool(row["restricted"]) != restricted
            or (person_sourced_id != "" and old_grade_id != person_sourced_id)
            or str(row["outcome_url"]) != outcome_url
            or str(row["outcome_ext_accepted"]) != outcome_ext_accepted
            or str(row["consumer_key"]) != consumer_key
            or _date_mismatch(row["unlock_at"], unlock_raw)
            or _date_mismatch(row["due_at"], due_raw)
            or _date_mismatch(row["lock_at"], lock_raw)
        )

        if changed:
            tx.execute(
                "UPDATE assignments SET restricted = ?, grade_id = ?, outcome_url = ?, outcome_ext_accepted = ?, consumer_key = ?, unlock_at = ?, due_at = ?, lock_at = ? "
                "WHERE user_id = ? AND course_id = ? AND problem_set_id = ?",
                (
                    1 if restricted else 0,
                    new_grade_id if new_grade_id != "" else None,
                    outcome_url,
                    outcome_ext_accepted,
                    consumer_key,
                    _to_sql_dt(unlock_dt),
                    _to_sql_dt(due_dt),
                    _to_sql_dt(lock_dt),
                    user_id,
                    course_id,
                    problem_set_id,
                ),
            )
        return f"{user_id}:{course_id}:{problem_set_id}"


class _LTIHandler(BaseHTTPRequestHandler):
    server_version = "CodeGrinderLTI/1.0"
    _service: LTIService

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        try:
            if path == "/lti/config.xml":
                response = self._service.get_config()
            elif path == "/daycare_registrations":
                response = self._service.get_daycare_registrations()
            elif path == "/version" or path == "/v2/version":
                response = self._service.get_version()
            else:
                self._send_error(HTTPStatus.NOT_FOUND, "not found")
                return
            self._send_response(response)
        except LTIError as exc:
            self._log_lti_error(exc.status, path, exc.message)
            self._send_error(exc.status, exc.message)
        except Exception:
            logging.exception("unexpected LTI GET handler failure")
            self._send_error(HTTPStatus.INTERNAL_SERVER_ERROR, "internal server error")

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        try:
            if path == "/daycare_registrations":
                raw = self._read_body_bytes()
                try:
                    payload = json.loads(raw.decode("utf-8"))
                except Exception as exc:
                    message = f"bad daycare registration: {exc}"
                    self._log_lti_error(HTTPStatus.BAD_REQUEST, path, message)
                    self._send_error(HTTPStatus.BAD_REQUEST, message)
                    return
                try:
                    response = self._service.post_daycare_registration(payload)
                    self._send_response(response)
                except LTIError as exc:
                    self._log_lti_error(exc.status, path, exc.message)
                    self._send_error(exc.status, exc.message)
                return

            match = _LAUNCH_PATH_RE.match(path)
            if match is None:
                self._send_error(HTTPStatus.NOT_FOUND, "not found")
                return

            ui = match.group(1)
            unique = match.group(2)
            form = self._parse_form_body()
            scheme = self.headers.get("X-Forwarded-Proto", "https")
            host = self.headers.get("X-Forwarded-Host", self.headers.get("Host", ""))
            request_url = f"{scheme}://{host}{path}"
            client_ip = self.headers.get("X-Real-IP")
            if client_ip is None:
                forwarded_for = self.headers.get("X-Forwarded-For", "")
                if "," in forwarded_for:
                    client_ip = forwarded_for.split(",", 1)[0].strip()
                elif forwarded_for.strip() != "":
                    client_ip = forwarded_for.strip()
                else:
                    client_ip = self.client_address[0] if self.client_address else None

            try:
                response = self._service.launch(
                    method=self.command,
                    request_url=request_url,
                    ui=ui,
                    unique=unique,
                    form=form,
                    client_ip=client_ip,
                )
                self._send_response(response)
            except LTIError as exc:
                self._log_lti_error(exc.status, path, exc.message)
                self._send_error(exc.status, exc.message)
        except Exception:
            logging.exception("unexpected LTI POST handler failure")
            self._send_error(HTTPStatus.INTERNAL_SERVER_ERROR, "internal server error")

    def log_message(self, format: str, *args: object) -> None:
        return

    def _parse_form_body(self) -> dict[str, list[str]]:
        raw = self._read_body_bytes()
        return parse_qs(raw.decode("utf-8"), keep_blank_values=True, strict_parsing=False)

    def _read_body_bytes(self) -> bytes:
        raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        if self.headers.get("Content-Encoding", "").lower() == "gzip":
            raw = gzip.decompress(raw)
        return raw

    def _send_response(self, response: LTIResponse) -> None:
        self.send_response(int(response.status))
        self.send_header("Content-Type", response.content_type)
        if response.location is not None:
            self.send_header("Location", response.location)
        self.send_header("Content-Length", str(len(response.body)))
        self.end_headers()
        if len(response.body) > 0:
            self.wfile.write(response.body)

    def _send_error(self, status: int, message: str) -> None:
        payload = message.encode("utf-8")
        self.send_response(int(status))
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if len(payload) > 0:
            self.wfile.write(payload)

    def _log_lti_error(self, status: int, path: str, message: str) -> None:
        if int(status) == HTTPStatus.NOT_FOUND:
            return
        level = logging.ERROR if int(status) >= 500 else logging.WARNING
        logging.log(level, "lti request error %d %s: %s", int(status), path, message)


def _parse_bind(bind: str) -> tuple[str, int]:
    if ":" not in bind:
        raise ValueError(f"bind must be host:port, got {bind!r}")
    host, port_s = bind.rsplit(":", 1)
    return host, int(port_s)


def start_lti_http_server(bind: str, service: LTIService) -> ThreadingHTTPServer:
    host, port = _parse_bind(bind)
    handler = type("LTIHandler", (_LTIHandler,), {"_service": service})
    server = ThreadingHTTPServer((host, port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server
