import {
  isPythonWorkerRequest,
  type WorkerEvent,
  type WorkerFiles,
} from "./workerProtocol.js";
import { readWorkerInput } from "./workerInputReader.js";
import { createPythonOutputWriter, type PythonOutputWriter } from "./pythonOutput.js";

interface PyodideFileSystem {
  analyzePath(path: string): { exists: boolean };
  createPath(parent: string, path: string, canRead: boolean, canWrite: boolean): void;
  isDir(mode: number): boolean;
  lookupPath(path: string): { node: { mode: number } };
  readdir(path: string): string[];
  rmdir(path: string): void;
  unlink(path: string): void;
  writeFile(path: string, content: Uint8Array): void;
}

interface Pyodide {
  readonly FS: PyodideFileSystem;
  loadPackage(packageName: string): Promise<void>;
  registerJsModule(name: string, module: object): void;
  runPython(code: string): unknown;
  runPythonAsync(code: string): Promise<unknown>;
  setStderr(options: PythonOutputWriter): void;
  setStdin(options: { stdin(): string }): void;
  setStdout(options: PythonOutputWriter): void;
}

type PythonWorkerState =
  | { readonly inputUrl: string; readonly kind: "loading" }
  | { readonly inputUrl: string; readonly kind: "ready"; readonly runtime: Pyodide }
  | { readonly kind: "starting" };

declare function importScripts(...urls: string[]): void;
declare function loadPyodide(options: { indexURL: string }): Promise<Pyodide>;
declare function postMessage(message: WorkerEvent): void;

const pyodideIndexUrl = "https://cdn.jsdelivr.net/pyodide/v0.29.1/full/";

postMessage({ status: "downloading Python runtime", type: "loading" });
importScripts(`${pyodideIndexUrl}pyodide.js`);

let state: PythonWorkerState = { kind: "starting" };
const modules = new Set(["cisc108"]);
let workspacePaths = new Set<string>();

function readInput(): string {
  if (state.kind === "starting") {
    throw new Error("Python runtime input is not initialized");
  }
  return readWorkerInput(state.inputUrl);
}

function sendOutput(stream: "stderr" | "stdout", value: string): void {
  postMessage({ stream, type: "output", value });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function writeFiles(runtime: Pyodide, files: WorkerFiles): void {
  for (const [path, content] of Object.entries(files)) {
    const directory = path.split("/").slice(0, -1).join("/");
    if (directory !== "") {
      runtime.FS.createPath(".", directory, true, true);
    }
    const workspacePath = `./${path}`;
    if (runtime.FS.analyzePath(workspacePath).exists
      && runtime.FS.isDir(runtime.FS.lookupPath(workspacePath).node.mode)) {
      deleteRecursively(runtime, workspacePath);
    }
    runtime.FS.writeFile(workspacePath, content);
  }
}

function deleteRecursively(runtime: Pyodide, path: string, onlyChildren = false): void {
  const node = runtime.FS.lookupPath(path).node;
  if (!runtime.FS.isDir(node.mode)) {
    if (!onlyChildren) {
      runtime.FS.unlink(path);
    }
    return;
  }
  for (const name of runtime.FS.readdir(path)) {
    if (name === "." || name === "..") {
      continue;
    }
    deleteRecursively(runtime, `${path}/${name}`);
  }
  if (!onlyChildren) {
    runtime.FS.rmdir(path);
  }
}

function syncWorkspace(runtime: Pyodide, files: WorkerFiles): void {
  for (const path of workspacePaths) {
    if (files[path] !== undefined) {
      continue;
    }
    const workspacePath = `./${path}`;
    if (runtime.FS.analyzePath(workspacePath).exists) {
      deleteRecursively(runtime, workspacePath);
    }
  }
  writeFiles(runtime, files);
  workspacePaths = new Set(Object.keys(files));
}

async function loadModules(runtime: Pyodide, requestId: number, requestedModules: readonly string[]): Promise<void> {
  const missing = requestedModules
    .map((moduleName) => moduleName.trim())
    .filter((moduleName) => moduleName !== "" && !modules.has(moduleName));
  try {
    if (missing.length > 0) {
      await runtime.runPythonAsync(`
import micropip
await micropip.install(${JSON.stringify(missing)})
`);
      for (const moduleName of missing) {
        modules.add(moduleName);
      }
    }
    if (missing.includes("matplotlib")) {
      runtime.runPython(`
import base64
import os
from io import BytesIO

os.environ["MPLBACKEND"] = "AGG"
import codegrinder
import matplotlib.pyplot

def show_image():
    image = BytesIO()
    matplotlib.pyplot.savefig(image, format="png")
    image.seek(0)
    codegrinder.show_image(base64.b64encode(image.read()).decode("utf-8"))
    matplotlib.pyplot.clf()

matplotlib.pyplot.show = show_image
`);
    }
    postMessage({ requestId, type: "modulesLoaded" });
  } catch (error: unknown) {
    postMessage({ message: errorMessage(error), requestId, type: "moduleLoadFailed" });
  }
}

async function run(runtime: Pyodide, files: WorkerFiles, code: string): Promise<void> {
  try {
    syncWorkspace(runtime, files);
    await runtime.runPythonAsync(code);
  } catch (error: unknown) {
    sendOutput("stderr", `${errorMessage(error)}\n`);
  } finally {
    try {
      runtime.runPython("import sys\nsys.stdout.flush()\nsys.stderr.flush()");
    } catch (error: unknown) {
      sendOutput("stderr", `${errorMessage(error)}\n`);
    }
    postMessage({ type: "finished" });
  }
}

async function initialize(url: string): Promise<void> {
  if (state.kind !== "starting") {
    throw new Error("Python runtime is already initialized");
  }
  state = { inputUrl: url, kind: "loading" };
  postMessage({ status: "initializing Python runtime", type: "loading" });
  const runtime = await loadPyodide({ indexURL: pyodideIndexUrl });
  runtime.setStdin({ stdin: readInput });
  runtime.setStdout(createPythonOutputWriter((value) => sendOutput("stdout", value)));
  runtime.setStderr(createPythonOutputWriter((value) => sendOutput("stderr", value)));

  postMessage({ status: "loading Python packages", type: "loading" });
  await runtime.loadPackage("micropip");
  await runtime.runPythonAsync(`
import micropip
await micropip.install(["cisc108"])
`);
  runtime.runPython(`
import ast
import inspect
import sys

def invalidate_import_cache():
    for module_name, module in list(sys.modules.items()):
        module_path = getattr(module, "__file__", None)
        if module_path is not None and module_path.startswith("/home/pyodide/"):
            del sys.modules[module_name]

async def run_console_line(source):
    try:
        code = compile(source, "<console>", "eval", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
        is_expression = True
    except SyntaxError:
        code = compile(source, "<console>", "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
        is_expression = False

    result = eval(code, globals())
    if inspect.isawaitable(result):
        result = await result
    if is_expression:
        sys.displayhook(result)

def run_script(script_path):
    invalidate_import_cache()
    with open(script_path, "r") as source:
        code = compile(source.read(), script_path, "exec")

    original_argv = sys.argv.copy()
    sys.argv = [script_path]
    try:
        exec(code, globals())
    except SystemExit:
        pass
    finally:
        sys.argv = original_argv

def run_sql_file(script_path):
    import sqlite3
    from pathlib import Path

    Path("./bin").mkdir(parents=True, exist_ok=True)
    with sqlite3.connect("bin/data.db") as connection:
        with open(script_path) as source:
            connection.executescript(source.read())

def run_sql_line(source):
    import sqlite3
    from pathlib import Path
    import pandas

    command = source.strip()
    if not command:
        return
    Path("./bin").mkdir(parents=True, exist_ok=True)
    with sqlite3.connect("bin/data.db") as connection:
        cursor = connection.execute(command)
        rows = cursor.fetchall()
        if rows:
            print(pandas.DataFrame(rows, columns=[column[0] for column in cursor.description]))
`);
  runtime.registerJsModule("codegrinder", {
    show_image(image: unknown): void {
      if (typeof image !== "string") {
        throw new Error("Matplotlib produced invalid image data");
      }
      postMessage({ pngBase64: image, type: "displayImage" });
    },
  });
  state = { inputUrl: url, kind: "ready", runtime };
  postMessage({ status: "Python runtime ready", type: "loading" });
  postMessage({ type: "ready" });
}

addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!isPythonWorkerRequest(request)) {
    postMessage({ message: "Python runtime received an invalid request", type: "failed" });
    return;
  }
  if (request.type === "initialize") {
    void initialize(request.inputUrl).catch((error: unknown) => {
      postMessage({ message: errorMessage(error), type: "failed" });
    });
    return;
  }
  if (state.kind !== "ready") {
    postMessage({ message: "Python runtime received a request before initialization", type: "failed" });
    return;
  }
  const runtime = state.runtime;
  if (request.type === "loadModules") {
    void loadModules(runtime, request.requestId, request.modules);
    return;
  }
  void run(runtime, request.files, request.code);
});
