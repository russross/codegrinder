from __future__ import annotations

import codegrinder_pb2 as pb

from errors import fail


def parse_signed_runtime_bundle(bundle: pb.SignedRuntimeBundle, missing_host_message: str) -> pb.RuntimeBundle:
    runtime = pb.RuntimeBundle()
    runtime.ParseFromString(bundle.bundle)
    if not runtime.hostname:
        fail(missing_host_message)
    return runtime


def commit_passed(commit: pb.Commit) -> bool:
    return commit.HasField("report_card") and commit.report_card.passed and commit.score == 1.0
