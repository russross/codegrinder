from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from errors import CliError


@dataclass(slots=True)
class GcfgValue:
    key: str
    value: str


@dataclass(slots=True)
class GcfgSection:
    name: str
    subsection: str | None
    items: list[GcfgValue]


def parse_gcfg(path: Path) -> list[GcfgSection]:
    if not path.exists():
        raise CliError(f"failed to parse {path}: file does not exist")
    sections: list[GcfgSection] = []
    current: GcfgSection | None = None

    for line_no, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith(";") or line.startswith("#"):
            continue

        if line.startswith("[") and line.endswith("]"):
            inner = line[1:-1].strip()
            if not inner:
                raise CliError(f"failed to parse {path}: empty section at line {line_no}")
            if "\"" in inner:
                parts = inner.split("\"", 2)
                name = parts[0].strip()
                subsection = parts[1] if len(parts) >= 2 else None
            else:
                name = inner
                subsection = None
            current = GcfgSection(name=name.lower(), subsection=subsection, items=[])
            sections.append(current)
            continue

        if current is None:
            raise CliError(f"failed to parse {path}: key outside section at line {line_no}")

        if "=" not in line:
            raise CliError(f"failed to parse {path}: invalid key/value at line {line_no}")
        key, value = line.split("=", 1)
        current.items.append(GcfgValue(key=key.strip().lower(), value=value.strip()))

    return sections


def get_sections(sections: list[GcfgSection], name: str) -> list[GcfgSection]:
    needle = name.lower()
    return [section for section in sections if section.name == needle]


def get_first_section(sections: list[GcfgSection], name: str) -> GcfgSection | None:
    matches = get_sections(sections, name)
    if not matches:
        return None
    return matches[0]


def get_all_values(section: GcfgSection, key: str) -> list[str]:
    needle = key.lower()
    return [item.value for item in section.items if item.key == needle]


def get_last_value(section: GcfgSection, key: str) -> str | None:
    values = get_all_values(section, key)
    if not values:
        return None
    return values[-1]
