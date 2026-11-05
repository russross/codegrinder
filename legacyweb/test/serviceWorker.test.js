import assert from "node:assert/strict";
import test from "node:test";

import { waitForVersionedController } from "../scripts/serviceWorker.ts";

class ServiceWorkerContainerStub {
  controller = null;
  listeners = new Set();

  addEventListener(type, listener) {
    assert.equal(type, "controllerchange");
    this.listeners.add(listener);
  }

  removeEventListener(type, listener) {
    assert.equal(type, "controllerchange");
    this.listeners.delete(listener);
  }

  changeController(scriptURL) {
    this.controller = { scriptURL };
    for (const listener of this.listeners) {
      listener();
    }
  }
}

test("runtime startup ignores an old controller until the requested version takes control", async () => {
  const container = new ServiceWorkerContainerStub();
  const requestedUrl = new URL("https://example.test/web/sw.js?version=2");
  const ready = waitForVersionedController(container, requestedUrl, 100);

  container.changeController("https://example.test/web/sw.js?version=1");
  assert.equal(container.listeners.size, 1);

  container.changeController(requestedUrl.href);
  await ready;
  assert.equal(container.listeners.size, 0);
});

test("runtime startup cleans up its controller listener after a timeout", async () => {
  const container = new ServiceWorkerContainerStub();

  await assert.rejects(
    waitForVersionedController(
      container,
      new URL("https://example.test/web/sw.js?version=2"),
      5,
    ),
    /Timed out waiting for the runtime service worker/,
  );
  assert.equal(container.listeners.size, 0);
});
