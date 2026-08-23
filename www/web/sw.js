"use strict"
const appCachePrefix = location.pathname.split("/").slice(1, -1).join("/") + "#";

self.addEventListener('install', function (event) {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function (event) {
  event.waitUntil(Promise.all([
    caches.keys().then(function (cacheNames) {
      return Promise.all(
        cacheNames
          .filter(cacheName => cacheName.startsWith(appCachePrefix))
          .map(cacheName => caches.delete(cacheName))
      );
    }),
    self.clients.claim(),
  ]));
});

const sabs = [];
const waits = [];
async function handlePonyfill(request, resource) {
  if (resource === "release") {
    const identifiers = await request.json();
    for (const identifier of identifiers) {
      for (const wait of Object.values(waits[identifier] ?? {})) {
        wait.accept();
      }
      sabs[identifier] = null;
      waits[identifier] = null;
    }
    return new Response();
  }
  if (resource.startsWith("SharedArrayBuffer/")) {
    const size = resource.split("/")[1] | 0;
    sabs.push(new Int8Array(size));
    waits.push({});
    return new Response(sabs.length - 1);
  }
  if (resource.startsWith("Atomics.wait/")) {
    const [_, identifier, index, value, timeout] = resource.split("/");
    const requestedTimeoutMilliseconds = Number(timeout);
    const timeoutMilliseconds = Number.isFinite(requestedTimeoutMilliseconds)
      ? Math.min(requestedTimeoutMilliseconds, 30000)
      : 30000;
    const json = await request.json();
    if (sabs[identifier] === null) {
      return new Response(JSON.stringify({ value: "timed-out", buffer: [] }));
    }
    for (let i = 0; i < json.curr.length; i++) {
      if (json.curr[i] != json.prev[i]) {
        sabs[identifier][i] = json.curr[i];
      }
    }
    while (new Int32Array(sabs[identifier].buffer)[index] == value) {
      if (!(index in waits[identifier])) {
        waits[identifier][index] = {};
        waits[identifier][index].promise = new Promise(accept => { waits[identifier][index].accept = accept });
      }
      const notified = await Promise.race([
        waits[identifier][index].promise.then(() => true),
        new Promise(resolve => setTimeout(() => resolve(false), timeoutMilliseconds)),
      ]);
      if (!notified) {
        delete waits[identifier][index];
        return new Response(JSON.stringify({ value: "timed-out", buffer: Array.from(sabs[identifier]) }));
      }
      if (sabs[identifier] === null) {
        return new Response(JSON.stringify({ value: "timed-out", buffer: [] }));
      }
    }
    return new Response(JSON.stringify({ value: "ok", buffer: Array.from(sabs[identifier]) }));
  }
  if (resource.startsWith("Atomics.notify/")) {
    const [_, identifier, index, count] = resource.split("/");
    const json = await request.json();
    if (sabs[identifier] === null) {
      return new Response();
    }
    for (let i = 0; i < json.curr.length; i++) {
      if (json.curr[i] != json.prev[i]) {
        sabs[identifier][i] = json.curr[i];
      }
    }
    if (index in waits[identifier]) {
      const accept = waits[identifier][index].accept;
      delete waits[identifier][index];
      accept();
    }
    return new Response();
  }
}
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const ponyfillUrls = [
    new URL("ponyfill/", self.registration.scope),
    new URL("scripts/ponyfill/", self.registration.scope),
  ];
  const ponyfillUrl = ponyfillUrls.find(candidate => (
    url.origin === candidate.origin && url.pathname.startsWith(candidate.pathname)
  ));
  if (request.method !== "POST" || !ponyfillUrl) {
    return;
  }
  event.respondWith(handlePonyfill(request, url.pathname.slice(ponyfillUrl.pathname.length)));
});
