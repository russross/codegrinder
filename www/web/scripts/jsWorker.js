postMessage({ loadingStatus: "initializing JavaScript runtime" });
importScripts("iframeSharedArrayBufferWorkaround.js", "./atomicQueue.js");

(async () => {
  // SharedArrayBuffers for communication with main thread
  const stdin = new SharedArrayBuffer(4000);
  const stdout = new SharedArrayBuffer(4000);
  const stderr = new SharedArrayBuffer(4000);

  const stdinQueue = new AtomicQueue(stdin);
  const stdoutQueue = new AtomicQueue(stdout);
  const stderrQueue = new AtomicQueue(stderr);

  // Store the filesystem for code execution
  let fileSystem = null;

  // Helper to write string to queue
  function writeToQueue(queue, str) {
    const encoder = new TextEncoder();
    const utf8Bytes = encoder.encode(str);
    queue.enqueueChunkedMultipleSync(utf8Bytes);
  }

  function readStdin() {
    return new TextDecoder().decode(new Uint8Array(stdinQueue.dequeueAllSync()));
  }

  globalThis.readline = readStdin;
  globalThis.prompt = function() {
    return readStdin().replace(/\r?\n$/, '');
  };

  // Capture console output
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;

  console.log = function(...args) {
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ') + '\n';
    writeToQueue(stdoutQueue, message);
    originalConsoleLog.apply(console, args);
  };

  console.error = function(...args) {
    const message = args.map(arg => String(arg)).join(' ') + '\n';
    writeToQueue(stderrQueue, message);
    originalConsoleError.apply(console, args);
  };

  console.warn = function(...args) {
    const message = args.map(arg => String(arg)).join(' ') + '\n';
    writeToQueue(stderrQueue, message);
    originalConsoleWarn.apply(console, args);
  };

  // Execute JavaScript code
  function runJavaScript(code) {
    try {
      // Create a function to execute the code with access to fileSystem
      // This provides some isolation while allowing access to worker scope
      const fn = new Function('fileSystem', 'console', code);
      fn(fileSystem, console);
    } catch (error) {
      const errorMessage = `${error.name}: ${error.message}\n${error.stack || ''}\n`;
      writeToQueue(stderrQueue, errorMessage);
    }
  }

  // Helper to get file content from fileSystem
  function getFileContent(path) {
    if (!fileSystem || !fileSystem.rootNode) {
      throw new Error(`File system not initialized`);
    }

    const parts = path.split('/').filter(p => p);
    let current = fileSystem.rootNode;

    for (const part of parts) {
      if (!current.children || !current.children[part]) {
        throw new Error(`File not found: ${path}`);
      }
      current = current.children[part];
    }

    if (current.children) {
      throw new Error(`${path} is a directory, not a file`);
    }

    return current.content;
  }

  const moduleCache = {};

  function resolveModulePath(modulePath, parentPath) {
    const parentParts = parentPath.split('/').filter(Boolean);
    parentParts.pop();
    const parts = modulePath.startsWith('/') ? [] : parentParts;
    for (const part of modulePath.split('/')) {
      if (part === '' || part === '.') {
        continue;
      }
      if (part === '..') {
        if (parts.length === 0) {
          throw new Error(`Module path escapes the workspace: ${modulePath}`);
        }
        parts.pop();
        continue;
      }
      parts.push(part);
    }
    let resolved = `/${parts.join('/')}`;
    if (!resolved.endsWith('.js')) {
      resolved += '.js';
    }
    return resolved;
  }

  function loadModule(path) {
    if (Object.hasOwn(moduleCache, path)) {
      return moduleCache[path].exports;
    }
    const module = { exports: {} };
    moduleCache[path] = module;
    try {
      const code = getFileContent(path);
      const localRequire = modulePath => loadModule(resolveModulePath(modulePath, path));
      const fn = new Function('module', 'exports', 'require', 'console', code);
      fn(module, module.exports, localRequire, console);
      return module.exports;
    } catch (error) {
      delete moduleCache[path];
      throw error;
    }
  }

  globalThis.require = modulePath => loadModule(resolveModulePath(modulePath, '/'));

  // Function to run a script file
  globalThis.run_script = function(scriptPath) {
    try {
      // Clear module cache so we always get fresh versions of required files
      // This is important for student workflow: edit -> run -> see changes
      for (let key in moduleCache) {
        delete moduleCache[key];
      }

      loadModule(resolveModulePath(scriptPath, '/'));
    } catch (error) {
      const errorMessage = `Error running script ${scriptPath}: ${error.message}\n`;
      writeToQueue(stderrQueue, errorMessage);
    }
  };

  // Message handler
  addEventListener("message", (e) => {
    const data = e.data;

    if (data.clearFiles) {
      // Clear the file system reference and module cache
      fileSystem = null;
      // Clear module cache
      for (let key in moduleCache) {
        delete moduleCache[key];
      }
    }

    if (data.fileSystem) {
      // Store the file system for access during execution
      fileSystem = data.fileSystem;
    }

    if (data.run) {
      try {
        runJavaScript(data.run);
      } catch (error) {
        const errorMessage = `Execution error: ${error.message}\n${error.stack || ''}\n`;
        writeToQueue(stderrQueue, errorMessage);
      }
      postMessage({ finishedJavaScript: true });
    }
  });

  postMessage({ loadingStatus: "JavaScript runtime ready" });
  // Send initialization message
  postMessage({
    loaded: true,
    stdin, stdinid: stdin.identifier,
    stdout, stdoutid: stdout.identifier,
    stderr, stderrid: stderr.identifier,
  });
})();
