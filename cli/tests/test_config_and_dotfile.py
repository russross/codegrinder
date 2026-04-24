from __future__ import annotations

import tomllib
from pathlib import Path

import helpers
from models import AssignmentRef, DotFileInfo, ProblemInfo


def test_write_and_load_config_uses_xdg_path(monkeypatch, tmp_path: Path) -> None:
    cfg_dir = tmp_path / "cfg"
    cfg_file = cfg_dir / "config.toml"
    monkeypatch.setattr(helpers, "CONFIG_DIR", cfg_dir)
    monkeypatch.setattr(helpers, "CONFIG_FILE", cfg_file)

    config = helpers.Config(host="example.edu", cookie="abc123")
    helpers.write_config(config)

    payload = tomllib.loads(cfg_file.read_text(encoding="utf-8"))
    assert payload == {"host": "example.edu", "cookie": "abc123", "workspace_root": str(Path.home())}

    loaded = helpers.load_config()
    assert loaded.host == "example.edu"
    assert loaded.cookie == "abc123"
    assert loaded.workspace_root == Path.home()
    assert not loaded.instructor


def test_login_config_update_preserves_user_settings(monkeypatch, tmp_path: Path) -> None:
    cfg_dir = tmp_path / "cfg"
    cfg_file = cfg_dir / "config.toml"
    monkeypatch.setattr(helpers, "CONFIG_DIR", cfg_dir)
    monkeypatch.setattr(helpers, "CONFIG_FILE", cfg_file)

    workspace_root = tmp_path / "work"
    cfg_dir.mkdir()
    cfg_file.write_text(
        f'host = "old.example.edu"\n'
        f'cookie = "old-cookie"\n'
        f'workspace_root = "{workspace_root}"\n'
        'instructor = true\n',
        encoding="utf-8",
    )

    helpers.write_config(helpers.Config(host="new.example.edu", cookie="new-cookie"))

    payload = tomllib.loads(cfg_file.read_text(encoding="utf-8"))
    assert payload == {
        "host": "new.example.edu",
        "cookie": "new-cookie",
        "workspace_root": str(workspace_root),
        "instructor": True,
    }


def test_load_config_or_default_handles_missing_file(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(helpers, "CONFIG_DIR", tmp_path / "cfg")
    monkeypatch.setattr(helpers, "CONFIG_FILE", tmp_path / "cfg" / "config.toml")

    config = helpers.load_config_or_default()

    assert config.workspace_root == Path.home()
    assert not config.instructor


def test_dotfile_round_trip_uses_toml(tmp_path: Path) -> None:
    dotfile_path = tmp_path / ".grind"
    dotfile = DotFileInfo(
        assignment_ref=AssignmentRef(
            user_id="u1",
            course_id="c1",
            problem_set_id="ps1",
        ),
        problems={
            "p1": ProblemInfo(problem_id="p101", step=1),
            "p2": ProblemInfo(problem_id="p202", step=3),
        },
        path=str(dotfile_path),
    )
    helpers.save_dotfile(dotfile)

    raw = tomllib.loads(dotfile_path.read_text(encoding="utf-8"))
    assert raw["assignment"] == {"user_id": "u1", "course_id": "c1", "problem_set_id": "ps1"}
    assert raw["problems"]["p1"] == {"problem_id": "p101", "step": 1}
    assert raw["problems"]["p2"] == {"problem_id": "p202", "step": 3}

    parsed, _, _ = helpers.find_dotfile(tmp_path)
    assert parsed.assignment_ref.problem_set_id == "ps1"
    assert parsed.problems["p2"].step == 3
