import assert from "node:assert/strict";
import test from "node:test";

import {
  isCommonWorkerRequest,
  isPythonWorkerRequest,
  isWorkerEvent,
} from "../scripts/workerProtocol.ts";

const files = { "src/main.py": new TextEncoder().encode("print('hello')") };

test("worker requests validate the complete cloned workspace shape", () => {
  assert.equal(isCommonWorkerRequest({
    code: "run_script('./src/main.py')",
    files,
    type: "run",
  }), true);
  assert.equal(isCommonWorkerRequest({
    code: "run_script('./src/main.py')",
    files: { "main.py": "print('hello')" },
    type: "run",
  }), false);
  assert.equal(isPythonWorkerRequest({
    modules: ["matplotlib", "cisc108"],
    requestId: 4,
    type: "loadModules",
  }), true);
  assert.equal(isPythonWorkerRequest({
    modules: ["matplotlib", { package: "cisc108" }],
    requestId: 4,
    type: "loadModules",
  }), false);
});

test("worker events reject ambiguous output and request acknowledgements", () => {
  assert.equal(isWorkerEvent({ stream: "stdout", type: "output", value: "ready\n" }), true);
  assert.equal(isWorkerEvent({ stream: "console", type: "output", value: "ready\n" }), false);
  assert.equal(isWorkerEvent({ requestId: 7, type: "modulesLoaded" }), true);
  assert.equal(isWorkerEvent({ requestId: "7", type: "modulesLoaded" }), false);
  assert.equal(isWorkerEvent({ message: "package unavailable", type: "moduleLoadFailed" }), false);
});
