from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class VersionInfo:
    version: str
    grind_version_required: str
    grind_version_recommended: str
    thonny_version_required: str
    thonny_version_recommended: str


CURRENT_VERSION = VersionInfo(
    version="2.8.0",
    grind_version_required="2.7.0",
    grind_version_recommended="2.7.0",
    thonny_version_required="2.7.0",
    thonny_version_recommended="2.7.0",
)
