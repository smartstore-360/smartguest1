/* SmartGuest service worker: opens the app with no connection. Server calls are never touched (they are cross-origin). */
var VERSION = 'sg-shell-v1';
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

// Stale-while-revalidate: show the saved copy at once, fetch the new one in the background, tell the page if it changed.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(caches.open(VERSION).then(function (cache) {
    var key = req.mode === 'navigate' ? 'index.html' : req;
    return cache.match(key, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req, { cache: 'no-cache' }).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          if (hit && /\.(js|css|html)$|\/$/.test(url.pathname)) {
            Promise.all([hit.clone().text(), res.clone().text()]).then(function (t) { if (t[0] !== t[1]) tell({ type: 'updated' }); }).catch(function () {});
          }
          cache.put(req.mode === 'navigate' ? 'index.html' : req, copy);
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    });
  }));
});
