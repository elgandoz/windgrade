/* ═══════════════════════════════════════════════════════════════════════
   wg/core.js — the engine.

   Touches no DOM and renders nothing. It hands pages a state object; pages
   only draw. That is what keeps the widget and the standalone page from
   drifting apart, and it is why this file can be exercised in node.

   Plain ES5, no modules, no build step. Old Android WebViews.
   Copied in spirit from hx-call's hx/core.js, not coupled to it.
   ═══════════════════════════════════════════════════════════════════════ */
var WG = (function () {
"use strict";

/* ── measured calibration ─────────────────────────────────────────────
   XCTrack's map scale is a RESOLUTION on an exact power-of-two ladder,
   but it is not on integer OSM zoom levels — it runs 1.062x coarser.
   Verified at three ladder steps against airspace edges, 2026-08-10.
   See docs/findings.md. Do not re-derive; do not "simplify" to 1.0.

   The km labels XCTrack prints are ROUNDED and must never be used to
   compute geometry: 15/8 = 1.875, yet those two settings measure exactly
   one zoom level apart. ────────────────────────────────────────────── */
var CAL = 0.942;

/* label shown to the pilot so a mis-paired widget is visible, not silent */
var XCT_SCALE = { 5:"500km", 6:"250km", 7:"120km", 8:"60km", 9:"30km",
                  10:"15km", 11:"8km", 12:"4km", 13:"2km", 14:"1km", 15:"500m" };

var R_EARTH   = 6378137;
var EQ_CIRC   = 2 * Math.PI * R_EARTH;      /* 40075016.7 m */
var M_PER_DEG = EQ_CIRC / 360;              /* 111319.49 m per degree of lat */

/* ── SPEC — single source of truth for URL params AND the settings UI ──
   Add a parameter here and it appears in both, already clamped. Never
   hand-write a settings field. `ui:false` means URL-only; `only` marks a
   parameter that applies to one view. ─────────────────────────────── */
var SPEC = [
  { k:"lat",   t:"num", d:null, ui:false,
    lab:"Latitude",  help:"Overrides the position chain. XCTrack substitutes ${lat}." },
  { k:"lng",   t:"num", d:null, ui:false,
    lab:"Longitude", help:"Overrides the position chain. XCTrack substitutes ${lng}." },

  { k:"zoom",  t:"int", d:11, min:5, max:15,
    lab:"Map zoom",
    help:"Pair with XCTrack's map scale. 15km=10, 8km=11, 4km=12." },
  { k:"pad",   t:"int", d:20, min:0, max:60,
    lab:"Fetch margin (km)",
    help:"Area fetched beyond the view. A cache radius, not a display radius." },
  { k:"max",   t:"int", d:40, min:1, max:200,
    lab:"Max stations" },
  { k:"peaks", t:"int", d:0, min:0, max:1,
    lab:"Summits only",
    help:"Provider-supplied fact, not a guess." },

  { k:"warn",  t:"int", d:15, min:1, max:120,
    lab:"Warn after (min)" },
  { k:"stale", t:"int", d:30, min:5, max:180,
    lab:"Stale after (min)",
    help:"Older readings go visibly red. Never silently shown as current." },
  { k:"poll",  t:"int", d:600, min:300, max:3600,
    lab:"Fetch interval (s)",
    help:"Readings update about every 10 min. Do not poll faster." },

  { k:"size",  t:"int", d:50, min:0, max:100,
    lab:"Size", help:"Font scale, windspion convention." },
  { k:"badge", t:"int", d:1, min:0, max:1, only:"widget",
    lab:"Show calibration badge",
    help:"States the assumed zoom so a mis-paired map is visible." }
];

/* ── config parsing ───────────────────────────────────────────────── */

/* An unsubstituted XCTrack placeholder arrives as the literal "${lat}".
   It must be ignored, not parsed, so the position chain falls through to
   the next source rather than rendering a wrong position. */
function toNum(v) {
  if (v === null || v === undefined || v === "") return NaN;
  if (typeof v === "string" && v.indexOf("${") !== -1) return NaN;
  var f = parseFloat(v);
  return isFinite(f) ? f : NaN;
}

function clamp(spec, raw) {
  var v;
  if (spec.t === "num" || spec.t === "int") {
    v = toNum(raw);
    if (v !== v) return spec.d;                       /* NaN -> default */
    if (spec.t === "int") v = Math.round(v);
    if (spec.min !== undefined && v < spec.min) v = spec.min;
    if (spec.max !== undefined && v > spec.max) v = spec.max;
    return v;
  }
  return (raw === null || raw === undefined) ? spec.d : raw;
}

function parseQuery(search) {
  var out = {}, s = String(search || "").replace(/^\?/, ""), parts, i, kv;
  if (!s) return out;
  parts = s.split("&");
  for (i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    kv = parts[i].split("=");
    try { out[decodeURIComponent(kv[0])] = decodeURIComponent((kv[1] || "").replace(/\+/g, " ")); }
    catch (e) { out[kv[0]] = kv[1] || ""; }
  }
  return out;
}

function cfg(search) {
  var q = parseQuery(search), out = {}, i;
  for (i = 0; i < SPEC.length; i++) {
    out[SPEC[i].k] = clamp(SPEC[i], q.hasOwnProperty(SPEC[i].k) ? q[SPEC[i].k] : null);
  }
  return out;
}

/* ── guarded localStorage ─────────────────────────────────────────────
   Load-bearing: with ${lat}/${lng} substitution XCTrack reloads the whole
   page periodically, and this is what carries state across. ────────── */
var store = {
  get: function (k) { try { return localStorage.getItem("wg." + k); } catch (e) { return null; } },
  set: function (k, v) { try { localStorage.setItem("wg." + k, String(v)); } catch (e) {} },
  del: function (k) { try { localStorage.removeItem("wg." + k); } catch (e) {} }
};

/* ── position chain ───────────────────────────────────────────────────
   XCTrack.getLocation() -> URL params -> browser geolocation -> last known.

   getLocation() is a PULL api returning a JSON string or the literal
   "null", gated on "Allow web page to access XCTrack data". Hence polling.
   A stale fix (isValid false) is still used: terrain does not move, so
   remembering a POSITION is safe. Remembering a READING is not. ────── */
function readXCTrack() {
  var raw, o;
  try {
    if (typeof XCTrack === "undefined") return { err:"no XCTrack object" };
    if (typeof XCTrack.getLocation !== "function") return { err:"no getLocation()" };
    raw = XCTrack.getLocation();
  } catch (e) { return { err:"threw: " + e.message }; }

  if (raw === null || raw === "null") return { err:"null (no fix)", raw:"null" };
  try { o = (typeof raw === "string") ? JSON.parse(raw) : raw; }
  catch (e) { return { err:"unparseable", raw:String(raw).slice(0, 110) }; }
  if (!o || typeof o !== "object") return { err:"not an object", raw:String(raw).slice(0, 110) };

  var la = toNum(o.lat), lo = toNum(o.lon);
  if (la !== la || lo !== lo) return { err:"no lat/lon", raw:String(raw).slice(0, 110) };

  return { fix: {
    lat: la, lon: lo,
    alt:  toNum(o.altGps),        /* GPS altitude, ellipsoidal */
    baro: toNum(o.stdBaroAlt),    /* PRESSURE altitude vs 1013.25 — not MSL */
    hdg:  toNum(o.heading),
    brg:  toNum(o.bearingGps),
    valid: o.isValid !== false,
    src: (o.isValid === false) ? "xctrack-stale" : "xctrack"
  } };
}

function fromParams(c) {
  if (c.lat === null || c.lng === null) return null;
  var la = toNum(c.lat), lo = toNum(c.lng);
  if (la !== la || lo !== lo) return null;
  return { lat:la, lon:lo, src:"url", valid:true };
}

function fromStore() {
  var s = store.get("lastfix");
  if (!s) return null;
  var p = String(s).split(","), la = toNum(p[0]), lo = toNum(p[1]);
  if (la !== la || lo !== lo) return null;
  return { lat:la, lon:lo, alt:toNum(p[2]), src:"stored", valid:false,
           at: toNum(p[3]) };
}

function remember(f) {
  if (!f) return;
  store.set("lastfix", [f.lat.toFixed(6), f.lon.toFixed(6),
                        (f.alt === f.alt ? Math.round(f.alt) : ""), Date.now()].join(","));
}

/* geoFix is filled by a watchPosition the page starts; core stays DOM-free
   and never touches navigator itself beyond this setter. */
var geoFix = null;
function setGeoFix(f) { geoFix = f; if (f) remember(f); }

function position(c) {
  var x = readXCTrack();
  if (x.fix) { remember(x.fix); return { fix:x.fix, note:x.raw || "ok" }; }

  var p = fromParams(c);
  if (p) { remember(p); return { fix:p, note:x.err }; }
  if (geoFix) return { fix:geoFix, note:x.err };

  var s = fromStore();
  if (s) return { fix:s, note:x.err };
  return { fix:null, note:x.err };
}

/* ── projection ───────────────────────────────────────────────────────
   Two resolutions, deliberately separate:
     mppXct — for the Phase 3b overlay. Includes the calibration, because
              it must agree with XCTrack's renderer.
     mppOsm — for our own basemap in Phase 3. Plain Web Mercator.
   Using the wrong one puts every marker in the wrong place. ───────── */
function mppOsm(lat, z) {
  return EQ_CIRC * Math.cos(lat * Math.PI / 180) / (256 * Math.pow(2, z));
}
function mppXct(lat, z) { return mppOsm(lat, z) / CAL; }

/* World pixel coordinates at zoom z, 256px tiles, CSS pixels. */
function lonToPx(lon, z) { return (lon + 180) / 360 * 256 * Math.pow(2, z); }
function latToPx(lat, z) {
  var s = Math.sin(lat * Math.PI / 180);
  if (s >  0.9999) s =  0.9999;
  if (s < -0.9999) s = -0.9999;
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * Math.pow(2, z);
}

/* A projector centred on `fix`, for a W x H CSS-pixel canvas. `mul` folds
   in the calibration (pass CAL for an XCTrack overlay, 1 for our own map). */
function projector(fix, z, W, H, mul) {
  var m = (mul === undefined) ? CAL : mul;
  var cx = lonToPx(fix.lon, z), cy = latToPx(fix.lat, z);
  return {
    res: mppOsm(fix.lat, z) / m,
    x: function (lon) { return (lonToPx(lon, z) - cx) * m + W / 2; },
    y: function (lat) { return (latToPx(lat, z) - cy) * m + H / 2; }
  };
}

/* ── geo helpers ──────────────────────────────────────────────────────
   Equirectangular with a cached cos(lat). hx-call measured 0.5% worst case
   across Swiss test points — far below the error already inherent in the
   task, and much cheaper than haversine. Ranking only; the overlay uses
   the Mercator projector above because it must match a tile projection. */
function dist(lat1, lon1, lat2, lon2) {
  var k = Math.cos((lat1 + lat2) * 0.5 * Math.PI / 180);
  var dy = (lat2 - lat1) * M_PER_DEG;
  var dx = (lon2 - lon1) * M_PER_DEG * k;
  return Math.sqrt(dx * dx + dy * dy);
}
function bearing(lat1, lon1, lat2, lon2) {
  var k = Math.cos((lat1 + lat2) * 0.5 * Math.PI / 180);
  var dy = (lat2 - lat1) * M_PER_DEG;
  var dx = (lon2 - lon1) * M_PER_DEG * k;
  var b = Math.atan2(dx, dy) * 180 / Math.PI;
  return (b + 360) % 360;
}

/* Bounding box for a fetch: the visible area plus a margin in km. The
   margin is a CACHE radius — 20 km buys ~30 min of flight at 40 km/h, so
   movement never forces a refetch faster than the data cadence does. */
function bboxAround(fix, z, W, H, padKm, mul) {
  var res = mppOsm(fix.lat, z) / ((mul === undefined) ? CAL : mul);
  var halfW = (W / 2) * res + padKm * 1000;
  var halfH = (H / 2) * res + padKm * 1000;
  var dLat = halfH / M_PER_DEG;
  var dLon = halfW / (M_PER_DEG * Math.cos(fix.lat * Math.PI / 180));
  return { s: fix.lat - dLat, n: fix.lat + dLat,
           w: fix.lon - dLon, e: fix.lon + dLon };
}

/* ── the rating scale ─────────────────────────────────────────────────
   Owner-supplied, burnair-style, six levels, km/h. AVERAGE and GUST use
   TWO DIFFERENT tables — the gust bands sit 8-10 km/h higher, and that
   offset is what makes a hotter rim mean something. A single shared table
   could carry no signal, since gusts always exceed the average.

   Boundaries are half-open because the bands as given are integers while
   the data has decimals: winds.mobi returns 20.9, and "up to 6" / "7-14"
   would otherwise leave 6.4 with no colour. Each band's lower integer is
   the strict boundary. Flagged as an interpretation in docs/handover.md,
   not something the owner stated. ──────────────────────────────────── */
var AVG_BANDS  = [7, 15, 25, 31, 37];
var GUST_BANDS = [15, 25, 33, 39, 45];
var LEVELS = ["white", "green", "yellow", "orange", "red", "black"];

function band(v, bands) {
  if (v === null || v === undefined || v !== v) return -1;   /* unknown */
  for (var i = 0; i < bands.length; i++) if (v < bands[i]) return i;
  return bands.length;                                        /* black */
}
function rateAvg(v)  { return band(v, AVG_BANDS); }
function rateGust(v) { return band(v, GUST_BANDS); }

/* Fill is the average's colour, rim is the gust's. Both strokes are
   structural, not decoration: the near-black outer keeps a WHITE fill
   legible on light terrain, and the halo keeps a BLACK fill legible on
   dark terrain. The thin inner stroke is what stops the two shapes
   collapsing into one blob when average and gust land in the same band —
   which is the common case, the gust table being the average table
   shifted up. */
var PALETTE = {
  white:  { fill:"#DCE4EA", ink:"#0A1116" },
  green:  { fill:"#31A85A", ink:"#FFFFFF" },
  yellow: { fill:"#EFCB1F", ink:"#0A1116" },
  orange: { fill:"#EE8A1C", ink:"#0A1116" },
  red:    { fill:"#D62A20", ink:"#FFFFFF" },
  black:  { fill:"#14181C", ink:"#FFFFFF" },
  unknown:{ fill:"#7B909F", ink:"#0A1116" }
};
var STROKE_INNER = "#3A4750";   /* dark grey, innermost  */
var STROKE_OUTER = "#0A1116";   /* near black */
var HALO         = "#FFFFFF";   /* outside the outer stroke */

/* ── marker geometry ──────────────────────────────────────────────────
   A broad swept dart: apex forward, trailing edge notched inward so the
   rear corners sweep back. Tune these two strings and everything that
   draws a marker follows; tools/arrow.svg is the editable copy.

   CENTRED ON (0,0) ON PURPOSE. The first version spanned y -15..11, so
   its bounding-box centre sat at y=-2 while rotation happened about the
   origin — the arrow visibly orbited a point above itself. Keep the
   vertical extents symmetric or that returns.

   Rendered by STROKE OUTSET, not by drawing a second scaled copy. Scaling
   a notched shape uniformly pinches the gap near the notch and the rim
   stops looking like a rim; concentric strokes of decreasing width give an
   even border. Draw order is halo, near-black, gust colour, then the
   average fill with a thin inner stroke on top.

   The strokes inflate width and length by the same absolute amount, so they
   push a narrow shape towards square: 18x23.5 here renders as roughly 29x35
   once the 11-wide halo is on. Aim the base path slimmer than the look you
   want.

   WIDTH IS A TRADE AGAINST THE RIM, and it bites hard. The gust stroke is
   centred on the outline, so half of it eats inward, and the average fill is
   whatever interior survives. At 14 wide with a 6.5 rim the fill collapsed to
   0.25 units near the middle — the primary channel reduced to a sliver. 18
   wide with a 5 rim leaves 2.3 there and 5.4 towards the rear, which reads as
   a fill with a border rather than the reverse. Narrow the dart further only
   if the rim narrows with it. ─────────────────────────────────────────── */
var ARROW = "M0,-11.75 L9,11.75 L0,4.75 L-9,11.75 Z"; /* 18 x 23.5, notch 30% */
var LEAF  = "M0,-11.75 L4,11.75 L0,5.75 L-4,11.75 Z"; /* calm: 8 wide, no direction */

/* Concentric stroke widths, widest first. Each band's visible thickness is
   half the difference to the next one in: halo 1.25, near-black 1.75, gust
   2.5 outward from the outline. */
var BANDS = { halo: 11, outer: 8.5, gust: 5, inner: 1 };
var VIEWBOX = "-18 -18 36 36";              /* fits the widest stroke */

function levelName(i) { return (i < 0) ? "unknown" : LEVELS[i]; }
function colour(i)    { return PALETTE[levelName(i)]; }

/* ── staleness ────────────────────────────────────────────────────────
   This tool cannot work offline for readings, only for terrain. Old wind
   shown confidently is the main way it could hurt someone, so age is
   always available and always classified. Provider `status` is a separate
   axis: it says the instrument is misbehaving, while age says the number
   is old. Both are facts; surface both. ───────────────────────────── */
function ageMin(ts, now) {
  if (!ts || ts !== ts) return NaN;
  return ((now || Date.now()) - ts) / 60000;
}
function staleness(st, c, now) {
  var a = ageMin(st.ts, now);
  if (a !== a) return { age:NaN, cls:"stale", why:"no timestamp" };
  if (a >= c.stale) return { age:a, cls:"stale", why:"older than " + c.stale + " min" };
  if (a >= c.warn)  return { age:a, cls:"warn",  why:"older than " + c.warn + " min" };
  return { age:a, cls:"fresh", why:"" };
}

/* ── ranking ──────────────────────────────────────────────────────────
   Horizontal distance. Delta-altitude weighting was withdrawn by the
   owner (see plan.md "Altitude — downgraded"); the station's own altitude
   is still shown as a fact, and terrain position is what Phase 3/3b
   convey. `peaks` filters on the provider's own peak flag. ────────── */
function prepare(list, fix, c, now) {
  var out = [], i, st;
  for (i = 0; i < list.length; i++) {
    st = list[i];
    if (c.peaks && !st.peak) continue;
    st.dist = fix ? dist(fix.lat, fix.lon, st.lat, st.lon) : NaN;
    st.brg  = fix ? bearing(fix.lat, fix.lon, st.lat, st.lon) : NaN;
    st.rAvg  = rateAvg(st.avg);
    st.rGust = rateGust(st.gust);
    st.stale = staleness(st, c, now);
    out.push(st);
  }
  out.sort(function (a, b) {
    if (a.dist !== a.dist) return 1;
    if (b.dist !== b.dist) return -1;
    return a.dist - b.dist;
  });
  return out.slice(0, c.max);
}

/* Distinct provider names, for the attribution line. Owed to the networks,
   not only to the aggregator. */
function attribution(list) {
  var seen = {}, out = [], i, p;
  for (i = 0; i < list.length; i++) {
    p = list[i].provider;
    if (p && !seen[p]) { seen[p] = 1; out.push(p); }
  }
  out.sort();
  return out;
}

return {
  CAL: CAL, XCT_SCALE: XCT_SCALE, SPEC: SPEC, LEVELS: LEVELS,
  AVG_BANDS: AVG_BANDS, GUST_BANDS: GUST_BANDS, PALETTE: PALETTE,
  STROKE_INNER: STROKE_INNER, STROKE_OUTER: STROKE_OUTER, HALO: HALO,
  ARROW: ARROW, LEAF: LEAF, BANDS: BANDS, VIEWBOX: VIEWBOX,

  cfg: cfg, parseQuery: parseQuery, clamp: clamp, toNum: toNum,
  store: store,

  position: position, readXCTrack: readXCTrack, setGeoFix: setGeoFix,
  remember: remember,

  mppOsm: mppOsm, mppXct: mppXct, lonToPx: lonToPx, latToPx: latToPx,
  projector: projector, bboxAround: bboxAround,

  dist: dist, bearing: bearing,

  rateAvg: rateAvg, rateGust: rateGust, band: band,
  levelName: levelName, colour: colour,

  ageMin: ageMin, staleness: staleness,
  prepare: prepare, attribution: attribution,

  providers: {}
};
})();

if (typeof module !== "undefined" && module.exports) module.exports = WG;
