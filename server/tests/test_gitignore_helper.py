from __future__ import annotations

import subprocess
from pathlib import Path

from mutations import _filter_ignored_paths


def _git_kept_paths(tmp_path: Path, tree: dict[str, bytes]) -> set[str]:
    subprocess.run(["git", "init"], cwd=tmp_path, check=True, stdout=subprocess.DEVNULL)
    for name, content in tree.items():
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    proc = subprocess.run(
        ["git", "check-ignore", "--stdin"],
        cwd=tmp_path,
        input="\n".join(tree).encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.returncode not in (0, 1):
        raise AssertionError(proc.stderr.decode("utf-8", errors="replace"))
    ignored = {line for line in proc.stdout.decode("utf-8").splitlines() if line}
    return set(tree) - ignored


def test_filter_ignored_paths_matches_git_check_ignore(tmp_path: Path) -> None:
    tree = {
        ".gitignore": b"ignored.tmp\n!keep.tmp\nspace\\ name.txt\ndir/\n\\#literal.txt\n",
        "ignored.tmp": b"",
        "keep.tmp": b"",
        "space name.txt": b"",
        "#literal.txt": b"",
        "dir/a.txt": b"",
        "plain.txt": b"",
        "subdir/.gitignore": b"*.tmp\n!keep.tmp\n/rootonly.txt\nnested/\n",
        "subdir/keep.tmp": b"",
        "subdir/drop.tmp": b"",
        "subdir/rootonly.txt": b"",
        "subdir/child/rootonly.txt": b"",
        "subdir/nested/a.txt": b"",
    }

    assert set(_filter_ignored_paths(tree)) == _git_kept_paths(tmp_path, tree)
