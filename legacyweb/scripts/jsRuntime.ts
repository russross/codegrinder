import { JavaScriptRunner } from "./jsHandler.js";
import type {
  LocalRuntime,
  RuntimeCallbacks,
  RuntimeFiles,
} from "./localRuntime.js";

class JavaScriptRuntime implements LocalRuntime {
  readonly ready: Promise<void>;
  readonly #runner: JavaScriptRunner;

  constructor(callbacks: RuntimeCallbacks) {
    this.#runner = new JavaScriptRunner(callbacks);
    this.ready = this.#runner.ready;
  }

  async configure(_files: RuntimeFiles): Promise<void> {}

  async runFile(files: RuntimeFiles, path: string): Promise<void> {
    await this.#runner.runJavaScript(files, `run_script(${JSON.stringify(`.${path}`)})`);
  }

  async runLine(files: RuntimeFiles, line: string, _currentPath: string): Promise<void> {
    await this.#runner.runJavaScript(files, line);
  }

  async writeStdin(input: string): Promise<void> {
    await this.#runner.writeStdin(input);
  }

  async stop(): Promise<void> {
    this.#runner.stopJavaScript();
    await this.#runner.ready;
  }

  destroy(): void {
    this.#runner.destroy();
  }
}

function createRuntime(callbacks: RuntimeCallbacks): LocalRuntime {
  return new JavaScriptRuntime(callbacks);
}

export { createRuntime };
