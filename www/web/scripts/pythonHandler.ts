import type { RuntimeCallbacks, RuntimeFiles } from "./localRuntime.js";
import {
  isWorkerEvent,
  type InitializeWorkerRequest,
  type LoadPythonModulesRequest,
  type RunWorkerRequest,
} from "./workerProtocol.js";
import { createWorkerInput, type WorkerInput } from "./workerInput.js";
import { versionedAssetUrl } from "./version.js";

interface ModuleLoadResolver {
  reject(error: Error): void;
  resolve(): void;
}

type PythonExecutionState =
  | { readonly finish: () => void; readonly kind: "running" }
  | { readonly kind: "idle" };

class PythonWorker {
  readonly destroyed: Promise<void>;
  readonly ready: Promise<void>;

  readonly #callbacks: RuntimeCallbacks;
  #execution: PythonExecutionState = { kind: "idle" };
  readonly #input: WorkerInput;
  #isDestroyed = false;
  #moduleRequest = 0;
  readonly #moduleResolvers = new Map<number, ModuleLoadResolver>();
  #rejectLoaded: (error: Error) => void = () => {};
  #resolveDestroyed: () => void = () => {};
  #resolveLoaded: () => void = () => {};
  readonly #worker: Worker;

  get runningPython(): boolean {
    return this.#execution.kind === "running";
  }

  constructor(callbacks: RuntimeCallbacks) {
    this.#callbacks = callbacks;
    this.#input = createWorkerInput();
    this.#worker = new Worker(versionedAssetUrl(
      new URL(/* webpackIgnore: true */ "./pythonWorker.js", import.meta.url),
    ));
    this.destroyed = new Promise((resolve) => {
      this.#resolveDestroyed = resolve;
    });
    this.ready = new Promise((resolve, reject) => {
      this.#resolveLoaded = resolve;
      this.#rejectLoaded = reject;
      this.#worker.addEventListener("error", (event) => reject(event), { once: true });
    });
    this.#worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      this.#handleMessage(event.data);
    });
    const request: InitializeWorkerRequest = {
      inputUrl: this.#input.readUrl,
      type: "initialize",
    };
    this.#worker.postMessage(request);
  }

  #handleMessage(data: unknown): void {
    if (!isWorkerEvent(data)) {
      console.error("CodeGrinder Python worker sent an invalid message", data);
      return;
    }
    switch (data.type) {
      case "displayImage":
        this.#callbacks.displayImage(data.pngBase64);
        return;
      case "failed":
        this.#rejectLoaded(new Error(data.message));
        return;
      case "finished":
        if (this.#execution.kind === "running") {
          this.#execution.finish();
          this.#execution = { kind: "idle" };
        }
        return;
      case "loading":
        console.info(`CodeGrinder Python worker: ${data.status}`);
        this.#callbacks.loadingStatus(data.status);
        return;
      case "moduleLoadFailed":
        this.#moduleResolvers.get(data.requestId)?.reject(new Error(data.message));
        this.#moduleResolvers.delete(data.requestId);
        return;
      case "modulesLoaded":
        this.#moduleResolvers.get(data.requestId)?.resolve();
        this.#moduleResolvers.delete(data.requestId);
        return;
      case "output":
        this.#callbacks[data.stream](data.value);
        return;
      case "ready":
        this.#resolveLoaded();
        return;
    }
  }

  destroy(): void {
    if (this.#isDestroyed) {
      return;
    }
    this.#isDestroyed = true;
    this.#worker.terminate();
    this.#input.close();
    this.#resolveDestroyed();
    for (const { reject } of this.#moduleResolvers.values()) {
      reject(new Error("Python runtime stopped while loading modules"));
    }
    this.#moduleResolvers.clear();
  }

  async runPython(files: RuntimeFiles, code: string): Promise<void> {
    await this.ready;
    if (this.runningPython) {
      throw new Error("Python is already running on this worker");
    }
    const execution = new Promise<void>((resolve) => {
      this.#execution = { finish: resolve, kind: "running" };
    });
    const request: RunWorkerRequest = { code, files, type: "run" };
    this.#worker.postMessage(request);
    await Promise.race([execution, this.destroyed]);
    this.#execution = { kind: "idle" };
  }

  async loadModules(modules: readonly string[]): Promise<void> {
    await this.ready;
    if (modules.length === 0) {
      return;
    }
    const requestId = ++this.#moduleRequest;
    const loaded = new Promise<void>((resolve, reject) => {
      this.#moduleResolvers.set(requestId, { reject, resolve });
    });
    const request: LoadPythonModulesRequest = { modules, requestId, type: "loadModules" };
    this.#worker.postMessage(request);
    await Promise.race([loaded, this.destroyed]);
  }

  async writeStdin(value: string): Promise<void> {
    await this.ready;
    await Promise.race([this.#input.write(value), this.destroyed]);
  }
}

class PythonRunner {
  ready: Promise<void>;

  readonly #callbacks: RuntimeCallbacks;
  #moduleLoad: Promise<void> = Promise.resolve();
  readonly #modules = new Set<string>();
  #worker: PythonWorker;

  constructor(callbacks: RuntimeCallbacks) {
    this.#callbacks = callbacks;
    this.#worker = this.#createWorker();
    this.ready = this.#worker.ready;
  }

  #createWorker(): PythonWorker {
    return new PythonWorker(this.#callbacks);
  }

  async stopPython(): Promise<void> {
    this.#worker.destroy();
    this.#worker = this.#createWorker();
    this.ready = this.#worker.ready;
    await this.#worker.loadModules([...this.#modules]);
  }

  destroy(): void {
    this.#worker.destroy();
  }

  async runPython(files: RuntimeFiles, code: string): Promise<void> {
    if (this.#worker.runningPython) {
      await this.stopPython();
    }
    await this.#worker.runPython(files, code);
  }

  async loadModules(modules: readonly string[]): Promise<void> {
    for (const moduleName of modules) {
      this.#modules.add(moduleName);
    }
    this.#moduleLoad = this.#moduleLoad.then(() => this.#worker.loadModules([...this.#modules]));
    await this.#moduleLoad;
  }

  async writeStdin(value: string): Promise<void> {
    await this.#worker.writeStdin(value);
  }
}

export { PythonRunner };
