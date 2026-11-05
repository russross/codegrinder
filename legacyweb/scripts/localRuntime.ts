import { versionedAssetUrl } from "./version.js";

type RuntimeName = "javascript" | "python";
type RuntimeSelectionPolicy = "replace" | "reuse";
type RuntimeFiles = Readonly<Record<string, Uint8Array>>;
type RuntimeSelection =
  | { readonly kind: "ready"; readonly runtimeName: RuntimeName }
  | { readonly kind: "unavailable" };

interface RuntimeCallbacks {
  displayImage(image: string): void;
  loadingStatus(status: string): void;
  stderr(value: string): void;
  stdout(value: string): void;
}

interface LocalRuntime {
  readonly ready: Promise<void>;
  configure(files: RuntimeFiles): Promise<void>;
  runFile(files: RuntimeFiles, path: string): Promise<void>;
  runLine(files: RuntimeFiles, line: string, currentPath: string): Promise<void>;
  runTests?(files: RuntimeFiles): Promise<void>;
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
type RuntimeState =
  | { readonly kind: "active"; readonly runtime: LocalRuntime; readonly runtimeName: RuntimeName }
  | { readonly kind: "idle" };

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
  #state: RuntimeState = { kind: "idle" };
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

  get supportsLocalTests(): boolean {
    return this.#state.kind === "active" && typeof this.#state.runtime.runTests === "function";
  }

  async select(
    problemType: string,
    selectionPolicy: RuntimeSelectionPolicy = "reuse",
  ): Promise<RuntimeSelection> {
    const runtimeName = this.#problemTypes.get(problemType);
    console.info(`CodeGrinder: selected problem type ${problemType}; runtime is ${runtimeName ?? "unavailable"}`);
    if (selectionPolicy === "reuse"
        && this.#state.kind === "active"
        && runtimeName === this.#state.runtimeName) {
      return { kind: "ready", runtimeName };
    }

    const selection = ++this.#selection;
    if (this.#state.kind === "active") {
      this.#state.runtime.destroy();
    }
    this.#state = { kind: "idle" };
    if (runtimeName === undefined) {
      return { kind: "unavailable" };
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
      return { kind: "unavailable" };
    }
    try {
      await withTimeout(
        runtime.ready,
        runtimeReadyTimeoutMilliseconds,
        `starting the ${runtimeName} runtime worker`,
      );
    } catch (error: unknown) {
      if (selection === this.#selection) {
        runtime.destroy();
        this.#state = { kind: "idle" };
      }
      throw error;
    }
    if (selection !== this.#selection) {
      runtime.destroy();
      return { kind: "unavailable" };
    }
    this.#state = { kind: "active", runtime, runtimeName };
    console.info(`CodeGrinder: ${runtimeName} runtime worker is ready`);
    return { kind: "ready", runtimeName };
  }

  async configure(files: RuntimeFiles): Promise<void> {
    if (this.#state.kind !== "active") {
      throw new Error("This problem type has no local runtime");
    }
    await this.#state.runtime.configure(files);
  }

  async runFile(files: RuntimeFiles, path: string): Promise<void> {
    if (this.#state.kind !== "active") {
      throw new Error("This problem type has no local runtime");
    }
    await this.#state.runtime.runFile(files, path);
  }

  async runLine(files: RuntimeFiles, line: string, currentPath: string): Promise<void> {
    if (this.#state.kind !== "active") {
      throw new Error("This problem type has no local runtime");
    }
    await this.#state.runtime.runLine(files, line, currentPath);
  }

  async runTests(files: RuntimeFiles): Promise<void> {
    if (this.#state.kind !== "active" || this.#state.runtime.runTests === undefined) {
      throw new Error("This problem type has no local test runner");
    }
    await this.#state.runtime.runTests(files);
  }

  async writeStdin(input: string): Promise<void> {
    if (this.#state.kind === "active") {
      await this.#state.runtime.writeStdin(input);
    }
  }

  async stop(): Promise<void> {
    if (this.#state.kind === "active") {
      await this.#state.runtime.stop();
    }
  }

  destroy(): void {
    ++this.#selection;
    if (this.#state.kind === "active") {
      this.#state.runtime.destroy();
    }
    this.#state = { kind: "idle" };
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
  RuntimeSelection,
};
