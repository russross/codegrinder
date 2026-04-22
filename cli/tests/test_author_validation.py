from __future__ import annotations

import pytest

import codegrinder_pb2 as pb
from author_validation import validate_author_solution_bundle
from errors import CliError


def _signed_validation(step: int, passed: bool, score: float = 1.0) -> pb.SignedRuntimeBundle:
    commit = pb.Commit(
        problem_id="problem-a",
        step=step,
        report_card=pb.ReportCard(passed=passed, note=f"step {step} note"),
        score=score,
    )
    runtime = pb.RuntimeBundle(commit=commit)
    return pb.SignedRuntimeBundle(bundle=runtime.SerializeToString(), signature=f"validated-{step}")


def _prepared_bundle() -> pb.ProblemBundle:
    return pb.ProblemBundle(
        hostname="daycare.example",
        problem=pb.Problem(problem_id="problem-a"),
        problem_steps=[pb.ProblemStep(step=1), pb.ProblemStep(step=2)],
        solution_commits=[pb.Commit(), pb.Commit()],
        signed_validation_bundles=[
            pb.SignedRuntimeBundle(signature="prepared-1"),
            pb.SignedRuntimeBundle(signature="prepared-2"),
        ],
    )


def test_validate_author_solution_bundle_replaces_prepared_entries_with_validated_results() -> None:
    bundle = _prepared_bundle()
    validated = [_signed_validation(1, True), _signed_validation(2, True)]
    requested: list[str] = []

    def run_validation(prepared: pb.SignedRuntimeBundle) -> pb.SignedRuntimeBundle:
        requested.append(prepared.signature)
        return validated[len(requested) - 1]

    result = validate_author_solution_bundle(bundle, run_validation)

    assert result is bundle
    assert requested == ["prepared-1", "prepared-2"]
    assert [commit.step for commit in bundle.solution_commits] == [1, 2]
    assert [item.signature for item in bundle.signed_validation_bundles] == ["validated-1", "validated-2"]


def test_validate_author_solution_bundle_rejects_failed_validation_without_saving_result() -> None:
    bundle = _prepared_bundle()

    def run_validation(_: pb.SignedRuntimeBundle) -> pb.SignedRuntimeBundle:
        return _signed_validation(1, False)

    with pytest.raises(CliError, match="please fix solution and try again"):
        validate_author_solution_bundle(bundle, run_validation)

    assert [commit.step for commit in bundle.solution_commits] == [0, 0]
    assert [item.signature for item in bundle.signed_validation_bundles] == ["prepared-1", "prepared-2"]
