const CACHE_NAME = "skycast-shell-v11";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/script.js",
  "./assets/favicon.svg",
  "./manifest.webmanifest"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request, { ignoreSearch: true }).then(response => response || caches.match("./index.html")))
  );
});
