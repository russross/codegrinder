class JavaScriptWorker {
  #loaded;
  #javaScriptFinished;
  #destroy;
  #worker;
  #stdin = new AtomicQueue;
  #stdout = new AtomicQueue;
  #stderr = new AtomicQueue;
  #toMainThread = new AtomicJSONQueue;
  #interrupt;
  constructor(stdoutCallback = (str) => { }, stderrCallback = (str) => { }, toMainThreadCallback = (data) => { }) {
    this.stdoutCallback = stdoutCallback;
    this.stderrCallback = stderrCallback;
    this.toMainThreadCallback = toMainThreadCallback;
    this.#worker = new Worker(new URL('./jsWorker.js', import.meta.url));
    this.runningJavaScript = false;
    this.destroyed = new Promise((accept) => {
      this.#destroy = accept;
    })
    this.destroyed.then(() => {
      this.#worker.terminate();
    })
    this.ready = new Promise((accept) => {
      this.#loaded = accept;
    });
    this.#worker.addEventListener("message", (e) => {
      if (e.data.loaded) {
        this.#interrupt = e.data.interrupt;
        e.data.stdin.identifier = e.data.stdinid;
        e.data.stdout.identifier = e.data.stdoutid;
        e.data.stderr.identifier = e.data.stderrid;
        e.data.toMainThread.identifier = e.data.toMainThreadid;
        this.#stdin = new AtomicQueue(e.data.stdin);
        this.#stdout = new AtomicQueue(e.data.stdout);
        this.#stderr = new AtomicQueue(e.data.stderr);
        this.#toMainThread = new AtomicJSONQueue(e.data.toMainThread);
        this.#loaded();
      }
      if (e.data.finishedJavaScript) {
        this.#javaScriptFinished();
      }
    })
    this.ready.then(async () => {
      this.#registerStream(this.#stdout, (str) => {
        this.stdoutCallback(str);
      })
      this.#registerStream(this.#stderr, (str) => {
        this.stderrCallback(str);
      })
      while (true) {
        const data = await Promise.race([this.#toMainThread.dequeueMessageAsync(), this.destroyed]);
        if (!data) {
          return;
        }
        this.toMainThreadCallback(data);

        // don't block page
        await new Promise((accept) => requestAnimationFrame(() => accept()));
      }
    })
  }
  destroy() {
    this.#destroy();
  }
  async runJavaScript(fileSystem, code, clearFiles = false) {
    await this.ready;
    if (this.runningJavaScript) {
      throw new Error("Already running JavaScript on this worker");
    }
    this.runningJavaScript = true;
    const execution = new Promise((resolve) => { this.#javaScriptFinished = resolve });
    this.#worker.postMessage({ fileSystem, run: code, clearFiles });
    await Promise.race([execution, this.destroyed]);
    this.runningJavaScript = false;
  }
  async loadModules(list) {
    await this.ready
    this.#worker.postMessage({ loadModules: list });
  }
  async writeStdin(str) {
    await this.ready;
    const encoder = new TextEncoder();
    const utf8Bytes = encoder.encode(str);
    await Promise.race([this.#stdin.enqueueChunkedMultipleAsync(utf8Bytes), this.destroyed]);
  }
  async #registerStream(stream, callback) {
    const decoder = new TextDecoder('utf-8');
    while (true) {
      const bytes = await Promise.race([stream.dequeueAllAsync(), this.destroyed]);
      if (!bytes) {
        return;
      }
      const string = decoder.decode(new Int8Array(bytes), { stream: true });
      if (string) {
        callback(string);
      }
      // don't block page
      await new Promise((accept) => setTimeout(() => accept(), 100));
    }
  }
}
class JavaScriptRunner {
  #worker;
  #stdoutCallback;
  #stderrCallback;
  #toMainThreadCallback;
  #modules;
  constructor(stdoutCallback = (str) => { }, stderrCallback = (str) => { }, toMainThreadCallback = (data) => { }) {
    this.#stdoutCallback = stdoutCallback;
    this.#stderrCallback = stderrCallback;
    this.#toMainThreadCallback = toMainThreadCallback;
    this.#worker = new JavaScriptWorker(this.#stdoutCallback, this.#stderrCallback, this.#toMainThreadCallback);
    this.#modules = [];
    this.ready = this.#worker.ready;
  }
  stopJavaScript() {
    this.#worker.destroy();
    this.#worker = new JavaScriptWorker(this.#stdoutCallback, this.#stderrCallback, this.#toMainThreadCallback);
    this.#worker.loadModules(this.#modules)
    this.ready = this.#worker.ready;
  }
  async runJavaScript(fileSystem, code, clearFiles = false) {
    if (this.#worker.runningJavaScript) {
      this.stopJavaScript();
    }
    await this.#worker.runJavaScript(fileSystem, code, clearFiles);
  }
  setStdoutCallback(callback) {
    this.#stdoutCallback = callback;
    this.#worker.stdoutCallback = callback;
  }
  setStderrCallback(callback) {
    this.#stderrCallback = callback;
    this.#worker.stderrCallback = callback;
  }
  setToMainThreadCallback(callback) {
    this.#toMainThreadCallback = callback;
    this.#worker.toMainThreadCallback = callback;
  }
  async writeStdin(str) {
    await this.#worker.writeStdin(str);
  }
  loadModules(list) {
    this.#modules = list;
    this.#worker.loadModules(list)
  }
}
export { JavaScriptRunner };
