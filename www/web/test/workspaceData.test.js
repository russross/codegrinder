import assert from "node:assert/strict";
import test from "node:test";

import { localStudentFiles, workspaceState } from "../scripts/protocol.ts";

test("workspace refresh preserves local owner bytes without admitting extra files", () => {
  const originalMain = new TextEncoder().encode("console.log('original')");
  const editedMain = new TextEncoder().encode("console.log('edited')");
  const binary = new Uint8Array([0xff, 0x00, 0x80]);
  const workspace = workspaceState({
    assignment: { courseId: "course", problemSetId: "pset", userId: "student" },
    studentOwnedFiles: { "main.js": originalMain, "fixture.bin": binary },
    systemOwnedFiles: { "tests/main.test.js": new Uint8Array() },
  });
  const problem = { progress: {}, workspace };

  const refreshed = localStudentFiles(problem, {
    "main.js": editedMain,
    "tests/main.test.js": new TextEncoder().encode("tampered"),
    "scratch.txt": new TextEncoder().encode("unowned"),
  });

  assert.deepEqual(Object.keys(refreshed).sort(), ["fixture.bin", "main.js"]);
  assert.equal(refreshed["main.js"], editedMain);
  assert.equal(refreshed["fixture.bin"], binary);
});

test("workspace responses validate their identity and all protocol paths", () => {
  assert.throws(
    () => workspaceState({ studentOwnedFiles: {}, systemOwnedFiles: {} }),
    /did not include its assignment key/,
  );
  assert.throws(
    () => workspaceState({
      assignment: { courseId: "course", problemSetId: "pset", userId: "student" },
      studentOwnedFiles: {},
      systemOwnedFiles: { "src/../secret": new Uint8Array() },
    }),
    /Invalid workspace path/,
  );
});
