import type {
  LocalRuntime,
  RuntimeCallbacks,
  RuntimeFiles,
} from "./localRuntime.js";
import { PythonRunner } from "./pythonHandler.js";
import { isTurtleFile, TurtleRunner } from "./turtleRuntime.js";

const unittestDiscovery = `
import unittest

invalidate_import_cache()
loader = unittest.TestLoader()
suite = loader.discover("./tests")
runner = unittest.TextTestRunner()
runner.run(suite)
`;

const textDecoder = new TextDecoder("utf-8", { fatal: true });

function requiredModules(files: RuntimeFiles): string[] {
  const modules = new Set<string>();
  for (const [path, content] of Object.entries(files)) {
    if (path.split("/").at(-1) !== "requirements.txt") {
      continue;
    }
    for (const line of textDecoder.decode(content).split("\n")) {
      const moduleName = line.trim();
      if (moduleName !== "" && !moduleName.startsWith("#")) {
        modules.add(moduleName);
      }
    }
  }
  if (Object.keys(files).some((path) => path.endsWith(".sql"))) {
    modules.add("pandas");
  }
  return [...modules];
}

function pythonFileCommand(path: string): string {
  const workspacePath = `.${path}`;
  return path.endsWith(".sql")
    ? `run_sql_file(${JSON.stringify(workspacePath)})`
    : `run_script(${JSON.stringify(workspacePath)})`;
}

function pythonLineCommand(line: string, currentPath: string): string {
  return currentPath.endsWith(".sql")
    ? `run_sql_line(${JSON.stringify(line)})`
    : `await run_console_line(${JSON.stringify(line)})`;
}

class PythonRuntime implements LocalRuntime {
  readonly ready: Promise<void>;
  readonly #runner: PythonRunner;
  readonly #turtleRunner: TurtleRunner;
  #usingTurtle = false;
  #configuredFiles: RuntimeFiles = {};

  constructor(callbacks: RuntimeCallbacks) {
    this.#runner = new PythonRunner(callbacks);
    this.#turtleRunner = new TurtleRunner(callbacks);
    this.ready = this.#runner.ready;
  }

  async configure(files: RuntimeFiles): Promise<void> {
    this.#configuredFiles = files;
    await this.#runner.loadModules(requiredModules(files));
    await this.#runSetup();
  }

  async #runSetup(): Promise<void> {
    if (this.#configuredFiles["bin/setup.py"] === undefined) {
      return;
    }
    await this.#runner.runPython(this.#configuredFiles, "run_script('./bin/setup.py')");
  }

  async runFile(files: RuntimeFiles, path: string): Promise<void> {
    if (isTurtleFile(files, path)) {
      this.#usingTurtle = true;
      try {
        await this.#turtleRunner.run(files, path);
      } finally {
        this.#usingTurtle = false;
      }
      return;
    }
    await this.#runner.runPython(files, pythonFileCommand(path));
  }

  async runLine(files: RuntimeFiles, line: string, currentPath: string): Promise<void> {
    await this.#runner.runPython(files, pythonLineCommand(line, currentPath));
  }

  async runTests(files: RuntimeFiles): Promise<void> {
    await this.#runner.runPython(files, unittestDiscovery);
  }

  async writeStdin(input: string): Promise<void> {
    if (this.#usingTurtle) {
      await this.#turtleRunner.writeStdin(input);
      return;
    }
    await this.#runner.writeStdin(input);
  }

  async stop(): Promise<void> {
    if (this.#usingTurtle) {
      await this.#turtleRunner.stop();
      return;
    }
    await this.#runner.stopPython();
    await this.#runSetup();
  }

  destroy(): void {
    this.#turtleRunner.destroy();
    this.#runner.destroy();
  }
}

function createRuntime(callbacks: RuntimeCallbacks): LocalRuntime {
  return new PythonRuntime(callbacks);
}

export {
  createRuntime,
  pythonFileCommand,
  pythonLineCommand,
  requiredModules,
  unittestDiscovery,
};
