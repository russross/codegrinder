import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  LocalRuntimeController,
  parseLocalRuntimeConfig,
  withTimeout,
} from "../scripts/localRuntime.ts";
import {
  pythonFileCommand,
  pythonLineCommand,
  requiredModules,
} from "../scripts/pythonRuntime.js";
import { isTurtleFile } from "../scripts/turtleRuntime.ts";

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

test("a stalled runtime operation fails with its loading stage", async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 10, "starting the test runtime"),
    /Timed out starting the test runtime after 0.01 seconds/,
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

  assert.deepEqual(await controller.select("unsupported"), { kind: "unavailable" });
  assert.equal(loadCount, 0);
  assert.deepEqual(await controller.select("javascriptunittest"), {
    kind: "ready",
    runtimeName: "javascript",
  });
  assert.equal(loadCount, 1);
  assert.deepEqual(await controller.select("javascriptunittest"), {
    kind: "ready",
    runtimeName: "javascript",
  });
  assert.equal(loadCount, 1);
  assert.deepEqual(await controller.select("javascriptunittest", "replace"), {
    kind: "ready",
    runtimeName: "javascript",
  });
  assert.equal(loadCount, 2);
  assert.equal(destroyCount, 1);
  assert.deepEqual(await controller.select("unsupported"), { kind: "unavailable" });
  assert.equal(destroyCount, 2);
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
  const activeSelection = await controller.select("javascriptunittest");
  finishPythonImport({
    createRuntime: () => runtime({ destroy: () => { staleRuntimeDestroyed = true; } }),
  });
  await staleSelection;
  await controller.runFile({}, "/main.js");

  assert.equal(staleRuntimeDestroyed, true);
  assert.equal(activeRuntimeRan, true);
  assert.deepEqual(activeSelection, { kind: "ready", runtimeName: "javascript" });
});

test("local tests are used only when the selected runtime implements them", async () => {
  const workspace = { "main.py": new TextEncoder().encode("print('hello')") };
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

test("Python requirements follow the deployed nested files and SQL runtime", () => {
  assert.deepEqual(
    requiredModules({
      "doc/requirements.txt": new TextEncoder().encode("\n# used by the assignment\nmatplotlib\n pyfiglet \n"),
      "bin/requirements.txt": new TextEncoder().encode("sqlite3\nmatplotlib\n"),
      "exam.sql": new Uint8Array(),
    }),
    ["matplotlib", "pyfiglet", "sqlite3", "pandas"],
  );
  assert.deepEqual(requiredModules({
    "src/not-requirements.txt": new TextEncoder().encode("numpy"),
  }), []);
});

test("Python execution dispatch follows the selected file type", () => {
  assert.equal(pythonFileCommand("/main.py"), "run_script(\"./main.py\")");
  assert.equal(pythonFileCommand("/exam.sql"), "run_sql_file(\"./exam.sql\")");
  assert.equal(
    pythonLineCommand("select * from revenue\n", "/exam.sql"),
    "run_sql_line(\"select * from revenue\\n\")",
  );
  assert.equal(
    pythonLineCommand("await answer()\n", "/main.py"),
    "await run_console_line(\"await answer()\\n\")",
  );
});

test("Turtle dispatch follows source content rather than Python filenames", () => {
  const encoder = new TextEncoder();
  const files = {
    "drawing.py": encoder.encode("import turtle\nturtle.forward(10)\n"),
    "main.py": encoder.encode("print('turtle')\n"),
  };

  assert.equal(isTurtleFile(files, "/drawing.py"), true);
  assert.equal(isTurtleFile(files, "/main.py"), false);
  assert.equal(isTurtleFile(files, "/missing.py"), false);
});
