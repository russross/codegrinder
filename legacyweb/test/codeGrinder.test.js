import assert from "node:assert/strict";
import test from "node:test";

import {
  availableActionControls,
  consumeActionResponses,
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
});

test("daycare output rejects invalid UTF-8 and workspace paths at the protocol boundary", async () => {
  const callbacks = { files: () => {}, stderr: () => {}, stdout: () => {} };
  await assert.rejects(
    () => consumeActionResponses([{
      response: {
        oneofKind: "event",
        event: { event: "stdout", streamData: new Uint8Array([0xff]) },
      },
    }], callbacks),
    /encoded data was not valid|UTF-8/i,
  );
  await assert.rejects(
    () => consumeActionResponses([{
      response: {
        oneofKind: "event",
        event: { event: "files", files: { "../outside.txt": new Uint8Array() } },
      },
    }], callbacks),
    /Invalid workspace path/,
  );
});

test("a non-grade action requires an explicit completion even after a failed test", async () => {
  const stdout = [];
  const stderr = [];
  await consumeActionResponses(
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
      { response: { oneofKind: "result", result: { saveStatus: 1 } } },
    ],
    {
      files: () => assert.fail("unexpected files event"),
      stderr: (value) => stderr.push(value),
      stdout: (value) => stdout.push(value),
    },
  );

  assert.deepEqual(stdout, ["FAIL tests/test_helloWorld.js\n"]);
  assert.deepEqual(stderr, []);
});

test("daycare file events preserve binary workspace content", async () => {
  const binary = new Uint8Array([0xff, 0x00, 0x80]);
  let returnedFiles;

  await consumeActionResponses(
    [{
      response: {
        oneofKind: "event",
        event: { event: "files", files: { "output.bin": binary } },
      },
    }, { response: { oneofKind: "result", result: { saveStatus: 1 } } }],
    {
      files: (files) => { returnedFiles = files; },
      stderr: () => {},
      stdout: () => {},
    },
  );

  assert.equal(returnedFiles["output.bin"], binary);
});

test("execution requires the server to return a completion result", async () => {
  await assert.rejects(
    () => consumeActionResponses([], {
      files: () => {},
      stderr: () => {},
      stdout: () => {},
    }),
    /without a result/,
  );
});

test("execution preserves the server grade, save outcome, and LMS lock decision", async () => {
  const result = {
    saveStatus: 1,
    lockedForLms: true,
    grade: { reportCard: { passed: true }, score: 1 },
  };
  assert.equal(await consumeActionResponses([
    { response: { oneofKind: "result", result } },
  ], { files: () => {}, stderr: () => {}, stdout: () => {} }), result);
});

test("execution propagates transport failures and rejects empty responses", async () => {
  const callbacks = { files: () => {}, stderr: () => {}, stdout: () => {} };
  async function* interrupted() {
    yield { response: { oneofKind: "event", event: { event: "exit", exitStatus: 0 } } };
    throw new Error("connection interrupted");
  }
  await assert.rejects(() => consumeActionResponses(interrupted(), callbacks), /connection interrupted/);
  await assert.rejects(
    () => consumeActionResponses([{ response: { oneofKind: undefined } }], callbacks),
    /Unexpected execution response/,
  );
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
