import type { RuntimeCallbacks, RuntimeFiles } from "./localRuntime.js";
import {
  isWorkerEvent,
  type InitializeWorkerRequest,
  type RunWorkerRequest,
} from "./workerProtocol.js";
import { createWorkerInput, type WorkerInput } from "./workerInput.js";
import { versionedAssetUrl } from "./version.js";

type JavaScriptCallbacks = Pick<RuntimeCallbacks, "loadingStatus" | "stderr" | "stdout">;
type TextCallback = (value: string) => void;
type JavaScriptExecutionState =
  | { readonly finish: () => void; readonly kind: "running" }
  | { readonly kind: "idle" };

class JavaScriptWorker {
  readonly destroyed: Promise<void>;
  readonly ready: Promise<void>;

  readonly #callbacks: JavaScriptCallbacks;
  #execution: JavaScriptExecutionState = { kind: "idle" };
  readonly #input: WorkerInput;
  #isDestroyed = false;
  #rejectLoaded: (error: Error) => void = () => {};
  #resolveDestroyed: () => void = () => {};
  #resolveLoaded: () => void = () => {};
  readonly #worker: Worker;

  get runningJavaScript(): boolean {
    return this.#execution.kind === "running";
  }

  constructor(callbacks: JavaScriptCallbacks) {
    this.#callbacks = callbacks;
    this.#input = createWorkerInput();
    this.#worker = new Worker(versionedAssetUrl(
      new URL(/* webpackIgnore: true */ "./jsWorker.js", import.meta.url),
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
      console.error("CodeGrinder JavaScript worker sent an invalid message", data);
      return;
    }
    switch (data.type) {
      case "finished":
        if (this.#execution.kind === "running") {
          this.#execution.finish();
          this.#execution = { kind: "idle" };
        }
        return;
      case "failed":
        this.#rejectLoaded(new Error(data.message));
        return;
      case "loading":
        console.info(`CodeGrinder JavaScript worker: ${data.status}`);
        this.#callbacks.loadingStatus(data.status);
        return;
      case "output":
        this.#callbacks[data.stream](data.value);
        return;
      case "ready":
        this.#resolveLoaded();
        return;
      case "displayImage":
      case "moduleLoadFailed":
      case "modulesLoaded":
        console.error(`CodeGrinder JavaScript worker sent unexpected ${data.type} message`);
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
  }

  async runJavaScript(files: RuntimeFiles, code: string): Promise<void> {
    await this.ready;
    if (this.runningJavaScript) {
      throw new Error("JavaScript is already running on this worker");
    }
    const execution = new Promise<void>((resolve) => {
      this.#execution = { finish: resolve, kind: "running" };
    });
    const request: RunWorkerRequest = { code, files, type: "run" };
    this.#worker.postMessage(request);
    await Promise.race([execution, this.destroyed]);
    this.#execution = { kind: "idle" };
  }

  async writeStdin(value: string): Promise<void> {
    await this.ready;
    await Promise.race([this.#input.write(value), this.destroyed]);
  }
}

class JavaScriptRunner {
  ready: Promise<void>;

  readonly #callbacks: JavaScriptCallbacks;
  #worker: JavaScriptWorker;

  constructor(callbacks: JavaScriptCallbacks) {
    this.#callbacks = callbacks;
    this.#worker = new JavaScriptWorker(this.#callbacks);
    this.ready = this.#worker.ready;
  }

  stopJavaScript(): void {
    this.#worker.destroy();
    this.#worker = new JavaScriptWorker(this.#callbacks);
    this.ready = this.#worker.ready;
  }

  destroy(): void {
    this.#worker.destroy();
  }

  async runJavaScript(files: RuntimeFiles, code: string): Promise<void> {
    if (this.#worker.runningJavaScript) {
      this.stopJavaScript();
    }
    await this.#worker.runJavaScript(files, code);
  }

  setStdoutCallback(callback: TextCallback): void {
    this.#callbacks.stdout = callback;
  }

  setStderrCallback(callback: TextCallback): void {
    this.#callbacks.stderr = callback;
  }

  async writeStdin(value: string): Promise<void> {
    await this.#worker.writeStdin(value);
  }
}

export { JavaScriptRunner };
