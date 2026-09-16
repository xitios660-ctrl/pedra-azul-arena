/* Pedra Azul PWA service worker — careful caching for deploys */
const CACHE_STATIC = "pedra-azul-static-v3";
const CACHE_PAGES = "pedra-azul-pages-v3";

const PRECACHE = [
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/assets/pedra-azul-logo.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_STATIC && k !== CACHE_PAGES)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

function isApiRequest(url) {
  return url.pathname.startsWith("/api/") || url.pathname === "/api";
}

function isNavigation(request) {
  return request.mode === "navigate" || (request.headers.get("accept") || "").includes("text/html");
}

function isHashedStatic(url) {
  return url.pathname.startsWith("/static/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Never cache API — always network
  if (isApiRequest(url)) {
    event.respondWith(fetch(request));
    return;
  }

  // HTML / navigations: network-first so deploys are not stuck on stale shell
  if (isNavigation(request) || url.pathname.endsWith(".html") || url.pathname === "/") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_PAGES).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match("/index.html"))
        )
    );
    return;
  }

  // Hashed CRA bundles: cache-first (filename changes on deploy)
  if (isHashedStatic(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response && response.ok) {
              const copy = response.clone();
              caches.open(CACHE_STATIC).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
    return;
  }

  // Icons / public assets: stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_STATIC).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
