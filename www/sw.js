const CACHE = "reelflix-v30";
const ASSETS = ["./", "./index.html", "./style.css?v=30", "./vendor/supabase.js?v=30", "./vendor/livekit-client.js?v=30", "./app.js?v=30", "./favicon.svg", "./icon-192.png", "./icon-512.png", "./manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((response) => {
          const responseToCache = response.clone();
          if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, responseToCache));
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
