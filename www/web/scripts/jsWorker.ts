import {
  isCommonWorkerRequest,
  type WorkerDirectoryNode,
  type WorkerEvent,
  type WorkerFileSystem,
  type WorkerWorkspaceNode,
} from "./workerProtocol.js";
import { readWorkerInput } from "./workerInputReader.js";

declare function postMessage(message: WorkerEvent): void;

declare global {
  var prompt: (message?: string) => string;
  var readline: () => string;
  var require: (modulePath: string) => unknown;
  var run_script: (scriptPath: string) => void;
}

interface CommonJsModule {
  exports: unknown;
}

type CommonJsRequire = (modulePath: string) => unknown;
postMessage({ status: "initializing JavaScript runtime", type: "loading" });

let fileSystem: WorkerFileSystem | null = null;
let inputUrl: string | null = null;
const moduleCache: Record<string, CommonJsModule> = {};

function readInput(): string {
  if (inputUrl === null) {
    throw new Error("JavaScript runtime input is not initialized");
  }
  return readWorkerInput(inputUrl);
}

globalThis.readline = readInput;
globalThis.prompt = (message = "") => {
  if (message !== "") {
    sendOutput("stdout", message);
  }
  return readInput().replace(/\r?\n$/, "");
};

function formatConsoleValue(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function sendOutput(stream: "stderr" | "stdout", value: string): void {
  postMessage({ stream, type: "output", value });
}

const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.log = (...values: unknown[]): void => {
  sendOutput("stdout", `${values.map(formatConsoleValue).join(" ")}\n`);
  originalConsoleLog(...values);
};

console.error = (...values: unknown[]): void => {
  sendOutput("stderr", `${values.map(String).join(" ")}\n`);
  originalConsoleError(...values);
};

console.warn = (...values: unknown[]): void => {
  sendOutput("stderr", `${values.map(String).join(" ")}\n`);
  originalConsoleWarn(...values);
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack ?? ""}\n`;
  }
  return `${String(error)}\n`;
}

function runJavaScript(code: string): void {
  try {
    const execute = new Function("fileSystem", "console", code);
    execute(fileSystem, console);
  } catch (error: unknown) {
    sendOutput("stderr", errorMessage(error));
  }
}

function isDirectory(node: WorkerWorkspaceNode): node is WorkerDirectoryNode {
  return node.children !== undefined;
}

function getFileContent(path: string): string {
  if (fileSystem === null) {
    throw new Error("File system is not initialized");
  }
  let current: WorkerWorkspaceNode = fileSystem.rootNode;
  for (const part of path.split("/").filter((pathPart) => pathPart !== "")) {
    if (!isDirectory(current)) {
      throw new Error(`File not found: ${path}`);
    }
    const child: WorkerWorkspaceNode | undefined = current.children[part];
    if (child === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    current = child;
  }
  if (isDirectory(current)) {
    throw new Error(`${path} is a directory, not a file`);
  }
  return current.content;
}

function resolveModulePath(modulePath: string, parentPath: string): string {
  const parentParts = parentPath.split("/").filter(Boolean);
  parentParts.pop();
  const parts = modulePath.startsWith("/") ? [] : parentParts;
  for (const part of modulePath.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      if (parts.length === 0) {
        throw new Error(`Module path escapes the workspace: ${modulePath}`);
      }
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  let resolved = `/${parts.join("/")}`;
  if (!resolved.endsWith(".js")) {
    resolved += ".js";
  }
  return resolved;
}

function loadModule(path: string): unknown {
  const cached = moduleCache[path];
  if (cached !== undefined) {
    return cached.exports;
  }
  const module: CommonJsModule = { exports: {} };
  moduleCache[path] = module;
  try {
    const code = getFileContent(path);
    const localRequire: CommonJsRequire = (modulePath) => loadModule(resolveModulePath(modulePath, path));
    const execute = new Function("module", "exports", "require", "console", code);
    execute(module, module.exports, localRequire, console);
    return module.exports;
  } catch (error: unknown) {
    delete moduleCache[path];
    throw error;
  }
}

globalThis.require = (modulePath: string): unknown => loadModule(resolveModulePath(modulePath, "/"));
globalThis.run_script = (scriptPath: string): void => {
  for (const path of Object.keys(moduleCache)) {
    delete moduleCache[path];
  }
  try {
    loadModule(resolveModulePath(scriptPath, "/"));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    sendOutput("stderr", `Error running script ${scriptPath}: ${message}\n`);
  }
};

addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!isCommonWorkerRequest(request)) {
    postMessage({ message: "JavaScript runtime received an invalid request", type: "failed" });
    return;
  }
  if (request.type === "initialize") {
    inputUrl = request.inputUrl;
    postMessage({ status: "JavaScript runtime ready", type: "loading" });
    postMessage({ type: "ready" });
    return;
  }
  fileSystem = request.fileSystem;
  runJavaScript(request.code);
  postMessage({ type: "finished" });
});
