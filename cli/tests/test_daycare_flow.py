from __future__ import annotations

import pytest

import codegrinder_pb2 as pb
from daycare_flow import parse_signed_runtime_bundle
from errors import CliError


def _signed_bundle(hostname: str) -> pb.SignedRuntimeBundle:
    runtime = pb.RuntimeBundle(hostname=hostname, problem_id="p1", step_number=1)
    return pb.SignedRuntimeBundle(bundle=runtime.SerializeToString(), signature="signed")


def test_parse_signed_runtime_bundle_returns_decoded_runtime() -> None:
    runtime = parse_signed_runtime_bundle(_signed_bundle("daycare.example"), "missing host")

    assert runtime.hostname == "daycare.example"
    assert runtime.problem_id == "p1"
    assert runtime.step_number == 1


def test_parse_signed_runtime_bundle_rejects_missing_daycare_host() -> None:
    with pytest.raises(CliError, match="missing host"):
        parse_signed_runtime_bundle(_signed_bundle(""), "missing host")
