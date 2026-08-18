import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  LocalRuntimeController,
  parseLocalRuntimeConfig,
} from "../scripts/localRuntime.js";
import { requiredModules } from "../scripts/pythonRuntime.js";

test("the deployed runtime configuration supports only the initial problem types", async () => {
  const contents = await readFile(new URL("../local-runtimes.json", import.meta.url), "utf-8");
  const problemTypes = parseLocalRuntimeConfig(JSON.parse(contents));

  assert.deepEqual([...problemTypes], [
    ["javascriptunittest", "javascript"],
    ["python3unittest", "python"],
  ]);
});

test("invalid runtime configuration fails before a workspace is loaded", () => {
  assert.throws(
    () => parseLocalRuntimeConfig({ " python3unittest": "python" }),
    /Invalid problem type/,
  );
  assert.throws(
    () => parseLocalRuntimeConfig({ python3unittest: "pyodide" }),
    /Invalid local runtime/,
  );
});

test("runtime modules remain unloaded until a supported problem is selected", async () => {
  let loadCount = 0;
  let destroyCount = 0;
  const runtime = {
    configure: async () => {},
    destroy: () => { destroyCount += 1; },
    ready: Promise.resolve(),
    runFile: async () => {},
    runLine: async () => {},
    stop: async () => {},
    writeStdin: async () => {},
  };
  const controller = new LocalRuntimeController(
    new Map([["javascriptunittest", "javascript"]]),
    {},
    {
      javascript: async () => {
        loadCount += 1;
        return { createRuntime: () => runtime };
      },
    },
  );

  assert.equal(await controller.select("unsupported"), null);
  assert.equal(loadCount, 0);
  assert.equal(await controller.select("javascriptunittest"), "javascript");
  assert.equal(loadCount, 1);
  assert.equal(await controller.select("javascriptunittest"), "javascript");
  assert.equal(loadCount, 1);
  assert.equal(await controller.select("unsupported"), null);
  assert.equal(destroyCount, 1);
});

test("a late runtime import cannot replace a newer problem selection", async () => {
  let finishPythonImport;
  let staleRuntimeDestroyed = false;
  let activeRuntimeRan = false;
  const pythonImport = new Promise((resolve) => {
    finishPythonImport = resolve;
  });
  const runtime = (overrides = {}) => ({
    configure: async () => {},
    destroy: () => {},
    ready: Promise.resolve(),
    runFile: async () => {},
    runLine: async () => {},
    stop: async () => {},
    writeStdin: async () => {},
    ...overrides,
  });
  const controller = new LocalRuntimeController(
    new Map([
      ["javascriptunittest", "javascript"],
      ["python3unittest", "python"],
    ]),
    {},
    {
      javascript: async () => ({
        createRuntime: () => runtime({ runFile: async () => { activeRuntimeRan = true; } }),
      }),
      python: () => pythonImport,
    },
  );

  const staleSelection = controller.select("python3unittest");
  await controller.select("javascriptunittest");
  finishPythonImport({
    createRuntime: () => runtime({ destroy: () => { staleRuntimeDestroyed = true; } }),
  });
  await staleSelection;
  await controller.runFile({}, "/main.js");

  assert.equal(staleRuntimeDestroyed, true);
  assert.equal(activeRuntimeRan, true);
  assert.equal(controller.runtimeName, "javascript");
});

test("local tests are used only when the selected runtime implements them", async () => {
  const workspace = { rootNode: { children: {} } };
  let testedWorkspace = null;
  const runtime = (runTests) => ({
    configure: async () => {},
    destroy: () => {},
    ready: Promise.resolve(),
    runFile: async () => {},
    runLine: async () => {},
    runTests,
    stop: async () => {},
    writeStdin: async () => {},
  });
  const controller = new LocalRuntimeController(
    new Map([
      ["javascriptunittest", "javascript"],
      ["python3unittest", "python"],
    ]),
    {},
    {
      javascript: async () => ({ createRuntime: () => runtime(undefined) }),
      python: async () => ({
        createRuntime: () => runtime(async (files) => { testedWorkspace = files; }),
      }),
    },
  );

  await controller.select("javascriptunittest");
  assert.equal(controller.supportsLocalTests, false);
  await assert.rejects(() => controller.runTests(workspace), /no local test runner/);

  await controller.select("python3unittest");
  assert.equal(controller.supportsLocalTests, true);
  await controller.runTests(workspace);
  assert.equal(testedWorkspace, workspace);
});

test("Python requirements are explicit and ignore blank and comment lines", () => {
  assert.deepEqual(
    requiredModules({
      "requirements.txt": "\n# used by the assignment\nmatplotlib\n cisc108 == 3.0.1 \n",
    }),
    ["matplotlib", "cisc108 == 3.0.1"],
  );
  assert.deepEqual(requiredModules({ "src/requirements.txt": "numpy" }), []);
});
