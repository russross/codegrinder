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

    for n in range(len(bundle.problem_steps)):
        print(f"validating solution for step {n + 1}")
        validated = run_validation(bundle.signed_validation_bundles[n])
        if validated is None:
            fail("the server ended the connection without sending a report card")
        validated_commit = pb.RuntimeBundle()
        validated_commit.ParseFromString(validated.bundle)
        print("  finished validating solution")
        if not commit_passed(validated_commit.commit):
            note = validated_commit.commit.report_card.note if validated_commit.commit.HasField("report_card") else ""
            print(f"  solution for step {n + 1} failed: {note}")
            print(dump_transcript(validated_commit.commit), end="")
            fail("please fix solution and try again")

        bundle.solution_commits[n].CopyFrom(validated_commit.commit)
        bundle.signed_validation_bundles[n].CopyFrom(validated)

    print("problem and solution confirmed successfully")
    return bundle
