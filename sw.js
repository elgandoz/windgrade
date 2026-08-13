/* ══════════════════════════════════════════════════════════════════════
   sw.js, offline cache for the app shell.

   ┌──────────────────────────────────────────────────────────────────────┐
   │  READINGS ARE NEVER CACHED. Not now, not as an optimisation later.   │
   │                                                                      │
   │  This tool cannot work offline for wind. Old wind shown confidently  │
   │  is the single way it could hurt someone, and a cache that served a  │
   │  stale reading as though it were current would do exactly that       │
   │  behind the staleness logic's back.                                  │
   │                                                                      │
   │  The origin guard below is what enforces it: winds.mobi is           │
   │  cross-origin, so its responses never reach this cache. If a         │
   │  provider is ever added on our own origin, exclude it explicitly.    │
   │  Terrain may be cached, terrain does not change. Wind does.         │
   └──────────────────────────────────────────────────────────────────────┘

   Strategy is stale-while-revalidate, not cache-first: the cached copy is
   returned immediately and a fresh one fetched in the background for next
   time. That matters for the *shell* too. A corrected rating threshold or
   a fixed marker must be able to reach a pilot who already installed the
   page, and this way it arrives on the next load rather than never.

   Bump CACHE when the file list changes. Content changes do not need it;
   the background revalidation picks those up on its own.
   ═══════════════════════════════════════════════════════════════════ */

var CACHE = "windmap-v5";

var ASSETS = [
  "./",
  "index.html",
  "app.html",
  "widget.html",
  "tools.html",
  "wg/base.css",
  "wg/core.js",
  "wg/marker.js",
  "wg/windsmobi.js",
  "wg/fields.js",
  "wg/qr.js",
  "wg/offline.js",
  "manifest.webmanifest",
  "favicon.ico",
  "icon.svg",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE)
      /* Individually, so one 404 cannot fail the whole install and leave the
         page with no cache at all. */
      .then(function (cache) {
        return Promise.all(ASSETS.map(function (a) {
          return cache.add(new Request(a, { cache: "reload" })).catch(function () {});
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);

  /* THE GUARD. Cross-origin means the providers. Let them through
     untouched, every time, so a reading is always live or visibly absent. */
  if (url.origin !== self.location.origin) return;

  /* XCTrack reloads widget.html with a fresh ?lat=…&lng=… on its refresh
     interval, so entries are keyed on the path alone. Keyed on the full URL
     every position would be a new entry and none would ever hit. */
  var key = new Request(url.origin + url.pathname);

  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(key).then(function (hit) {
        var fresh = fetch(req).then(function (res) {
          if (res && res.ok) cache.put(key, res.clone());
          return res;
        }).catch(function () {
          return hit;                    /* offline: the cache is the answer */
        });

        try { event.waitUntil(fresh); } catch (e) {}
        return hit || fresh;
      });
    })
  );
});
