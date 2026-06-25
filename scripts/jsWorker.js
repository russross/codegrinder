importScripts("iframeSharedArrayBufferWorkaround.js", "./atomicQueue.js");

(async () => {
  // SharedArrayBuffers for communication with main thread
  const interrupt = new SharedArrayBuffer(4);
  const stdin = new SharedArrayBuffer(4000);
  const stdout = new SharedArrayBuffer(4000);
  const stderr = new SharedArrayBuffer(4000);
  const toMainThread = new SharedArrayBuffer(4000);

  const stdinQueue = new AtomicQueue(stdin);
  const stdoutQueue = new AtomicQueue(stdout);
  const stderrQueue = new AtomicQueue(stderr);
  const toMainThreadQueue = new AtomicJSONQueue(toMainThread);

  // Store the filesystem for code execution
  let fileSystem = null;

  // Helper to write string to queue
  function writeToQueue(queue, str) {
    const encoder = new TextEncoder();
    const utf8Bytes = encoder.encode(str);
    queue.enqueueChunkedMultipleSync(utf8Bytes);
  }

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

  // Simple module cache to prevent circular dependencies and repeated execution
  const moduleCache = {};

  // Simple require() function for loading other files from fileSystem
  globalThis.require = function(modulePath) {
    try {
      // Normalize path
      let normalizedPath = modulePath;

      // Handle relative paths starting with ./
      if (modulePath.startsWith('./')) {
        normalizedPath = '/' + modulePath.substring(2);
      }
      // Handle relative paths starting with ../
      else if (modulePath.startsWith('../')) {
        // For now, just treat ../ as root (could implement proper path resolution later)
        normalizedPath = '/' + modulePath.replace(/^\.\.\//, '');
      }
      // If it doesn't start with /, make it absolute
      else if (!modulePath.startsWith('/')) {
        normalizedPath = '/' + modulePath;
      }

      // Add .js extension if not present
      if (!normalizedPath.endsWith('.js')) {
        normalizedPath += '.js';
      }

      // Check cache first
      if (moduleCache[normalizedPath]) {
        return moduleCache[normalizedPath];
      }

      // Load the file content
      const code = getFileContent(normalizedPath);

      // Create a module object to capture exports
      const module = { exports: {} };
      const exports = module.exports;

      // Execute the module code with module and exports in scope
      const fn = new Function('module', 'exports', 'require', 'console', code);
      fn(module, exports, globalThis.require, console);

      // Cache the result
      moduleCache[normalizedPath] = module.exports;

      return module.exports;
    } catch (error) {
      const errorMessage = `Error requiring module ${modulePath}: ${error.message}\n`;
      writeToQueue(stderrQueue, errorMessage);
      throw error;
    }
  };

  // Function to run a script file
  globalThis.run_script = function(scriptPath) {
    try {
      // Clear module cache so we always get fresh versions of required files
      // This is important for student workflow: edit -> run -> see changes
      for (let key in moduleCache) {
        delete moduleCache[key];
      }

      // Normalize path (remove leading ./)
      const normalizedPath = scriptPath.replace(/^\.\//, '/');
      const code = getFileContent(normalizedPath);

      // Create a module context for the script
      const module = { exports: {} };
      const exports = module.exports;

      // Execute with module, exports, and require available
      const fn = new Function('module', 'exports', 'require', 'console', code);
      fn(module, exports, globalThis.require, console);

      // If the script exported anything, it's now in module.exports
      // (though run_script typically doesn't need to return anything)
    } catch (error) {
      const errorMessage = `Error running script ${scriptPath}: ${error.message}\n`;
      writeToQueue(stderrQueue, errorMessage);
    }
  };

  // Message handler
  addEventListener("message", (e) => {
    const data = e.data;

    if (data.loadModules) {
      // Module loading is not implemented for JavaScript execution
      // This is here for interface compatibility but is a no-op
      // In the future, this could potentially load external JS libraries via importScripts
      console.log('Note: loadModules is not implemented for JavaScript execution');
    }

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

  // Send initialization message
  postMessage({
    loaded: true,
    stdin, stdinid: stdin.identifier,
    stdout, stdoutid: stdout.identifier,
    stderr, stderrid: stderr.identifier,
    toMainThread, toMainThreadid: toMainThread.identifier,
    interrupt,
  });
})();
