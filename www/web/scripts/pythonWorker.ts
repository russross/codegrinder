import {
  isPythonWorkerRequest,
  type WorkerDirectoryNode,
  type WorkerEvent,
  type WorkerFileSystem,
  type WorkerWorkspaceNode,
} from "./workerProtocol.js";
import { readWorkerInput } from "./workerInputReader.js";
import { createPythonOutputWriter, type PythonOutputWriter } from "./pythonOutput.js";

interface PyodideFileSystem {
  createPath(parent: string, path: string, canRead: boolean, canWrite: boolean): void;
  isDir(mode: number): boolean;
  lookupPath(path: string): { node: { mode: number } };
  readdir(path: string): string[];
  rmdir(path: string): void;
  unlink(path: string): void;
  writeFile(path: string, content: string): void;
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

declare function importScripts(...urls: string[]): void;
declare function loadPyodide(options: { indexURL: string }): Promise<Pyodide>;
declare function postMessage(message: WorkerEvent): void;

const pyodideIndexUrl = "https://cdn.jsdelivr.net/pyodide/v0.29.1/full/";

postMessage({ status: "downloading Python runtime", type: "loading" });
importScripts(`${pyodideIndexUrl}pyodide.js`);

let inputUrl: string | null = null;
let pyodide: Pyodide | null = null;
const modules = new Set(["cisc108"]);

function readInput(): string {
  if (inputUrl === null) {
    throw new Error("Python runtime input is not initialized");
  }
  return readWorkerInput(inputUrl);
}

function sendOutput(stream: "stderr" | "stdout", value: string): void {
  postMessage({ stream, type: "output", value });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDirectory(node: WorkerWorkspaceNode): node is WorkerDirectoryNode {
  return node.children !== undefined;
}

function writeDirectory(runtime: Pyodide, directory: WorkerDirectoryNode, path: string): void {
  for (const [name, node] of Object.entries(directory.children)) {
    if (isDirectory(node)) {
      writeDirectory(runtime, node, `${path}${name}/`);
      continue;
    }
    runtime.FS.createPath(".", path, true, true);
    runtime.FS.writeFile(`${path}${name}`, node.content);
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

function replaceWorkspace(runtime: Pyodide, fileSystem: WorkerFileSystem): void {
  deleteRecursively(runtime, ".", true);
  writeDirectory(runtime, fileSystem.rootNode, "./");
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

async function run(runtime: Pyodide, fileSystem: WorkerFileSystem, code: string): Promise<void> {
  try {
    replaceWorkspace(runtime, fileSystem);
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
  if (pyodide !== null) {
    throw new Error("Python runtime is already initialized");
  }
  inputUrl = url;
  postMessage({ status: "initializing Python runtime", type: "loading" });
  const runtime = await loadPyodide({ indexURL: pyodideIndexUrl });
  pyodide = runtime;
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
`);
  runtime.registerJsModule("codegrinder", {
    show_image(image: unknown): void {
      if (typeof image !== "string") {
        throw new Error("Matplotlib produced invalid image data");
      }
      postMessage({ pngBase64: image, type: "displayImage" });
    },
  });
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
  const runtime = pyodide;
  if (runtime === null) {
    postMessage({ message: "Python runtime received a request before initialization", type: "failed" });
    return;
  }
  if (request.type === "loadModules") {
    void loadModules(runtime, request.requestId, request.modules);
    return;
  }
  void run(runtime, request.fileSystem, request.code);
});
