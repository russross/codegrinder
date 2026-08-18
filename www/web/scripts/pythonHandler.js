class PythonWorker {
  #destroy;
  #loaded;
  #moduleRequest = 0;
  #moduleResolvers = new Map();
  #pythonFinished;
  #stderr = new AtomicQueue();
  #stdin = new AtomicQueue();
  #stdout = new AtomicQueue();
  #toMainThread = new AtomicJSONQueue();
  #worker;

  constructor(stdoutCallback, stderrCallback, displayImageCallback) {
    this.stdoutCallback = stdoutCallback;
    this.stderrCallback = stderrCallback;
    this.displayImageCallback = displayImageCallback;
    this.#worker = new Worker(new URL("./pythonWorker.js", import.meta.url));
    this.runningPython = false;
    this.destroyed = new Promise((resolve) => {
      this.#destroy = resolve;
    });
    this.destroyed.then(() => this.#worker.terminate());
    this.ready = new Promise((resolve, reject) => {
      this.#loaded = resolve;
      this.#worker.addEventListener("error", reject, { once: true });
    });
    this.#worker.addEventListener("message", (event) => this.#handleMessage(event.data));
    this.ready.then(() => {
      this.#registerStream(this.#stdout, (value) => this.stdoutCallback(value));
      this.#registerStream(this.#stderr, (value) => this.stderrCallback(value));
      this.#registerDisplayImages();
    });
  }

  #handleMessage(data) {
    if (data.loaded) {
      data.stdin.identifier = data.stdinId;
      data.stdout.identifier = data.stdoutId;
      data.stderr.identifier = data.stderrId;
      data.toMainThread.identifier = data.toMainThreadId;
      this.#stdin = new AtomicQueue(data.stdin);
      this.#stdout = new AtomicQueue(data.stdout);
      this.#stderr = new AtomicQueue(data.stderr);
      this.#toMainThread = new AtomicJSONQueue(data.toMainThread);
      this.#loaded();
    }
    if (data.finishedPython) {
      this.#pythonFinished?.();
    }
    if (data.modulesLoaded !== undefined) {
      this.#moduleResolvers.get(data.modulesLoaded)?.resolve();
      this.#moduleResolvers.delete(data.modulesLoaded);
    }
    if (data.moduleLoadError !== undefined) {
      this.#moduleResolvers.get(data.moduleLoadError)?.reject(new Error(data.message));
      this.#moduleResolvers.delete(data.moduleLoadError);
    }
  }

  destroy() {
    this.#destroy();
    for (const { reject } of this.#moduleResolvers.values()) {
      reject(new Error("Python runtime stopped while loading modules"));
    }
    this.#moduleResolvers.clear();
  }

  async runPython(fileSystem, code) {
    await this.ready;
    if (this.runningPython) {
      throw new Error("Python is already running on this worker");
    }
    this.runningPython = true;
    const execution = new Promise((resolve) => {
      this.#pythonFinished = resolve;
    });
    this.#worker.postMessage({ fileSystem, run: code });
    await Promise.race([execution, this.destroyed]);
    this.runningPython = false;
  }

  async loadModules(modules) {
    await this.ready;
    if (modules.length === 0) {
      return;
    }
    const request = ++this.#moduleRequest;
    const loaded = new Promise((resolve, reject) => {
      this.#moduleResolvers.set(request, { reject, resolve });
    });
    this.#worker.postMessage({ loadModules: modules, moduleRequest: request });
    await Promise.race([loaded, this.destroyed]);
  }

  async writeStdin(value) {
    await this.ready;
    const bytes = new TextEncoder().encode(value);
    await Promise.race([this.#stdin.enqueueChunkedMultipleAsync(bytes), this.destroyed]);
  }

  async #registerDisplayImages() {
    while (true) {
      const data = await Promise.race([this.#toMainThread.dequeueMessageAsync(), this.destroyed]);
      if (!data) {
        return;
      }
      if (typeof data.showImage === "string") {
        this.displayImageCallback(data.showImage);
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }

  async #registerStream(stream, callback) {
    const decoder = new TextDecoder("utf-8");
    while (true) {
      const bytes = await Promise.race([stream.dequeueAllAsync(), this.destroyed]);
      if (!bytes) {
        return;
      }
      const value = decoder.decode(new Int8Array(bytes), { stream: true });
      if (value !== "") {
        callback(value);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

class PythonRunner {
  #displayImageCallback;
  #moduleLoad = Promise.resolve();
  #modules = new Set();
  #stderrCallback;
  #stdoutCallback;
  #worker;

  constructor(stdoutCallback, stderrCallback, displayImageCallback) {
    this.#stdoutCallback = stdoutCallback;
    this.#stderrCallback = stderrCallback;
    this.#displayImageCallback = displayImageCallback;
    this.#worker = this.#createWorker();
    this.ready = this.#worker.ready;
  }

  #createWorker() {
    return new PythonWorker(
      this.#stdoutCallback,
      this.#stderrCallback,
      this.#displayImageCallback,
    );
  }

  async stopPython() {
    this.#worker.destroy();
    this.#worker = this.#createWorker();
    this.ready = this.#worker.ready;
    await this.#worker.loadModules([...this.#modules]);
  }

  destroy() {
    this.#worker.destroy();
  }

  async runPython(fileSystem, code) {
    if (this.#worker.runningPython) {
      await this.stopPython();
    }
    await this.#worker.runPython(fileSystem, code);
  }

  async loadModules(modules) {
    for (const module of modules) {
      this.#modules.add(module);
    }
    this.#moduleLoad = this.#moduleLoad.then(() => this.#worker.loadModules([...this.#modules]));
    await this.#moduleLoad;
  }

  async writeStdin(value) {
    await this.#worker.writeStdin(value);
  }
}

export { PythonRunner };
