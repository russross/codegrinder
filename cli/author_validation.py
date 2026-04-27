from __future__ import annotations

from collections.abc import Callable

import codegrinder_pb2 as pb

from daycare_flow import commit_passed
from errors import fail
from protocol import dump_transcript

ValidationRunner = Callable[[pb.SignedRuntimeBundle], pb.SignedRuntimeBundle | None]


def validate_author_solution_bundle(
    bundle: pb.ProblemBundle,
    run_validation: ValidationRunner,
) -> pb.ProblemBundle:
    if not bundle.hostname:
        fail("server was unable to find a suitable daycare, unable to validate")

    for step_number in range(1, len(bundle.problem_steps) + 1):
        print(f"validating solution for step {step_number}")
        validated = run_validation(bundle.signed_validation_bundles[step_number - 1])
        if validated is None:
            fail("the server ended the connection without sending a report card")
        validated_commit = pb.RuntimeBundle()
        validated_commit.ParseFromString(validated.bundle)
        print("  finished validating solution")
        if not commit_passed(validated_commit.commit):
            note = validated_commit.commit.report_card.note if validated_commit.commit.HasField("report_card") else ""
            print(f"  solution for step {step_number} failed: {note}")
            print(dump_transcript(validated_commit.commit), end="")
            fail("please fix solution and try again")

        bundle.solution_commits[step_number - 1].CopyFrom(validated_commit.commit)
        bundle.signed_validation_bundles[step_number - 1].CopyFrom(validated)

    print("problem and solution confirmed successfully")
    return bundle
