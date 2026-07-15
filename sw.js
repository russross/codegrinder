"use strict"
const version = '0.3.0';
const appCache = location.pathname.split("/").slice(1, -1).join("/") + "#"; // Unique across origin (Current Path)
const versionedCache = appCache + version; // Unique across versions
const localFilesToCache = [
  '.', // index.html
  './styles.css',
  './scripts/app.js',
  './scripts/atomicQueue.js',
  './scripts/codeGrinderApi.js',
  './scripts/directoryTree.js',
  './scripts/editorTabs.js',
  './scripts/firefoxPolyfillAtomicsWaitAsync.js',
  './scripts/iframeSharedArrayBufferWorkaround.js',
  './scripts/prompt.js',
  './scripts/jsHandler.js',
  './scripts/jsWorker.js',
  './scripts/resizeInstructions.js',
  './scripts/resizeTerminal.js',
];
async function addAllFast(list, name) {
  const cache = await caches.open(name);
  const responses = [];
  for (let file of list) {
    responses.push(fetch(file, { headers: { 'Cache-Control': 'no-cache' } })
      .then((response) => {
        const newHeaders = new Headers(response.headers);
        newHeaders.set("Cross-Origin-Embedder-Policy", "require-corp");
        newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");

        const sharedArrayBufferResponse = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
        return cache.put(file, sharedArrayBufferResponse);
      }))
  }
  return await Promise.all(responses);
}

// Start the service worker and cache all of the app's content
self.addEventListener('install', function (e) {
  e.waitUntil(addAllFast(localFilesToCache, versionedCache).then(() => self.skipWaiting()));
});

self.addEventListener('activate', function (event) {
  console.log("Running new service worker " + versionedCache);
  return event.waitUntil(
    caches.keys().then(async function (cacheNames) {
      await Promise.all(
        cacheNames.filter(function (cacheName) {
          return (cacheName.startsWith(appCache) && !(cacheName.startsWith(versionedCache)));
        }).map(function (cacheName) {
          return caches.delete(cacheName);
        })
      );
      return await self.clients.claim();
    })
  );
});
async function cacheFirst(request) {
  const url = new URL(request.url);
  if (url.host === location.host) {
    url.search = '';
    request = new Request(url, request);
  }
  const cache = await caches.open(versionedCache);
  const response = await cache.match(request);
  if (response) {
    return response;
  }
  // Try fetching from the network
  return await fetch(request).then((response) => {
    // Clone the response as it can only be consumed once
    const responseClone = response.clone();

    // Respond and add the network response to the cache
    cache.put(request, responseClone);
    return response;
  });
}
const sabs = [];
const waits = [];
async function handlePonyfill(request, resource) {
  if (resource.startsWith("SharedArrayBuffer/")) {
    const size = resource.split("/")[1] | 0;
    sabs.push(new Int8Array(size));
    waits.push({});
    return new Response(sabs.length - 1);
  }
  if (resource.startsWith("Atomics.wait/")) {
    const [_, identifier, index, value, timeout] = resource.split("/");
    const json = await request.json();
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
      await waits[identifier][index].promise;
    }
    return new Response(JSON.stringify({ value: "ok", buffer: Array.from(sabs[identifier]) }));
  }
  if (resource.startsWith("Atomics.notify/")) {
    const [_, identifier, index, count] = resource.split("/");
    const json = await request.json();
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
  if (url.host == location.host) {
    // When hosted on the same server as the api, don't cache api requests (different paths)
    if (!url.pathname.startsWith(location.pathname.split("/sw.js")[0])) {
      event.respondWith(fetch(request));
      return;
    }
    // SharedArrayBufferWorkaround
    const resource = url.pathname.split("ponyfill/");
    if (resource.length === 2) {
      event.respondWith(handlePonyfill(request, resource[1]));
      return;
    }
  }
  // Cross-origin API requests are never cached.
  if (request.method !== "GET") {
    return;
  }
  // Cache everything
  event.respondWith(cacheFirst(request));
});
