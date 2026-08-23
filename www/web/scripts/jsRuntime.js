import { JavaScriptRunner } from "./jsHandler.js";

class JavaScriptRuntime {
  #runner;

  constructor({ loadingStatus, stderr, stdout }) {
    this.#runner = new JavaScriptRunner(stdout, stderr, loadingStatus);
    this.ready = this.#runner.ready;
  }

  async configure() {
  }

  async runFile(fileSystem, path) {
    await this.#runner.runJavaScript(fileSystem, `run_script(${JSON.stringify(`.${path}`)})`);
  }

  async runLine(fileSystem, line) {
    await this.#runner.runJavaScript(fileSystem, line);
  }

  async writeStdin(input) {
    await this.#runner.writeStdin(input);
  }

  async stop() {
    this.#runner.stopJavaScript();
    await this.#runner.ready;
  }

  destroy() {
    this.#runner.destroy();
  }
}

function createRuntime(callbacks) {
  return new JavaScriptRuntime(callbacks);
}

export { createRuntime };
