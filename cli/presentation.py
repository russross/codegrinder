from __future__ import annotations

from collections.abc import Iterable, Sequence
from pathlib import Path

import codegrinder_pb2 as pb

from helpers import abbreviate_home, course_directory, dashes


def sorted_assignment_items(items: Iterable[pb.AssignmentListItem]) -> list[pb.AssignmentListItem]:
    return sorted(
        items,
        key=lambda item: (
            item.assignment.course_id,
            item.due_at.seconds if item.HasField("due_at") else 0,
            item.lock_at.seconds if item.HasField("lock_at") else 0,
            item.assignment.user_id,
            item.assignment.problem_set_id,
        ),
    )


def sorted_student_assignment_items(items: Iterable[pb.AssignmentListItem]) -> list[pb.AssignmentListItem]:
    return sorted(
        items,
        key=lambda item: (
            item.assignment.user_id,
            item.assignment.course_id,
            item.due_at.seconds if item.HasField("due_at") else 0,
            item.assignment.problem_set_id,
        ),
    )


def _pretty_assignment_path(workspace_root: Path, item: pb.AssignmentListItem) -> str:
    path = workspace_root.expanduser() / course_directory(item.course_name) / item.assignment.problem_set_id
    return abbreviate_home(path)


def _assignment_title(item: pb.AssignmentListItem) -> str:
    if item.assignment_title:
        return item.assignment_title
    if item.problem_set_note:
        return item.problem_set_note
    return item.assignment.problem_set_id


def print_assignment_list(items: Sequence[pb.AssignmentListItem], workspace_root: Path) -> None:
    titles = [_assignment_title(item) for item in items]
    longest_title = max(len(title) for title in titles)

    current_course_id = ""
    for item, title in zip(items, titles, strict=True):
        if item.assignment.course_id != current_course_id:
            if current_course_id != "":
                print()
            current_course_id = item.assignment.course_id
            print(item.course_name)
            print(dashes(len(item.course_name)))

        percent = round(float(item.assignment_score) * 100)
        pretty_path = _pretty_assignment_path(workspace_root, item)
        suffix = ""
        if item.download_status == pb.ASSIGNMENT_DOWNLOAD_STATUS_PREREQ_NOT_READY:
            suffix = f" waiting for {item.prerequisite_problem_set_id}"
        print(f"{title:<{longest_title}}  {percent:>3}% ({pretty_path}){suffix}")


def print_problem_catalog(problem_sets: Sequence[pb.ProblemCatalogSet], host: str) -> None:
    for index, pset in enumerate(problem_sets):
        if index > 0:
            print()
        print(pset.problem_set_note)

        for problem in pset.problems:
            if problem.problem_weight == 1:
                print(f"  * {problem.problem_note} ({problem.problem_id})")
            else:
                print(f"  * {problem.problem_note} ({problem.problem_id}, weight {problem.problem_weight})")
            for step in problem.steps:
                text = step.step_note.replace("\n", "\n       ")
                suffix = "" if step.step_weight == 1 else f" (weight {step.step_weight})"
                n = int(step.step_number)
                print(f"    {n}. {text}{suffix}")

        print()
        print(f"  → https://{host}/lti/problem_sets/cli/{pset.problem_set_id}")
