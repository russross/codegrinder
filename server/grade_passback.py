from __future__ import annotations

import html
import json
import logging
import threading
import time
import base64
from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha1
from urllib import request as urlrequest
from xml.sax.saxutils import escape as xml_escape

import codegrinder_pb2 as pb
from lti import compute_oauth_signature


@dataclass(slots=True)
class GradePassbackTarget:
    user_id: str
    course_id: str
    problem_set_id: str
    grade_id: str
    outcome_url: str
    outcome_ext_accepted: str
    consumer_key: str
    score: float


def _transcript_html(commit: pb.Commit) -> str:
    chunks: list[str] = []
    for event in commit.transcript:
        payload = {
            "time": event.time.ToDatetime().astimezone(UTC).isoformat().replace("+00:00", "Z")
            if event.HasField("time")
            else "",
            "event": event.event,
            "exec_command": list(event.exec_command),
            "exit_status": event.exit_status,
            "stream_data": event.stream_data.decode("utf-8", errors="replace") if event.stream_data else "",
            "error": event.error,
        }
        chunks.append(json.dumps(payload, ensure_ascii=True))
    return "\n".join(chunks)


def build_grade_report_html(commit: pb.Commit, problem_unique: str, total_steps: int, total_problems: int) -> str:
    heading = "Grading transcript"
    if total_problems > 1 and total_steps > 1:
        heading = f"Grading transcript for problem {problem_unique} step {commit.step}"
    elif total_problems > 1:
        heading = f"Grading transcript for problem {problem_unique}"
    elif total_steps > 1:
        heading = f"Grading transcript for step {commit.step}"
    body: list[str] = [f"<h1>{html.escape(heading)}</h1>", f"<pre>{html.escape(_transcript_html(commit))}</pre>"]
    for name in sorted(commit.files.keys()):
        content = bytes(commit.files[name] or b"")
        if content.decode("utf-8", errors="ignore").encode("utf-8", errors="ignore") == content:
            body.append(f"<h1>File: <code>{html.escape(name)}</code></h1>")
            body.append(f"<pre><code>{html.escape(content.decode('utf-8', errors='replace'))}</code></pre>")
        else:
            body.append(f"<h1>File: <code>{html.escape(name)}</code> (binary contents)</h1>")
    return "\n".join(body)


def _build_grade_xml(target: GradePassbackTarget, text: str) -> bytes:
    grade_text = text if "text" in target.outcome_ext_accepted else ""
    payload = f"""<?xml version="1.0" encoding="UTF-8"?>
<imsx_POXEnvelopeRequest xmlns="http://www.imsglobal.org/services/ltiv1p1/xsd/imsoms_v1p0">
  <imsx_POXHeader>
    <imsx_POXRequestHeaderInfo>
      <imsx_version>V1.0</imsx_version>
      <imsx_messageIdentifier>Grade from CodeGrinder</imsx_messageIdentifier>
    </imsx_POXRequestHeaderInfo>
  </imsx_POXHeader>
  <imsx_POXBody>
    <replaceResultRequest>
      <resultRecord>
        <sourcedGUID>
          <sourcedId>{xml_escape(target.grade_id)}</sourcedId>
        </sourcedGUID>
        <result>
          <resultScore>
            <language>en</language>
            <textString>{target.score:0.5f}</textString>
          </resultScore>
          <resultData>
            <text>{xml_escape(grade_text)}</text>
          </resultData>
        </result>
      </resultRecord>
    </replaceResultRequest>
  </imsx_POXBody>
</imsx_POXEnvelopeRequest>
"""
    return payload.encode("utf-8")


def _oauth_auth_header(consumer_key: str, method: str, target_url: str, content: bytes, secret: str) -> str:
    body_hash = base64.b64encode(sha1(content).digest()).decode("ascii")
    now = datetime.now(tz=UTC)
    params = {
        "oauth_body_hash": [body_hash],
        "oauth_token": [""],
        "oauth_consumer_key": [consumer_key],
        "oauth_signature_method": ["HMAC-SHA1"],
        "oauth_timestamp": [str(int(now.timestamp()))],
        "oauth_version": ["1.0"],
        "oauth_nonce": [str(time.time_ns())],
    }
    sig = compute_oauth_signature(method, target_url, params, secret)
    params["oauth_signature"] = [sig]
    parts = [f'OAuth realm="{target_url}"']
    for key in params:
        parts.append(f'{key}="{params[key][0]}"')
    return ",".join(parts)


def save_grade(target: GradePassbackTarget, report_html: str, lti_secret: str) -> None:
    if target.grade_id == "":
        return
    if target.outcome_url == "":
        return
    payload = _build_grade_xml(target, report_html)
    auth = _oauth_auth_header(target.consumer_key, "POST", target.outcome_url, payload, lti_secret)
    req = urlrequest.Request(target.outcome_url, method="POST", data=payload)
    req.add_header("Authorization", auth)
    req.add_header("Content-Type", "application/xml")
    with urlrequest.urlopen(req, timeout=10.0) as resp:
        if int(resp.status) != 200:
            raise RuntimeError(f"result status {resp.status} ({resp.reason}) when posting grade for user {target.user_id}")


def save_grade_async(target: GradePassbackTarget, report_html: str, lti_secret: str) -> None:
    def worker() -> None:
        tries = 10
        sleep_seconds = 10.0
        for idx in range(tries):
            try:
                save_grade(target, report_html, lti_secret)
                return
            except Exception as exc:
                logging.warning(
                    "error posting grade back to LMS (attempt %d/%d): %s",
                    idx + 1,
                    tries,
                    exc,
                )
                if idx + 1 >= tries:
                    logging.warning(
                        "giving up posting LMS grade for assignment %s/%s/%s",
                        target.user_id,
                        target.course_id,
                        target.problem_set_id,
                    )
                    return
                time.sleep(sleep_seconds)
                sleep_seconds = min(sleep_seconds * 2.0, 300.0)

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
