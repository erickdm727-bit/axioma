// Minimal service worker for Axioma — just enough to make the app
// installable as a PWA and to keep the app shell (this HTML file) available
// if the connection drops mid-session. It deliberately does NOT cache or
// intercept calls to other origins (Twelve Data, the FX rate API) — those
// must always hit the network live, never a stale cached response.
const CACHE_NAME = "axioma-shell-v1";
const SHELL_FILES = ["./index7.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .catch(() => {}) // don't block install if the shell can't be pre-cached yet
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // let API calls pass straight through, uncached
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
