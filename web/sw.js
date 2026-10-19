// Service worker: lets the app open offline. Only the app's own files are cached; /api (places from Qloo) is never cached here
// and other sites (the model download) are left to the browser. Network first, so a new version shows up as soon as you are online.
const VERSION = "uns-2026-10-19.1"; // change with every release (also BUILD in index.html and js/app.js)
// Only the essentials are fetched at install; every other file is stored the first time the page uses it (network first, below).
// A big install burst of ~30 parallel downloads, right while the visitor reloads, sometimes stalled requests on the host.
const SHELL = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon.svg"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  // The new worker does not claim open pages: taking over a page that is still loading left a script request hanging (seen on the hosted site).
  // A new version controls the next page instead; the page and code are revalidated by the server (no-cache) anyway.
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/")) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then((hit) => hit || caches.match("index.html"))));
});
