const runtimeLoaders = Object.freeze({
  javascript: () => import("./jsRuntime.js"),
  python: () => import("./pythonRuntime.js"),
});

const runtimeNames = new Set(Object.keys(runtimeLoaders));
const runtimeReadyTimeoutMilliseconds = 90000;

function withTimeout(promise, timeoutMilliseconds, description) {
  let timeout;
  const timedOut = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Timed out ${description} after ${timeoutMilliseconds / 1000} seconds`));
    }, timeoutMilliseconds);
  });
  return Promise.race([promise, timedOut]).finally(() => clearTimeout(timeout));
}

function parseLocalRuntimeConfig(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Local runtime configuration must be a JSON object");
  }

  const problemTypes = new Map();
  for (const [problemType, runtimeName] of Object.entries(value)) {
    if (problemType === "" || problemType.trim() !== problemType) {
      throw new Error(`Invalid problem type in local runtime configuration: ${JSON.stringify(problemType)}`);
    }
    if (typeof runtimeName !== "string" || !runtimeNames.has(runtimeName)) {
      throw new Error(
        `Invalid local runtime for ${JSON.stringify(problemType)}: ${JSON.stringify(runtimeName)}`,
      );
    }
    problemTypes.set(problemType, runtimeName);
  }
  return problemTypes;
}

async function loadLocalRuntimeConfig(url, fetchImplementation = globalThis.fetch) {
  const response = await fetchImplementation(url);
  if (!response.ok) {
    throw new Error(`Could not load local runtime configuration: HTTP ${response.status}`);
  }
  return parseLocalRuntimeConfig(await response.json());
}

class LocalRuntimeController {
  #callbacks;
  #loaders;
  #problemTypes;
  #runtime = null;
  #runtimeName = null;
  #selection = 0;

  constructor(problemTypes, callbacks, loaders = runtimeLoaders) {
    this.#problemTypes = problemTypes;
    this.#callbacks = callbacks;
    this.#loaders = loaders;
  }

  get runtimeName() {
    return this.#runtimeName;
  }

  get supportsLocalTests() {
    return typeof this.#runtime?.runTests === "function";
  }

  async select(problemType) {
    const runtimeName = this.#problemTypes.get(problemType) ?? null;
    console.info(`CodeGrinder: selected problem type ${problemType}; runtime is ${runtimeName ?? "unavailable"}`);
    if (runtimeName === this.#runtimeName && this.#runtime !== null) {
      return runtimeName;
    }

    const selection = ++this.#selection;
    this.#runtime?.destroy();
    this.#runtime = null;
    this.#runtimeName = runtimeName;
    if (runtimeName === null) {
      return null;
    }

    const loadRuntime = this.#loaders[runtimeName];
    if (!loadRuntime) {
      throw new Error(`No local runtime loader exists for ${JSON.stringify(runtimeName)}`);
    }
    console.info(`CodeGrinder: loading the ${runtimeName} runtime module`);
    const runtimeModule = await withTimeout(
      loadRuntime(),
      15000,
      `loading the ${runtimeName} runtime module`,
    );
    const runtime = runtimeModule.createRuntime(this.#callbacks);
    if (selection !== this.#selection) {
      runtime.destroy();
      return this.#runtimeName;
    }
    this.#runtime = runtime;
    try {
      await withTimeout(
        runtime.ready,
        runtimeReadyTimeoutMilliseconds,
        `starting the ${runtimeName} runtime worker`,
      );
    } catch (error) {
      if (selection === this.#selection) {
        runtime.destroy();
        this.#runtime = null;
        this.#runtimeName = null;
      }
      throw error;
    }
    if (selection !== this.#selection) {
      runtime.destroy();
      return this.#runtimeName;
    }
    console.info(`CodeGrinder: ${runtimeName} runtime worker is ready`);
    return runtimeName;
  }

  async configure(files) {
    if (this.#runtime !== null) {
      await this.#runtime.configure(files);
    }
  }

  async runFile(fileSystem, path) {
    if (this.#runtime === null) {
      throw new Error("This problem type has no local runtime");
    }
    await this.#runtime.runFile(fileSystem, path);
  }

  async runLine(fileSystem, line, currentPath) {
    if (this.#runtime === null) {
      throw new Error("This problem type has no local runtime");
    }
    await this.#runtime.runLine(fileSystem, line, currentPath);
  }

  async runTests(fileSystem) {
    if (!this.supportsLocalTests) {
      throw new Error("This problem type has no local test runner");
    }
    await this.#runtime.runTests(fileSystem);
  }

  async writeStdin(input) {
    if (this.#runtime !== null) {
      await this.#runtime.writeStdin(input);
    }
  }

  async stop() {
    if (this.#runtime !== null) {
      await this.#runtime.stop();
    }
  }

  destroy() {
    ++this.#selection;
    this.#runtime?.destroy();
    this.#runtime = null;
    this.#runtimeName = null;
  }
}

export {
  LocalRuntimeController,
  loadLocalRuntimeConfig,
  parseLocalRuntimeConfig,
  withTimeout,
};
