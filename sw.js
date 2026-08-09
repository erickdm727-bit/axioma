// Minimal service worker for Axioma — just enough to make the app
// installable as a PWA and to keep the app shell (this HTML file) available
// if the connection drops mid-session. It deliberately does NOT cache or
// intercept calls to other origins (Twelve Data, the FX rate API) — those
// must always hit the network live, never a stale cached response.
const CACHE_NAME = "axioma-shell-v2";
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
  // Network-first: always try to fetch the latest version when online, so
  // app updates (HTML/CSS/JS changes) show up the next time you open the app
  // with a connection, instead of being stuck on whatever was cached first.
  // Only falls back to the cached copy if the network request fails (offline).
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
