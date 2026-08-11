/* ═══════════════════════════════════════════════════════════════════════
   wg/windsmobi.js — winds.mobi provider.

   Aggregates 13 networks behind one CORS-open, key-free API: SLF,
   MeteoSwiss, Holfuy, OpenWindMap/Pioupiou, Windline and more. Measured at
   ~18 KB for 72 stations across six networks in the densest part of
   Switzerland. See docs/findings.md.

   Normalises to the shape core.js and the pages expect:
     {id, name, place, short, lat, lon, alt, dir, avg, gust, ts, peak,
      status, provider, url}
   `name` is the station owner's own name and `place` the geocoded
   municipality when it differs — see normalise(), the two are swapped
   relative to what the API calls them.

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

/* The API's own documented ceiling ("Nb stations to return (max=500)"), and
   it is a HARD truncation with no documented ordering — ask for a box with
   more than 500 stations and you silently get some 500 of them. Measured
   2026-08-11: a 143x265 km Piedmont box holds 161, a 190x267 km Swiss box
   309-356, so a wide scale over the densest Alps can reach it. We always
   ask for the maximum and REPORT when the answer came back at the ceiling
   (meta.capped) rather than pretend the set is complete. Splitting the box
   into several calls would trade one silent failure for a breach of "do not
   overload"; the honest move is to say so. */
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
   needs two endpoints.

   NAMES ARE THE OTHER WAY ROUND FROM WHAT THE FIELD NAMES SUGGEST. For
   openwindmap.org — 63 of 161 stations in a Piedmont sample, the largest
   single network there — `name` is a GEOCODED MUNICIPALITY and `short` is
   the name the station's owner gave it:

       name "Valgioie"          short "Decollo TRUCETTI 980m"
       name "Ciciu del Villar"  short "Décollo Liretta Paradeltaclub Cuneo"

   A pilot searching for Trucetti finds "Valgioie" and concludes the station
   is missing. So the owner's name is what we call `name`, and the geocoded
   place is carried alongside as `place` when it says something different.
   For ffvl, holfuy, slf and meteoswiss the two fields are identical and
   `place` comes out empty. Whitespace is squeezed because several records
   carry trailing spaces and non-breaking spaces ("Baouroux 1600m "). */
function txt(v) {
  if (typeof v !== "string") return "";
  return v.replace(/[\s\u00A0]+/g, " ").replace(/^ +| +$/g, "");
}

function normalise(raw) {
  var out = [], i, s, c, last, owner, place;
  for (i = 0; i < raw.length; i++) {
    s = raw[i];
    c = s.loc && s.loc.coordinates;
    if (!c || c.length < 2) continue;
    last = s.last || {};
    owner = txt(s.short);
    place = txt(s.name);

    out.push({
      id:       s._id,
      name:     owner || place || s._id,
      place:    (place && place !== owner) ? place : "",
      short:    owner || place || s._id,
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

/* ── history, for the detail popup ────────────────────────────────────
   GET /stations/{id}/historic/?duration=<seconds>. Returns a plain array,
   NEWEST FIRST — the pages want oldest-first for a left-to-right trend, so
   normalise() reverses it rather than leaving every caller to remember.

   Measured: ~550 bytes for 2 h of MeteoSwiss (10 min cadence), ~970 for
   Holfuy (6-8 min). Fetched on demand when a popup opens, never prefetched
   for every station — that would be one call per marker and would breach
   "do not overload" for data nobody asked to see. */
function historicUrl(id, opts) {
  var q = [], i, hk = ["_id", "w-dir", "w-avg", "w-max"];
  q.push("duration=" + Math.round((opts && opts.duration) || 7200));
  for (i = 0; i < hk.length; i++) q.push("keys=" + encodeURIComponent(hk[i]));
  return BASE + encodeURIComponent(id) + "/historic/?" + q.join("&");
}

function normaliseHistoric(raw) {
  var out = [], i, m;
  for (i = 0; i < raw.length; i++) {
    m = raw[i];
    if (!m || !m._id) continue;
    out.push({
      ts:   +m._id * 1000,
      dir:  (m["w-dir"] === undefined || m["w-dir"] === null) ? NaN : +m["w-dir"],
      avg:  (m["w-avg"] === undefined || m["w-avg"] === null) ? NaN : +m["w-avg"],
      gust: (m["w-max"] === undefined || m["w-max"] === null) ? NaN : +m["w-max"]
    });
  }
  out.sort(function (a, b) { return a.ts - b.ts; });    /* oldest first */
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
  historicUrl: historicUrl,
  normaliseHistoric: normaliseHistoric,

  /* fetchHistoric(stationId, opts, cb) -> cb(err, samples) oldest-first */
  fetchHistoric: function (id, opts, cb) {
    var u = historicUrl(id, opts || {});
    get(u, function (err, body) {
      if (err) return cb(err);
      var j;
      try { j = JSON.parse(body); } catch (e) { return cb("unparseable JSON"); }
      if (!j || !j.length) return cb(null, []);
      cb(null, normaliseHistoric(j));
    });
  },

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
      cb(null, normalise(j), { url:u, ms:Date.now() - t0, bytes:body.length,
                               count:j.length, capped:j.length >= LIMIT_MAX });
    });
  }
};

})(typeof WG !== "undefined" ? WG : (module.exports = { providers:{} }));
