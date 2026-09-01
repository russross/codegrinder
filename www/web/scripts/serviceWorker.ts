interface RuntimeWorkerController {
  readonly scriptURL: string;
}

interface RuntimeWorkerContainer {
  readonly controller: RuntimeWorkerController | null;
  addEventListener(type: "controllerchange", listener: () => void): void;
  removeEventListener(type: "controllerchange", listener: () => void): void;
}

function waitForVersionedController(
  container: RuntimeWorkerContainer,
  workerUrl: URL,
  timeoutMilliseconds = 10000,
): Promise<void> {
  if (container.controller?.scriptURL === workerUrl.href) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      container.removeEventListener("controllerchange", controllerChanged);
      reject(new Error("Timed out waiting for the runtime service worker"));
    }, timeoutMilliseconds);

    function controllerChanged(): void {
      if (container.controller?.scriptURL !== workerUrl.href) {
        return;
      }
      clearTimeout(timeout);
      container.removeEventListener("controllerchange", controllerChanged);
      resolve();
    }

    container.addEventListener("controllerchange", controllerChanged);
  });
}

export { waitForVersionedController };
export type { RuntimeWorkerContainer, RuntimeWorkerController };
