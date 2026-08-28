const CACHE_PREFIX = "chromatograph-app-shell";
const CACHE_VERSION = "v1";
const CACHE_NAME = `${CACHE_PREFIX}-${CACHE_VERSION}`;

const isCacheableRequest = (request) => {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  return url.origin === self.location.origin
    && !url.pathname.startsWith("/api/")
    && url.pathname !== "/ws";
};

const cacheResponse = async (request, response) => {
  if (!response.ok || response.type === "opaque") return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response);
};

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const response = await fetch(self.registration.scope, { cache: "reload" });
    await cacheResponse(self.registration.scope, response);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(`${CACHE_PREFIX}-`) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_URLS" || !Array.isArray(event.data.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(event.data.urls.map(async (value) => {
      try {
        const request = new Request(value, { credentials: "same-origin" });
        if (!isCacheableRequest(request)) return;
        const response = await fetch(request);
        if (response.ok && response.type !== "opaque") await cache.put(request, response);
      } catch {
        // A resource may disappear during a deployment. Other resources are still cacheable.
      }
    }));
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!isCacheableRequest(request)) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        void cacheResponse(request, response.clone());
        return response;
      } catch {
        const cached = await caches.match(request, { ignoreSearch: true })
          ?? await caches.match(self.registration.scope, { ignoreSearch: true });
        if (cached) return cached;
        return Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    void cacheResponse(request, response.clone());
    return response;
  })());
});
