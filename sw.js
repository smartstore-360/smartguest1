/* SmartGuest service worker: opens the app with no connection. Server calls are never touched (they are cross-origin). */
var VERSION = 'sg-shell-v2';
var SHELL = ['./', 'index.html', 'styles.css', 'api.js', 'app.js', 'config.js', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return c.add(new Request(u, { cache: 'reload' })).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
function tell(msg) { self.clients.matchAll().then(function (cs) { cs.forEach(function (c) { c.postMessage(msg); }); }); }

// Network first (so an update is live on the very next load), saved copy when offline or the network is slow/unreachable.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var key = req.mode === 'navigate' ? 'index.html' : req;
  e.respondWith(caches.open(VERSION).then(function (cache) {
    return new Promise(function (resolve) {
      var done = false;
      function fallback() { cache.match(key, { ignoreSearch: true }).then(function (hit) { if (hit) { done = true; resolve(hit); } }); }
      var timer = setTimeout(fallback, 4000);                       // slow network: show the saved copy while waiting
      fetch(req, { cache: 'no-cache' }).then(function (res) {
        clearTimeout(timer);
        if (res && res.ok) cache.put(key, res.clone());
        if (!done) resolve(res);
      }).catch(function () {
        clearTimeout(timer);
        cache.match(key, { ignoreSearch: true }).then(function (hit) { if (!done) resolve(hit || Response.error()); });
      });
    });
  }));
});
