import type { RuntimeCallbacks, RuntimeFiles } from "./localRuntime.js";

interface SkulptConfiguration {
  execLimit: number;
  inputfun(prompt: string): Promise<string>;
  inputfunTakesPrompt: boolean;
  killableFor: boolean;
  killableWhile: boolean;
  output(value: string): void;
  read(path: string): string;
  yieldLimit: number;
}

interface SkulptApi {
  builtinFiles?: { files: Record<string, string> };
  configure(configuration: SkulptConfiguration): void;
  execLimit: number;
  execStart: number;
  importMainWithBody(
    name: string,
    dumpJavaScript: boolean,
    source: string,
    canSuspend: boolean,
  ): unknown;
  misceval: {
    asyncToPromise(operation: () => unknown): Promise<unknown>;
  };
  TurtleGraphics?: { target?: string };
}

interface SkulptAsset {
  integrity: string;
  url: string;
}

type SkulptLoaderState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading"; readonly promise: Promise<SkulptApi> }
  | { readonly kind: "ready"; readonly skulpt: SkulptApi };

type TurtleExecutionState =
  | { readonly kind: "idle" }
  | {
    readonly kind: "running";
    readonly promise: Promise<unknown>;
    readonly skulpt: SkulptApi;
    stopRequested: boolean;
  };

const skulptAssets: readonly SkulptAsset[] = [
  {
    integrity: "sha384-QD1Oj+CdJn44Uaeqit7deDXw7ye/8NEsg8jl7uAr1QtLbVVI9ZnW0om+VK5D0n6N",
    url: "https://cdn.jsdelivr.net/gh/6oranges/codegrinder-python-web@125410f7ac22fd3fdceba179d4bea7de04e52a36/skulpt/skulpt.min.js",
  },
  {
    integrity: "sha384-grGZzOAJFUJ8W0gRh+buNz1o4yRejjIxGJOW6LdCVhA2H5yzYZ6t4yob3qSBCPx4",
    url: "https://cdn.jsdelivr.net/gh/6oranges/codegrinder-python-web@125410f7ac22fd3fdceba179d4bea7de04e52a36/skulpt/skulpt-stdlib.js",
  },
];

const textDecoder = new TextDecoder("utf-8", { fatal: true });
let loaderState: SkulptLoaderState = { kind: "idle" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSkulptApi(value: unknown): value is SkulptApi {
  return isRecord(value)
    && typeof value.configure === "function"
    && typeof value.importMainWithBody === "function"
    && isRecord(value.misceval)
    && typeof value.misceval.asyncToPromise === "function";
}

function loadedSkulpt(): SkulptApi {
  if (!isSkulptApi(globalThis.Sk)) {
    throw new Error("Skulpt loaded without its expected browser interface");
  }
  return globalThis.Sk;
}

function loadScript(asset: SkulptAsset): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.crossOrigin = "anonymous";
    script.integrity = asset.integrity;
    script.src = asset.url;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(
      new Error(`Could not load the Turtle runtime asset ${asset.url}`),
    ), { once: true });
    document.head.appendChild(script);
  });
}

async function loadSkulptAssets(): Promise<SkulptApi> {
  for (const asset of skulptAssets) {
    await loadScript(asset);
  }
  return loadedSkulpt();
}

async function loadSkulpt(): Promise<SkulptApi> {
  if (loaderState.kind === "ready") {
    return loaderState.skulpt;
  }
  if (loaderState.kind === "loading") {
    return loaderState.promise;
  }
  const promise = loadSkulptAssets();
  loaderState = { kind: "loading", promise };
  try {
    const skulpt = await promise;
    loaderState = { kind: "ready", skulpt };
    return skulpt;
  } catch (error: unknown) {
    loaderState = { kind: "idle" };
    throw error;
  }
}

function isTurtleFile(files: RuntimeFiles, path: string): boolean {
  const content = files[path.replace(/^\//, "")];
  return content !== undefined && textDecoder.decode(content).includes("import turtle");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

class TurtleRunner {
  readonly #callbacks: Pick<RuntimeCallbacks, "stderr" | "stdout">;
  #execution: TurtleExecutionState = { kind: "idle" };
  #operation = 0;
  readonly #pendingInput: Array<(value: string) => void> = [];
  readonly #queuedInput: string[] = [];

  constructor(callbacks: Pick<RuntimeCallbacks, "stderr" | "stdout">) {
    this.#callbacks = callbacks;
  }

  #readBuiltin(skulpt: SkulptApi, path: string): string {
    const content = skulpt.builtinFiles?.files[path];
    if (content === undefined) {
      throw new Error(`Skulpt library file not found: ${path}`);
    }
    return content;
  }

  #readInput(prompt: string): Promise<string> {
    if (prompt !== "") {
      this.#callbacks.stdout(prompt);
    }
    const queued = this.#queuedInput.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve) => {
      this.#pendingInput.push(resolve);
    });
  }

  #closeInput(): void {
    for (const resolve of this.#pendingInput.splice(0)) {
      resolve("");
    }
    this.#queuedInput.splice(0);
  }

  async run(files: RuntimeFiles, path: string): Promise<void> {
    const operation = ++this.#operation;
    const content = files[path.replace(/^\//, "")];
    if (content === undefined) {
      throw new Error(`Turtle source file not found: ${path}`);
    }
    const source = textDecoder.decode(content);
    const skulpt = await loadSkulpt();
    if (operation !== this.#operation) {
      return;
    }
    document.getElementById("turtle")?.replaceChildren();
    const graphics = skulpt.TurtleGraphics ?? {};
    graphics.target = "turtle";
    skulpt.TurtleGraphics = graphics;
    skulpt.configure({
      execLimit: Number.POSITIVE_INFINITY,
      inputfun: (prompt) => this.#readInput(prompt),
      inputfunTakesPrompt: true,
      killableFor: true,
      killableWhile: true,
      output: (value) => this.#callbacks.stdout(value),
      read: (libraryPath) => this.#readBuiltin(skulpt, libraryPath),
      yieldLimit: 50,
    });
    skulpt.execStart = Date.now();
    const promise = skulpt.misceval.asyncToPromise(
      () => skulpt.importMainWithBody("<stdin>", false, source, true),
    );
    const execution: TurtleExecutionState = {
      kind: "running",
      promise,
      skulpt,
      stopRequested: false,
    };
    this.#execution = execution;
    try {
      await promise;
    } catch (error: unknown) {
      if (!execution.stopRequested) {
        this.#callbacks.stderr(`${errorMessage(error)}\n`);
      }
    } finally {
      if (this.#execution === execution) {
        this.#execution = { kind: "idle" };
      }
      this.#closeInput();
      skulpt.execLimit = Number.POSITIVE_INFINITY;
    }
  }

  async writeStdin(value: string): Promise<void> {
    const input = value.replace(/\r?\n$/, "");
    const pending = this.#pendingInput.shift();
    if (pending === undefined) {
      this.#queuedInput.push(input);
      return;
    }
    pending(input);
  }

  async stop(): Promise<void> {
    ++this.#operation;
    if (this.#execution.kind === "idle") {
      this.#closeInput();
      return;
    }
    const execution = this.#execution;
    execution.stopRequested = true;
    execution.skulpt.execLimit = 0;
    this.#closeInput();
    await execution.promise.catch(() => {});
  }

  destroy(): void {
    void this.stop();
  }
}

export { isTurtleFile, TurtleRunner };
