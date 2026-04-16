from __future__ import annotations

from collections.abc import Iterable, Sequence

import codegrinder_pb2 as pb

from helpers import course_directory, dashes


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


def print_assignment_list(items: Sequence[pb.AssignmentListItem]) -> None:
    longest_idx = len(str(len(items)))
    longest_ps = max(len(item.assignment.problem_set_id) for item in items)

    current_course_id = ""
    for idx, item in enumerate(items, start=1):
        assignment = item.assignment
        if assignment.course_id != current_course_id:
            if current_course_id != "":
                print()
            current_course_id = assignment.course_id
            print(item.course_name)
            print(dashes(len(item.course_name)))

        pset_label = assignment.problem_set_id
        print(f"{idx:>{longest_idx}}. {pset_label:<{longest_ps}} ({course_directory(item.course_name)}/{pset_label})")


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
