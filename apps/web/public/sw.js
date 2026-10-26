/*
 * Mallowtick service worker. Caching policy (see docs/architecture.md):
 *  - /api/*            never cached here; market data always goes to the network.
 *  - /_next/static/*   cache-first (content-hashed, immutable).
 *  - icons, mascot     cache-first.
 *  - page navigations  network-first; fall back to the last cached page shell,
 *                      then to /offline. Shells contain no market data (it is
 *                      fetched client-side), so a cached shell never shows
 *                      stale prices as live.
 */
const VERSION = "v1";
const STATIC_CACHE = `mallowtick-static-${VERSION}`;
const PAGE_CACHE = `mallowtick-pages-${VERSION}`;
const PRECACHE = ["/offline", "/icons/icon-192.png", "/icons/favicon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("mallowtick-") && k !== STATIC_CACHE && k !== PAGE_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(PAGE_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(request)) || (await caches.match("/offline")) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/mascot/")
  ) {
    event.respondWith(cacheFirst(request));
  }
});
