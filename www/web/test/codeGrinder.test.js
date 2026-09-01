import assert from "node:assert/strict";
import test from "node:test";

import {
  actionButtonLabel,
  availableActionControls,
  consumeDaycareResponses,
  formatAssignmentKey,
  normalizeRelativePath,
  parseAssignmentKey,
} from "../scripts/protocol.ts";

test("workspace actions keep dedicated controls and flatten the remaining actions", () => {
  assert.deepEqual(availableActionControls(["grade", "test"]), {
    actions: [],
    grade: true,
    test: true,
  });
  assert.deepEqual(availableActionControls(["grade"]), {
    actions: [],
    grade: true,
    test: false,
  });
  assert.deepEqual(availableActionControls(["test", "step", "run", "step"]), {
    actions: ["step", "run"],
    grade: false,
    test: true,
  });
  assert.equal(actionButtonLabel("run"), "Run");
});

test("a non-grade daycare action completes successfully after its event stream", async () => {
  const stdout = [];
  const stderr = [];
  const finalBundle = await consumeDaycareResponses(
    [
      {
        response: {
          oneofKind: "event",
          event: {
            event: "stdout",
            streamData: new TextEncoder().encode("FAIL tests/test_helloWorld.js\n"),
          },
        },
      },
      {
        response: {
          oneofKind: "event",
          event: { event: "exit", exitStatus: 1 },
        },
      },
    ],
    {
      files: () => assert.fail("unexpected files event"),
      stderr: (value) => stderr.push(value),
      stdout: (value) => stdout.push(value),
    },
  );

  assert.equal(finalBundle, null);
  assert.deepEqual(stdout, ["FAIL tests/test_helloWorld.js\n"]);
  assert.deepEqual(stderr, []);
});

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
