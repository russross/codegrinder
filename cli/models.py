from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True)
class Config:
    host: str = ""
    cookie: str = ""
    workspace_root: Path = Path.home()
    is_author: bool = False
    is_instructor: bool = False
    is_admin: bool = False
    api_report: bool = False
    api_dump: bool = False


@dataclass(slots=True)
class AuthenticatedUser:
    user_id: str
    user_name: str
    user_login: str
    is_author: bool
    is_instructor: bool
    is_admin: bool


@dataclass(slots=True)
class ProblemInfo:
    problem_id: str
    step: int


@dataclass(slots=True)
class AssignmentRef:
    user_id: str
    course_id: str
    problem_set_id: str


@dataclass(slots=True)
class DotFileInfo:
    assignment_ref: AssignmentRef
    problems: dict[str, ProblemInfo]
    path: str
