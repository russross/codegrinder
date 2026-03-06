from __future__ import annotations

import json
from pathlib import Path

import helpers
from models import AssignmentRef, DotFileInfo, ProblemInfo


def test_write_and_load_config_uses_xdg_path(monkeypatch, tmp_path: Path) -> None:
    cfg_dir = tmp_path / "cfg"
    cfg_file = cfg_dir / "config.json"
    monkeypatch.setattr(helpers, "CONFIG_DIR", cfg_dir)
    monkeypatch.setattr(helpers, "CONFIG_FILE", cfg_file)

    config = helpers.Config(host="example.edu", cookie="abc123")
    helpers.write_config(config)

    payload = json.loads(cfg_file.read_text(encoding="utf-8"))
    assert payload == {"host": "example.edu", "cookie": "abc123"}

    loaded = helpers.load_config()
    assert loaded.host == "example.edu"
    assert loaded.cookie == "abc123"


def test_dotfile_round_trip_matches_go_shape(tmp_path: Path) -> None:
    dotfile_path = tmp_path / ".grind"
    dotfile = DotFileInfo(
        assignment_ref=AssignmentRef(
            user_id="u1",
            course_id="c1",
            problem_set_id="ps1",
        ),
        problems={
            "p1": ProblemInfo(problem_id="p101", step=1, total_steps=2),
            "p2": ProblemInfo(problem_id="p202", step=3, total_steps=3),
        },
        path=str(dotfile_path),
    )
    helpers.save_dotfile(dotfile)

    raw = json.loads(dotfile_path.read_text(encoding="utf-8"))
    assert raw["assignmentRef"] == {"userID": "u1", "courseID": "c1", "problemSetID": "ps1"}
    assert raw["problems"]["p1"] == {"problemID": "p101", "step": 1, "totalSteps": 2}
    assert raw["problems"]["p2"] == {"problemID": "p202", "step": 3, "totalSteps": 3}

    parsed, _, _ = helpers.find_dotfile(tmp_path)
    assert parsed.assignment_ref.problem_set_id == "ps1"
    assert parsed.problems["p2"].step == 3
