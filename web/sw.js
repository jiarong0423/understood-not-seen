// Service worker: lets the app open offline. Only the app's own files are cached; /api (places from Qloo) is never cached here
// and other sites (the model download) are left to the browser. Network first, so a new version shows up as soon as you are online.
const VERSION = "uns-2026-10-11.3"; // change with every release (also BUILD in index.html and js/app.js)
const SHELL = [
  "./", "index.html", "manifest.webmanifest", "sample_bookmarks.html",
  "js/app.js", "js/gate.js", "js/rules.js", "js/combine.js", "js/embed.js", "js/themes.js", "js/taste.js", "js/expand.js", "js/calendar.js", "js/icons.js", "js/waiting.js",
  "kb/activities.json", "kb/i18n.json", "kb/cities.json", "kb/vocab.json", "kb/expansion.json", "kb/calendar.json", "kb/place_names.json", "js/names.js", "sample_bookmarks.zh.html",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png", "icons/icon.svg",
];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/")) return;
  e.respondWith(fetch(e.request, { cache: "no-store" }).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then((hit) => hit || caches.match("index.html"))));
});
