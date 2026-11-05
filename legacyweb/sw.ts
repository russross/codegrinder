interface InputChannel {
  pendingReads: Array<(response: Response) => void>;
  values: string[];
}

function isServiceWorkerScope(
  value: unknown,
): value is ServiceWorkerGlobalScope {
  return typeof value === "object"
    && value !== null
    && "clients" in value
    && "registration" in value
    && "skipWaiting" in value;
}

function requireServiceWorkerScope(value: unknown): ServiceWorkerGlobalScope {
  if (isServiceWorkerScope(value)) {
    return value;
  }
  throw new Error("CodeGrinder runtime service worker loaded outside a service worker scope");
}

const serviceWorker = requireServiceWorkerScope(globalThis);
const oldCachePrefix = location.pathname.split("/").slice(1, -1).join("/") + "#";
const inputChannels = new Map<string, InputChannel>();

serviceWorker.addEventListener("install", (event) => {
  event.waitUntil(serviceWorker.skipWaiting());
});

serviceWorker.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith(oldCachePrefix))
        .map((cacheName) => caches.delete(cacheName)),
    )),
    serviceWorker.clients.claim(),
  ]));
});

function channelState(channelId: string): InputChannel {
  let channel = inputChannels.get(channelId);
  if (channel === undefined) {
    channel = { pendingReads: [], values: [] };
    inputChannels.set(channelId, channel);
  }
  return channel;
}

async function writeInput(request: Request, channelId: string): Promise<Response> {
  const value = await request.text();
  const channel = channelState(channelId);
  const pendingRead = channel.pendingReads.shift();
  if (pendingRead !== undefined) {
    pendingRead(new Response(value, {
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
    }));
  } else {
    channel.values.push(value);
  }
  return new Response(null, { status: 204 });
}

function readInput(channelId: string): Promise<Response> {
  const channel = channelState(channelId);
  const value = channel.values.shift();
  if (value !== undefined) {
    return Promise.resolve(new Response(value, {
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
    }));
  }
  return new Promise((resolve) => {
    channel.pendingReads.push(resolve);
  });
}

function closeInput(channelId: string): Response {
  const channel = inputChannels.get(channelId);
  if (channel !== undefined) {
    for (const resolve of channel.pendingReads) {
      resolve(new Response("Input channel closed", { status: 410 }));
    }
    inputChannels.delete(channelId);
  }
  return new Response(null, { status: 204 });
}

serviceWorker.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "POST") {
    return;
  }
  const url = new URL(request.url);
  const inputRoot = new URL("worker-input/", serviceWorker.registration.scope);
  if (url.origin !== inputRoot.origin || !url.pathname.startsWith(inputRoot.pathname)) {
    return;
  }
  const path = url.pathname.slice(inputRoot.pathname.length).split("/");
  if (path.length !== 2 || path[0] === "") {
    event.respondWith(Promise.resolve(new Response("Invalid input channel path", { status: 404 })));
    return;
  }
  const [channelId, operation] = path;
  if (operation === "read") {
    event.respondWith(readInput(channelId));
    return;
  }
  if (operation === "write") {
    event.respondWith(writeInput(request, channelId));
    return;
  }
  if (operation === "close") {
    event.respondWith(Promise.resolve(closeInput(channelId)));
    return;
  }
  event.respondWith(Promise.resolve(new Response("Unknown input channel operation", { status: 404 })));
});
