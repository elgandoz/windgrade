/* ══════════════════════════════════════════════════════════════════════
   wg/offline.js — service worker registration.

   Kept out of core.js, which has no side effects by design. Every failure
   path is swallowed on purpose: an old Android WebView with no service
   worker, or an XCTrack build that refuses to register one, must still get
   a working page. Offline is an enhancement here, never a dependency —
   and it only ever covers the app shell, never a wind reading. See sw.js.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
"use strict";

if (!navigator.serviceWorker) return;

/* Service workers need a secure context; file:// and plain http never
   qualify, which is also why a LAN address cannot be used for testing. */
if (location.protocol !== "https:" &&
    location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;

window.addEventListener("load", function () {
  try { navigator.serviceWorker.register("sw.js").catch(function () {}); } catch (e) {}
});

})();
