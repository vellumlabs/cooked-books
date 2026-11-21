// Offline support. Network first, so a new release is never hidden by the cache; the cache only answers when the network fails.
const CACHE = 'cooked-books-v1';
const SHELL = ['./', './style.css', './app.js', './engine/engine.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('cooked-books-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(req).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return r;
  }).catch(async () => {
    // ?d= and ?pack= are read by the page itself, so any cached copy of the page will do
    const hit = await caches.match(req) || (req.mode === 'navigate' && await caches.match('./'));
    return hit || Response.error();
  }));
});
