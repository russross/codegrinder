import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const asttestPath = fileURLToPath(new URL(
  "../../../problemtypes/types/python3unittest/files/tests/asttest.py",
  import.meta.url,
));

const verificationProgram = String.raw`
import importlib.util
import os
from pathlib import Path
import sys

asttest_path, workspace = sys.argv[1:]
spec = importlib.util.spec_from_file_location("canonical_asttest", asttest_path)
if spec is None or spec.loader is None:
    raise RuntimeError("could not load canonical asttest")
asttest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(asttest)

old_cwd = os.getcwd()
sys.path.insert(0, workspace)
os.chdir(workspace)
try:
    solution = Path("solution.py")
    solution.write_text(
        "def classify(value):\n"
        "    if value > 0:\n"
        "        return 'positive'\n"
        "    return 'other'\n"
        "\n"
        "assert classify(1) == 'positive'\n"
        "assert classify(0) == 'other'\n",
        encoding="utf-8",
    )
    case = asttest.ASTTest()
    case.setUp("solution.py")
    case.ensure_coverage(["classify"], 0.99)

    solution.write_text(
        "def classify(value):\n"
        "    if value > 0:\n"
        "        return 'positive'\n"
        "    return 'other'\n"
        "\n"
        "assert classify(1) == 'positive'\n",
        encoding="utf-8",
    )
    case = asttest.ASTTest()
    case.setUp("solution.py")
    try:
        case.ensure_coverage(["classify"], 0.99)
    except AssertionError as error:
        if "return 'other'" not in str(error):
            raise
    else:
        raise AssertionError("incomplete branch coverage unexpectedly passed")
finally:
    os.chdir(old_cwd)
    sys.path.remove(workspace)
`;

test("canonical asttest derives coverage without platform-specific cover files", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "codegrinder-asttest-"));
  try {
    const result = spawnSync(
      "python3",
      ["-c", verificationProgram, asttestPath, workspace],
      {
        encoding: "utf8",
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(readdirSync(workspace).filter((name) => name.endsWith(".cover")), []);
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }
});
