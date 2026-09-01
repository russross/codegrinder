import type { FileSystem } from "./directoryTree.js";
import type {
  LocalRuntime,
  RuntimeCallbacks,
  RuntimeFiles,
} from "./localRuntime.js";
import { PythonRunner } from "./pythonHandler.js";

const unittestDiscovery = `
import unittest

invalidate_import_cache()
loader = unittest.TestLoader()
suite = loader.discover("./tests")
runner = unittest.TextTestRunner()
runner.run(suite)
`;

function requiredModules(files: RuntimeFiles): string[] {
  const requirements = files["requirements.txt"];
  if (requirements === undefined) {
    return [];
  }
  return requirements
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

class PythonRuntime implements LocalRuntime {
  readonly ready: Promise<void>;
  readonly #runner: PythonRunner;

  constructor(callbacks: RuntimeCallbacks) {
    this.#runner = new PythonRunner(callbacks);
    this.ready = this.#runner.ready;
  }

  async configure(files: RuntimeFiles): Promise<void> {
    await this.#runner.loadModules(requiredModules(files));
  }

  async runFile(fileSystem: FileSystem, path: string): Promise<void> {
    await this.#runner.runPython(fileSystem, `run_script(${JSON.stringify(`.${path}`)})`);
  }

  async runLine(fileSystem: FileSystem, line: string, _currentPath: string): Promise<void> {
    await this.#runner.runPython(fileSystem, `await run_console_line(${JSON.stringify(line)})`);
  }

  async runTests(fileSystem: FileSystem): Promise<void> {
    await this.#runner.runPython(fileSystem, unittestDiscovery);
  }

  async writeStdin(input: string): Promise<void> {
    await this.#runner.writeStdin(input);
  }

  async stop(): Promise<void> {
    await this.#runner.stopPython();
  }

  destroy(): void {
    this.#runner.destroy();
  }
}

function createRuntime(callbacks: RuntimeCallbacks): LocalRuntime {
  return new PythonRuntime(callbacks);
}

export { createRuntime, requiredModules, unittestDiscovery };
