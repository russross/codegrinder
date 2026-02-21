from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class Config:
    host: str = ""
    cookie: str = ""
    api_report: bool = False
    api_dump: bool = False


@dataclass(slots=True)
class ProblemInfo:
    id: int
    step: int


@dataclass(slots=True)
class DotFileInfo:
    assignment_id: int
    problems: dict[str, ProblemInfo]
    path: str
