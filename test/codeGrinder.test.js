import assert from "node:assert/strict";
import test from "node:test";

import {
  formatAssignmentKey,
  normalizeRelativePath,
  parseAssignmentKey,
} from "../scripts/codeGrinderApi.js";

test("assignment keys survive the LTI URL representation", () => {
  const raw = "student-17:course_204:javascript-intro";
  const assignment = parseAssignmentKey(raw);

  assert.deepEqual(assignment, {
    userId: "student-17",
    courseId: "course_204",
    problemSetId: "javascript-intro",
  });
  assert.equal(formatAssignmentKey(assignment), raw);
});

test("workspace paths reject alternate spellings of the same destination", () => {
  const invalidPaths = [
    "/main.js",
    "./main.js",
    "src/../main.js",
    "src//main.js",
    "src\\main.js",
    "",
  ];

  for (const path of invalidPaths) {
    assert.throws(() => normalizeRelativePath(path), /Invalid workspace path/);
  }
  assert.equal(normalizeRelativePath("src/lib/main.js"), "src/lib/main.js");
});

test("assignment keys require all three natural-key fields", () => {
  for (const raw of ["student:course", "student::problem", ":course:problem", "student:course:problem:extra"]) {
    assert.throws(() => parseAssignmentKey(raw), /Invalid assignment key/);
  }
});
