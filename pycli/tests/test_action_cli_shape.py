from __future__ import annotations

import pytest

from cli import _build_parser


def test_action_command_does_not_accept_daycare_flag() -> None:
    parser = _build_parser()
    with pytest.raises(SystemExit):
        parser.parse_args(["action", "--daycare", "wss://example"])
