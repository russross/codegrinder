import assert from "node:assert/strict";
import test from "node:test";

import {
  isCommonWorkerRequest,
  isPythonWorkerRequest,
  isWorkerEvent,
} from "../scripts/workerProtocol.ts";

const fileSystem = {
  rootNode: {
    children: {
      src: {
        children: {
          "main.py": { content: "print('hello')" },
        },
        collapsed: false,
      },
    },
    collapsed: false,
  },
};

test("worker requests validate the complete cloned workspace shape", () => {
  assert.equal(isCommonWorkerRequest({
    code: "run_script('./src/main.py')",
    fileSystem,
    type: "run",
  }), true);
  assert.equal(isCommonWorkerRequest({
    code: "run_script('./src/main.py')",
    fileSystem: {
      rootNode: {
        children: {
          "main.py": { content: new Uint8Array([112, 114, 105, 110, 116]) },
        },
        collapsed: false,
      },
    },
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
