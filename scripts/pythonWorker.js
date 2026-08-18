importScripts(
  "https://cdn.jsdelivr.net/pyodide/v0.29.1/full/pyodide.js",
  "iframeSharedArrayBufferWorkaround.js",
  "./atomicQueue.js",
);

(async () => {
  const pyodide = await loadPyodide({
    indexURL: "https://cdn.jsdelivr.net/pyodide/v0.29.1/full/",
  });
  const interrupt = new SharedArrayBuffer(4);
  pyodide.setInterruptBuffer(interrupt);

  const stdin = new SharedArrayBuffer(4000);
  const stdout = new SharedArrayBuffer(4000);
  const stderr = new SharedArrayBuffer(4000);
  const toMainThread = new SharedArrayBuffer(4000);
  const stdinQueue = new AtomicQueue(stdin);
  const stdoutQueue = new AtomicQueue(stdout);
  const stderrQueue = new AtomicQueue(stderr);
  const toMainThreadQueue = new AtomicJSONQueue(toMainThread);

  pyodide.setStdin({
    stdin: () => new Int8Array(stdinQueue.dequeueAllSync()),
  });
  pyodide.setStdout({
    raw: (byte) => stdoutQueue.enqueueMultipleSync([byte]),
  });
  pyodide.setStderr({
    raw: (byte) => stderrQueue.enqueueMultipleSync([byte]),
  });

  await pyodide.loadPackage("micropip");
  await pyodide.runPythonAsync(`
import micropip
await micropip.install(["cisc108"])
`);
  pyodide.runPython(`
import sys

def invalidate_import_cache():
    for module_name, module in list(sys.modules.items()):
        module_path = getattr(module, "__file__", None)
        if module_path is not None and module_path.startswith("/home/pyodide/"):
            del sys.modules[module_name]

def run_script(script_path):
    invalidate_import_cache()
    with open(script_path, "r") as source:
        code = compile(source.read(), script_path, "exec")

    original_argv = sys.argv.copy()
    sys.argv = [script_path]
    try:
        exec(code, globals())
    except SystemExit:
        pass
    finally:
        sys.argv = original_argv
`);

  globalThis.showImage = (image) => {
    toMainThreadQueue.enqueueMessageSync({ showImage: image });
  };

  function writeError(error) {
    const message = error instanceof Error ? error.message : String(error);
    stderrQueue.enqueueChunkedMultipleSync(new TextEncoder().encode(`${message}\n`));
  }

  function deleteRecursively(path, onlyChildren = false) {
    const node = pyodide.FS.lookupPath(path).node;
    if (!pyodide.FS.isDir(node.mode)) {
      if (!onlyChildren) {
        pyodide.FS.unlink(path);
      }
      return;
    }
    for (const name of pyodide.FS.readdir(path)) {
      if (name === "." || name === "..") {
        continue;
      }
      deleteRecursively(`${path}/${name}`);
    }
    if (!onlyChildren) {
      pyodide.FS.rmdir(path);
    }
  }

  function writeDirectory(directory, path) {
    for (const [name, node] of Object.entries(directory.children)) {
      if (node.children) {
        writeDirectory(node, `${path}${name}/`);
        continue;
      }
      pyodide.FS.createPath(".", path, true, true);
      pyodide.FS.writeFile(`${path}${name}`, node.content);
    }
  }

  function replaceWorkspace(fileSystem) {
    deleteRecursively(".", true);
    writeDirectory(fileSystem.rootNode, "./");
  }

  const modules = new Set(["cisc108"]);
  async function loadModules(request, requestedModules) {
    const missing = requestedModules
      .map((module) => module.trim())
      .filter((module) => module !== "" && !modules.has(module));
    try {
      if (missing.length > 0) {
        await pyodide.runPythonAsync(`
import micropip
await micropip.install(${JSON.stringify(missing)})
`);
        for (const module of missing) {
          modules.add(module);
        }
      }
      if (missing.includes("matplotlib")) {
        pyodide.runPython(`
import base64
import os
from io import BytesIO

os.environ["MPLBACKEND"] = "AGG"
import js
import matplotlib.pyplot

def show_image():
    image = BytesIO()
    matplotlib.pyplot.savefig(image, format="png")
    image.seek(0)
    js.showImage(base64.b64encode(image.read()).decode("utf-8"))
    matplotlib.pyplot.clf()

matplotlib.pyplot.show = show_image
`);
      }
      postMessage({ modulesLoaded: request });
    } catch (error) {
      postMessage({ moduleLoadError: request, message: String(error) });
    }
  }

  addEventListener("message", async (event) => {
    const data = event.data;
    if (data.loadModules) {
      await loadModules(data.moduleRequest, data.loadModules);
      return;
    }
    if (!data.run) {
      return;
    }
    try {
      if (data.fileSystem) {
        replaceWorkspace(data.fileSystem);
      }
      await pyodide.runPythonAsync(data.run);
    } catch (error) {
      writeError(error);
    } finally {
      postMessage({ finishedPython: true });
    }
  });

  postMessage({
    loaded: true,
    stdin,
    stdinId: stdin.identifier,
    stdout,
    stdoutId: stdout.identifier,
    stderr,
    stderrId: stderr.identifier,
    toMainThread,
    toMainThreadId: toMainThread.identifier,
  });
})();
