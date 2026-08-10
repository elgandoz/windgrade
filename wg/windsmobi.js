/* ═══════════════════════════════════════════════════════════════════════
   wg/windsmobi.js — winds.mobi provider.

   Aggregates 13 networks behind one CORS-open, key-free API: SLF,
   MeteoSwiss, Holfuy, OpenWindMap/Pioupiou, Windline and more. Measured at
   ~18 KB for 72 stations across six networks in the densest part of
   Switzerland. See docs/findings.md.

   Normalises to the shape core.js and the pages expect:
     {id, name, short, lat, lon, alt, dir, avg, gust, ts, peak, status,
      provider, url}

   TERMS OF USE (from the OpenAPI spec, quoted because one is a problem):
     1. "Always identify your calls ... by setting a user-agent HTTP header"
     2. "Do not monetize your service using winds.mobi data in any way"
     3. "Do not overload this server by minimizing your number of calls.
         Get data for multiple stations at once."
     "Any IP or service that doesn't respect these rules will be
      blacklisted without any notice."  — Yann, info@winds.mobi

   Rule 1 CANNOT be honoured from a browser: User-Agent is a forbidden
   header name in the Fetch spec, so any attempt to set it is dropped. The
   automatic Origin header does identify the deployment. Asking Yann whether
   that suffices is an open action, deferred by the owner pending
   feasibility — do not paper over it, and do not try to spoof the header.

   Rules 2 and 3 we meet: one bounding-box call per ~10 minutes.
   ═══════════════════════════════════════════════════════════════════════ */
(function (WG) {
"use strict";

var BASE = "https://winds.mobi/api/2/stations/";

/* Only the fields we render. The default key set also returns temp, hum,
   rain and pressure, which we never draw — trimming measured 23.4 KB down
   to 17.9 KB. NOTE: `keys` must be REPEATED parameters; the
   comma-separated form is a validation error. */
var KEYS = ["name", "short", "alt", "peak", "status", "pv-name", "loc",
            "last._id", "last.w-dir", "last.w-avg", "last.w-max"];

var LIMIT_MAX = 500;

function url(bbox, opts) {
  var q = [], i;
  q.push("within-pt1-lat=" + bbox.s.toFixed(5));
  q.push("within-pt1-lon=" + bbox.w.toFixed(5));
  q.push("within-pt2-lat=" + bbox.n.toFixed(5));
  q.push("within-pt2-lon=" + bbox.e.toFixed(5));
  q.push("limit=" + Math.min(opts && opts.limit ? opts.limit : LIMIT_MAX, LIMIT_MAX));

  /* Server-side staleness filter. Cheaper than downloading readings we
     would only discard — but it does NOT replace our own clock, because a
     station inside the window can still be too old to trust. */
  if (opts && opts.maxAgeSec) q.push("last-measure=" + Math.round(opts.maxAgeSec));

  /* Collapses stations at the same place. Real decluttering still has to
     happen at render time, and must evict whole markers — never an arrow
     without its number. */
  q.push("is-highest-duplicates-rating=true");

  for (i = 0; i < KEYS.length; i++) q.push("keys=" + encodeURIComponent(KEYS[i]));
  return BASE + "?" + q.join("&");
}

/* XMLHttpRequest rather than fetch: it is ES5, universally present, and
   needs no Promise polyfill on an old WebView. */
function get(u, cb) {
  var x;
  try { x = new XMLHttpRequest(); } catch (e) { cb("no XMLHttpRequest"); return; }
  var done = false;
  function finish(err, body) { if (done) return; done = true; cb(err, body); }

  x.open("GET", u, true);
  x.timeout = 20000;
  x.onreadystatechange = function () {
    if (x.readyState !== 4) return;
    if (x.status >= 200 && x.status < 300) finish(null, x.responseText);
    else finish("HTTP " + (x.status || "0 (blocked or offline)"));
  };
  x.ontimeout = function () { finish("timeout"); };
  x.onerror   = function () { finish("network error"); };
  try { x.send(); } catch (e) { finish("send failed: " + e.message); }
}

/* winds.mobi gives WGS84 in GeoJSON order [lon, lat], km/h for both wind
   fields, altitude in metres, a documented `peak` boolean, and a unix
   timestamp. No projection maths and no unit conversion — which is most of
   why it displaced going direct to MeteoSwiss, whose feed is EPSG:2056 and
   needs two endpoints. */
function normalise(raw) {
  var out = [], i, s, c, last;
  for (i = 0; i < raw.length; i++) {
    s = raw[i];
    c = s.loc && s.loc.coordinates;
    if (!c || c.length < 2) continue;
    last = s.last || {};

    out.push({
      id:       s._id,
      name:     s.name || s.short || s._id,
      short:    s.short || s.name || s._id,
      lat:      +c[1],
      lon:      +c[0],
      alt:      (s.alt === null || s.alt === undefined) ? NaN : +s.alt,
      dir:      (last["w-dir"] === undefined || last["w-dir"] === null) ? NaN : +last["w-dir"],
      avg:      (last["w-avg"] === undefined || last["w-avg"] === null) ? NaN : +last["w-avg"],
      gust:     (last["w-max"] === undefined || last["w-max"] === null) ? NaN : +last["w-max"],
      ts:       last._id ? +last._id * 1000 : NaN,   /* unix seconds -> ms */
      peak:     !!s.peak,
      status:   s.status || "unknown",
      provider: s["pv-name"] || "winds.mobi",
      url:      s.url && (s.url["default"] || s.url.en) || null
    });
  }
  return out;
}

WG.providers.windsmobi = {
  id: "windsmobi",
  label: "winds.mobi",
  /* Attribution is owed to the source networks, not only the aggregator —
     each record carries pv-name, so the pages build the list per fetch. */
  aggregator: "winds.mobi",

  buildUrl: url,
  normalise: normalise,

  /* fetchBBox(bbox, opts, cb) -> cb(err, stations, meta) */
  fetchBBox: function (bbox, opts, cb) {
    var u = url(bbox, opts || {}), t0 = Date.now();
    get(u, function (err, body) {
      if (err) return cb(err, null, { url:u });
      var j;
      try { j = JSON.parse(body); }
      catch (e) { return cb("unparseable JSON", null, { url:u }); }

      /* The API returns a bare array on success and an object on a
         validation error — so an object here means we built a bad query. */
      if (!j || !j.length) {
        if (j && j.detail) return cb("API rejected the query", null, { url:u, detail:j.detail });
        return cb(null, [], { url:u, ms:Date.now() - t0, bytes:body.length });
      }
      cb(null, normalise(j), { url:u, ms:Date.now() - t0, bytes:body.length, count:j.length });
    });
  }
};

})(typeof WG !== "undefined" ? WG : (module.exports = { providers:{} }));
