import type { FileSystem } from "./directoryTree.js";
import { versionedAssetUrl } from "./version.js";

type RuntimeName = "javascript" | "python";
type RuntimeSelectionPolicy = "replace" | "reuse";
type RuntimeFiles = Readonly<Record<string, string>>;

interface RuntimeCallbacks {
  displayImage(image: string): void;
  loadingStatus(status: string): void;
  stderr(value: string): void;
  stdout(value: string): void;
}

interface LocalRuntime {
  readonly ready: Promise<void>;
  configure(files: RuntimeFiles): Promise<void>;
  runFile(fileSystem: FileSystem, path: string): Promise<void>;
  runLine(fileSystem: FileSystem, line: string, currentPath: string): Promise<void>;
  runTests?(fileSystem: FileSystem): Promise<void>;
  writeStdin(input: string): Promise<void>;
  stop(): Promise<void>;
  destroy(): void;
}

interface RuntimeModule {
  createRuntime(callbacks: RuntimeCallbacks): LocalRuntime;
}

type RuntimeLoader = () => Promise<RuntimeModule>;
type RuntimeLoaders = Readonly<Record<RuntimeName, RuntimeLoader>>;
type ProblemTypeRuntimeMap = ReadonlyMap<string, RuntimeName>;

function isRuntimeModule(value: unknown): value is RuntimeModule {
  return typeof value === "object"
    && value !== null
    && "createRuntime" in value
    && typeof value.createRuntime === "function";
}

async function loadRuntimeModule(url: URL): Promise<RuntimeModule> {
  const module: unknown = await import(
    /* webpackIgnore: true */ versionedAssetUrl(url).href
  );
  if (!isRuntimeModule(module)) {
    throw new Error(`Local runtime module ${JSON.stringify(url.href)} has an invalid interface`);
  }
  return module;
}

const runtimeLoaders: RuntimeLoaders = Object.freeze({
  javascript: () => loadRuntimeModule(
    new URL(/* webpackIgnore: true */ "./jsRuntime.js", import.meta.url),
  ),
  python: () => loadRuntimeModule(
    new URL(/* webpackIgnore: true */ "./pythonRuntime.js", import.meta.url),
  ),
});

const runtimeNames: ReadonlySet<string> = new Set(Object.keys(runtimeLoaders));
const runtimeReadyTimeoutMilliseconds = 90000;

function withTimeout<T>(
  promise: PromiseLike<T>,
  timeoutMilliseconds: number,
  description: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Timed out ${description} after ${timeoutMilliseconds / 1000} seconds`));
    }, timeoutMilliseconds);
  });
  return Promise.race([promise, timedOut]).finally(() => {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  });
}

function isRuntimeName(value: unknown): value is RuntimeName {
  return typeof value === "string" && runtimeNames.has(value);
}

function parseLocalRuntimeConfig(value: unknown): Map<string, RuntimeName> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Local runtime configuration must be a JSON object");
  }

  const problemTypes = new Map<string, RuntimeName>();
  for (const [problemType, runtimeName] of Object.entries(value)) {
    if (problemType === "" || problemType.trim() !== problemType) {
      throw new Error(`Invalid problem type in local runtime configuration: ${JSON.stringify(problemType)}`);
    }
    if (!isRuntimeName(runtimeName)) {
      throw new Error(
        `Invalid local runtime for ${JSON.stringify(problemType)}: ${JSON.stringify(runtimeName)}`,
      );
    }
    problemTypes.set(problemType, runtimeName);
  }
  return problemTypes;
}

async function loadLocalRuntimeConfig(
  url: string | URL,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): Promise<Map<string, RuntimeName>> {
  const response = await fetchImplementation(url);
  if (!response.ok) {
    throw new Error(`Could not load local runtime configuration: HTTP ${response.status}`);
  }
  return parseLocalRuntimeConfig(await response.json());
}

class LocalRuntimeController {
  readonly #callbacks: RuntimeCallbacks;
  readonly #loaders: RuntimeLoaders;
  readonly #problemTypes: ProblemTypeRuntimeMap;
  #runtime: LocalRuntime | null = null;
  #runtimeName: RuntimeName | null = null;
  #selection = 0;

  constructor(
    problemTypes: ProblemTypeRuntimeMap,
    callbacks: RuntimeCallbacks,
    loaders: RuntimeLoaders = runtimeLoaders,
  ) {
    this.#problemTypes = problemTypes;
    this.#callbacks = callbacks;
    this.#loaders = loaders;
  }

  get runtimeName(): RuntimeName | null {
    return this.#runtimeName;
  }

  get supportsLocalTests(): boolean {
    return typeof this.#runtime?.runTests === "function";
  }

  async select(
    problemType: string,
    selectionPolicy: RuntimeSelectionPolicy = "reuse",
  ): Promise<RuntimeName | null> {
    const runtimeName = this.#problemTypes.get(problemType) ?? null;
    console.info(`CodeGrinder: selected problem type ${problemType}; runtime is ${runtimeName ?? "unavailable"}`);
    if (selectionPolicy === "reuse" && runtimeName === this.#runtimeName && this.#runtime !== null) {
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
    } catch (error: unknown) {
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

  async configure(files: RuntimeFiles): Promise<void> {
    if (this.#runtime !== null) {
      await this.#runtime.configure(files);
    }
  }

  async runFile(fileSystem: FileSystem, path: string): Promise<void> {
    if (this.#runtime === null) {
      throw new Error("This problem type has no local runtime");
    }
    await this.#runtime.runFile(fileSystem, path);
  }

  async runLine(fileSystem: FileSystem, line: string, currentPath: string): Promise<void> {
    if (this.#runtime === null) {
      throw new Error("This problem type has no local runtime");
    }
    await this.#runtime.runLine(fileSystem, line, currentPath);
  }

  async runTests(fileSystem: FileSystem): Promise<void> {
    const runtime = this.#runtime;
    if (runtime?.runTests === undefined) {
      throw new Error("This problem type has no local test runner");
    }
    await runtime.runTests(fileSystem);
  }

  async writeStdin(input: string): Promise<void> {
    if (this.#runtime !== null) {
      await this.#runtime.writeStdin(input);
    }
  }

  async stop(): Promise<void> {
    if (this.#runtime !== null) {
      await this.#runtime.stop();
    }
  }

  destroy(): void {
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

export type {
  LocalRuntime,
  ProblemTypeRuntimeMap,
  RuntimeCallbacks,
  RuntimeFiles,
  RuntimeLoader,
  RuntimeLoaders,
  RuntimeModule,
  RuntimeName,
  RuntimeSelectionPolicy,
};
