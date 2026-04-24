from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from errors import fail
from gcfg import GcfgSection, get_all_values, get_first_section, get_last_value, get_sections, parse_gcfg
from helpers import plural

PROBLEM_CONFIG_NAME = "problem.cfg"


@dataclass(slots=True)
class AuthorStepConfig:
    note: str
    problem_type: str
    weight: float


@dataclass(slots=True)
class AuthorProblemConfig:
    problem_id: str
    note: str
    problem_type: str
    tags: list[str]
    options: list[str]
    steps: list[AuthorStepConfig]
    single_step_layout: bool


@dataclass(slots=True)
class AuthorProblemSetProblemConfig:
    problem_id: str
    weight: float
    first_step: int
    last_step: int


@dataclass(slots=True)
class AuthorProblemSetConfig:
    problem_set_id: str
    note: str
    tags: list[str]
    continues_problem_set_id: str
    problems: list[AuthorProblemSetProblemConfig]


def parse_author_problem_config(path: Path) -> AuthorProblemConfig:
    sections = parse_gcfg(path)
    problem_section = get_first_section(sections, "problem")
    if problem_section is None:
        fail(f"failed to parse {path}: missing [problem] section")

    problem_id = _get_last_non_empty(get_all_values(problem_section, "unique"), "problem.unique", path)
    note = _get_last_non_empty(get_all_values(problem_section, "note"), "problem.note", path)
    problem_type = _get_last_value_or_empty(problem_section, "type")
    tags = get_all_values(problem_section, "tag")
    options = get_all_values(problem_section, "option")

    step_sections = get_sections(sections, "step")
    steps: list[AuthorStepConfig] = []
    if not step_sections:
        steps.append(AuthorStepConfig(note=note, problem_type=problem_type, weight=1.0))
    else:
        step_map: dict[int, AuthorStepConfig] = {}
        for section in step_sections:
            if section.subsection is None or not section.subsection.isdigit():
                fail(f"failed to parse {path}: step sections must be [step \"N\"]")
            index = int(section.subsection)
            step_note = _get_last_non_empty(get_all_values(section, "note"), f"step {index}.note", path)
            section_type = _get_last_value_or_empty(section, "type")
            if (section_type == "") == (problem_type == ""):
                fail("problem type must be specified for the problem as a whole or for each step, but not both")
            resolved_type = section_type if section_type else problem_type
            weight_text = _get_last_value_or_empty(section, "weight")
            weight = float(weight_text) if weight_text else 1.0
            step_map[index] = AuthorStepConfig(note=step_note, problem_type=resolved_type, weight=weight)

        if not step_map:
            fail(f"expected to find {len(step_sections)} step{plural(len(step_sections))}, but only found 0")
        for idx in range(1, max(step_map) + 1):
            if idx not in step_map:
                fail(f"expected to find {len(step_map)} step{plural(len(step_map))}, but only found {idx - 1}")
            steps.append(step_map[idx])

    return AuthorProblemConfig(
        problem_id=problem_id,
        note=note,
        problem_type=problem_type,
        tags=tags,
        options=options,
        steps=steps,
        single_step_layout=not step_sections,
    )


def parse_author_problem_set_config(path: Path) -> AuthorProblemSetConfig:
    sections = parse_gcfg(path)
    pset = get_first_section(sections, "problemset")
    if pset is None:
        fail(f"failed to parse {path}: missing [problemset] section")

    problem_set_id = _get_last_non_empty(get_all_values(pset, "unique"), "problemset.unique", path)
    note = _get_last_non_empty(get_all_values(pset, "note"), "problemset.note", path)
    tags = get_all_values(pset, "tag")
    continues_problem_set_id = _get_last_value_or_empty(pset, "continues")

    problem_sections = get_sections(sections, "problem")
    problems: list[AuthorProblemSetProblemConfig] = []
    sliced = False
    for section in problem_sections:
        if section.subsection is None:
            continue
        weight_text = _get_last_value_or_empty(section, "weight")
        weight = float(weight_text) if weight_text else 1.0
        steps_text = _get_last_value_or_empty(section, "steps")
        first_step = 0
        last_step = 0
        if steps_text:
            first_step, last_step = _parse_step_range(steps_text, path)
            sliced = True
        problems.append(
            AuthorProblemSetProblemConfig(
                problem_id=section.subsection,
                weight=weight,
                first_step=first_step,
                last_step=last_step,
            )
        )

    if sliced and len(problems) != 1:
        fail(f"failed to parse {path}: step slicing is only supported for unary problem sets")
    if continues_problem_set_id and not sliced:
        fail(f"failed to parse {path}: problemset.continues requires a sliced problem set")

    return AuthorProblemSetConfig(
        problem_set_id=problem_set_id,
        note=note,
        tags=tags,
        continues_problem_set_id=continues_problem_set_id,
        problems=problems,
    )


def _get_last_non_empty(values: list[str], field: str, path: Path) -> str:
    if not values:
        fail(f"failed to parse {path}: missing {field}")
    value = values[-1].strip()
    if not value:
        fail(f"failed to parse {path}: empty {field}")
    return value


def _get_last_value_or_empty(section: GcfgSection, key: str) -> str:
    value = get_last_value(section, key)
    return "" if value is None else value


def _parse_step_range(raw: str, path: Path) -> tuple[int, int]:
    parts = raw.split("-", maxsplit=1)
    if len(parts) != 2:
        fail(f"failed to parse {path}: problem steps must be FIRST-LAST")
    try:
        first_step = int(parts[0].strip())
        last_step = int(parts[1].strip())
    except ValueError:
        fail(f"failed to parse {path}: problem steps must be FIRST-LAST")
    if first_step <= 0 or last_step < first_step:
        fail(f"failed to parse {path}: problem steps must be FIRST-LAST with positive ascending steps")
    return first_step, last_step
