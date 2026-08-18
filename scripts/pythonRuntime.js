import { PythonRunner } from "./pythonHandler.js";

const unittestDiscovery = `
import unittest

invalidate_import_cache()
loader = unittest.TestLoader()
suite = loader.discover("./tests")
runner = unittest.TextTestRunner()
runner.run(suite)
`;

function requiredModules(files) {
  const requirements = files["requirements.txt"];
  if (typeof requirements !== "string") {
    return [];
  }
  return requirements
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

class PythonRuntime {
  #runner;

  constructor({ displayImage, stderr, stdout }) {
    this.#runner = new PythonRunner(stdout, stderr, displayImage);
    this.ready = this.#runner.ready;
  }

  async configure(files) {
    await this.#runner.loadModules(requiredModules(files));
  }

  async runFile(fileSystem, path) {
    await this.#runner.runPython(fileSystem, `run_script(${JSON.stringify(`.${path}`)})`);
  }

  async runLine(fileSystem, line) {
    await this.#runner.runPython(fileSystem, line);
  }

  async runTests(fileSystem) {
    await this.#runner.runPython(fileSystem, unittestDiscovery);
  }

  async writeStdin(input) {
    await this.#runner.writeStdin(input);
  }

  async stop() {
    await this.#runner.stopPython();
  }

  destroy() {
    this.#runner.destroy();
  }
}

function createRuntime(callbacks) {
  return new PythonRuntime(callbacks);
}

export { createRuntime, requiredModules, unittestDiscovery };
