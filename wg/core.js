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

/* ── density ──────────────────────────────────────────────────────────
   XCTrack's map resolution is fixed in DEVICE pixels, not css pixels. So its
   metres-per-css-pixel scales with devicePixelRatio, and CAL — measured on one
   phone at dpr 3 — has to be scaled to any other device.

   Measured 2026-08-11 with tools/ruler.html, one emulator at two densities,
   reading XCTrack's own scale bar against a css-pixel ruler:

     dpr 2.625  ->  135.1 m/css px  ->  51.5 m/device px
     dpr 2.000  ->  105.9 m/css px  ->  52.9 m/device px

   Constant in device pixels to within 2.8%. A css-fixed model was out by 28%.
   The corrected form reproduces both runs to 2.7% and 0.1%.

   This is computed, never configured: every device is right without the pilot
   doing anything. `cal` remains only as a manual override for a residual. */
var DPR_REF = 3;                          /* the phone CAL was measured on */
var dprAdj = 1, calAdj = 1;

function setDpr(d) {
  dprAdj = (d > 0) ? (DPR_REF / d) : 1;
  return dprAdj;
}
function setCal(v) { calAdj = (v > 0) ? v : 1; return calAdj; }
function getCal() { return CAL * dprAdj * calAdj; }

/* ── XCTrack's scale ladder ────────────────────────────────────────────
   Its map scale is an integer, mapWidget_scale.value, running 12 to 34, and
   ONE STEP IS sqrt(2) IN SCALE — half an OSM zoom level:

       z = (value - 3) / 2

   THE PRINTED LABELS ARE NOT THE LADDER. They come from XCTrack's scale bar,
   which shows the largest "nice" number (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8 x
   10^k) whose bar fits a maximum width of about 0.325 x the widget width. So
   the label list is a property of the SCREEN, not of the scale ladder, and two
   devices print different lists for identical resolutions.

   Verified against two devices, 46 labels, no misses: the owner's phone (448
   css px wide, bar max 145.6) prints 8km where the Pixel 9a (411 css px, bar
   max ~134) prints 6km, from the same step 25 at the same 54.96 m/px.

   A previous version replaced this with an alternating x1.25 / x1.6 ladder,
   fitted to the phone's label list alone. It reproduced that list by
   construction and had no mechanism for the Pixel's — see docs/findings.md.
   Do not re-derive a ladder from a label list; the labels are downstream of
   the screen. ─────────────────────────────────────────────────────────── */
var XCT_LADDER = {
  12:"600km", 13:"500km", 14:"300km", 15:"250km", 16:"150km", 17:"120km",
  18:"80km",  19:"60km",  20:"40km",  21:"30km",  22:"20km",  23:"15km",
  24:"10km",  25:"8km",   26:"5km",   27:"4km",   28:"2500m", 29:"2km",
  30:"1200m", 31:"1km",   32:"600m",  33:"500m",  34:"300m"
};
var XCT_STEP_MIN = 12, XCT_STEP_MAX = 34;

/* Ground distance each label names, in metres. The scale bar draws exactly
   this, so it can be compared against XCTrack's own bar length rather than
   against its text — which is the only check that catches a calibration that
   is off while both labels happen to agree. */
var XCT_METRES = (function () {
  var o = {}, v, t;
  for (v = XCT_STEP_MIN; v <= XCT_STEP_MAX; v++) {
    t = XCT_LADDER[v];
    o[v] = (t.indexOf("km") !== -1) ? parseFloat(t) * 1000 : parseFloat(t);
  }
  return o;
})();
function zoomForStep(v) { return (v - 3) / 2; }
function stepForZoom(z) { return Math.round(z * 2 + 3); }

/* ── what XCTrack will PRINT for a step, on this screen ────────────────
   The bar shows the largest nice number that fits its maximum width. Both
   inputs are knowable at runtime: the widget's own width, and the latitude
   from the position chain. So the widget can name the scale the way the
   pilot's own XCTrack does, instead of parroting one device's list. */
/* RESOLVED. The label lists constrain only the PRODUCT (bar width x
   resolution), so on their own they could not choose between "0.325 x widget
   width" and "a constant ~150 dp with a density-scaled resolution". The ruler
   measured the resolution independently and picked the second: with the density
   law applied, a constant bar reproduces all 46 labels across both devices,
   where a fraction-of-width manages at best 42 and a constant in device pixels
   35. A fixed max length in dp is also simply how an Android widget is written.

   Anything in 147.1..154.3 dp scores 46/46; 150 is the middle. NOT a fitted
   fudge for the resolution — the resolution is measured, and this only has to
   agree with the label lists it was checked against. */
var BAR_MAX_DP = 150;
var NICE = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8];

function niceBelow(x) {
  var best = 0, k, i, v;
  for (k = -1; k < 8; k++) {
    for (i = 0; i < NICE.length; i++) {
      v = NICE[i] * Math.pow(10, k);
      if (v <= x && v > best) best = v;
    }
  }
  return best;
}

/* metres the bar will show, and the text XCTrack prints for it.

   The latitude guard is not decoration: `lat === undefined ? 47 : lat` let a
   null through, Math.cos(null) is 1, and the whole label table came out
   computed at the EQUATOR — one step off, which sent the owner to the wrong
   map scale. Reject anything that is not a real number. */
function scaleMetresAtDpr(step, lat, dpr) {
  var la = (typeof lat === "number" && lat === lat) ? lat : 47;
  var cal = CAL * (dpr > 0 ? DPR_REF / dpr : 1) * calAdj;
  return niceBelow(BAR_MAX_DP * mppOsm(la, zoomForStep(step)) / cal);
}
function scaleMetres(step, lat) {
  return scaleMetresAtDpr(step, lat, dprAdj > 0 ? DPR_REF / dprAdj : DPR_REF);
}
/* XCTrack switches to km only for whole thousands: it prints 1km and 2km but
   1200m and 2500m. Getting this wrong is cosmetic on our side but makes the
   pilot hunt for a label their device never shows. */
function fmtScale(m) {
  if (!m) return "?";
  m = Math.round(m);
  return (m % 1000 === 0) ? ((m / 1000) + "km") : (m + "m");
}
function scaleLabel(step, lat) { return fmtScale(scaleMetres(step, lat)); }

/* ── ground scale -> ladder step, resolved ON THE DEVICE ───────────────
   A ladder step is NOT a scale. The same step is 8km on a dpr-3 phone and 6km
   on a Pixel 9a, because XCTrack draws in device pixels — so a launcher running
   on a laptop cannot know which step a pilot's phone needs, and picking one
   there is guessing. It guessed wrong: step 25 offered as "8km" printed 6km.

   So the pilot picks a GROUND SCALE, which is device-independent, and the step
   is resolved here — on the device, at the real density, at the real latitude.
   Nearest in log space, because the ladder is multiplicative: being a factor
   1.2 out is equally wrong at 300m and at 300km.

   Not every scale exists on every screen — a Pixel 9a has no 8km step at all —
   so asking for one lands on the nearest that does, and the overlay's own bar
   then says what it really is. */
function stepForScale(metres, lat) {
  var best = 25, bestErr = Infinity, v, m, e;
  if (!(metres > 0)) return best;
  for (v = XCT_STEP_MIN; v <= XCT_STEP_MAX; v++) {
    m = scaleMetres(v, lat);
    if (!m) continue;
    e = Math.abs(Math.log(m / metres));
    if (e < bestErr) { bestErr = e; best = v; }
  }
  return best;
}

/* ── what the launcher may offer ───────────────────────────────────────
   Generated from ONE device's ladder, the list is missing scales that other
   devices do print: the reference phone has no 6km step, so a Pixel 9a pilot
   — whose screen shows 6km — could not choose it at all.

   The two failure modes are not symmetric. An option that this pilot's phone
   cannot reach costs nothing, because nobody picks a number their own screen
   never shows; a scale that IS on their screen but missing from the list
   cannot be expressed at all. So offer the union over the densities a phone
   plausibly has, and let resolveStep sort out the rest on the device.

   Union, not a hand-written list of nice numbers: this stays bounded by what
   the ladder can actually produce, so it cannot drift from the ladder.

   BUT NOT ALL THE WAY UP. The full union runs to 1000 km, and past about
   40 km the display stops being complete — winds.mobi caps a query at 500
   stations, and the fetch box grows with the square of the scale. Measured
   2026-08-11 over Interlaken, the densest area we serve:

       scale   fetch box        returned   payload
        8km     65 x   94 km       98       24.0 KB
       15km     90 x  148 km      183       44.6 KB
       30km    139 x  256 km      351       85.7 KB
       40km    180 x  346 km      503      123.2 KB   <-- at the cap
       50km    238 x  473 km      389       95.8 KB   <-- FEWER, from a bigger box
      100km    437 x  906 km      265       66.1 KB
      800km   2284 x 4939 km      478      121.3 KB

   Past the cap a wider scale does not show more, it shows an arbitrary
   thinner sample spread over half a continent — with almost nothing left
   where the pilot is actually flying. That is a correctness problem before
   it is a performance one, so 30 km is the widest the launcher OFFERS.

   `scale` itself is unbounded to its SPEC limits: a URL may still ask for
   anything, and the widget says BOX FULL when the answer came back
   truncated. The list is a recommendation, not a restriction. */
var DPR_SPAN = [1.5, 1.75, 2, 2.25, 2.5, 2.625, 2.75, 3, 3.25, 3.5, 4];
var SCALE_OFFER_MAX = 30000;

function scaleOptions(lat, maxMetres) {
  var seen = {}, out = [], i, v, m;
  var cap = (maxMetres > 0) ? maxMetres : SCALE_OFFER_MAX;
  for (i = 0; i < DPR_SPAN.length; i++) {
    for (v = XCT_STEP_MIN; v <= XCT_STEP_MAX; v++) {
      m = scaleMetresAtDpr(v, lat, DPR_SPAN[i]);
      if (m && m <= cap && !seen[m]) { seen[m] = 1; out.push(m); }
    }
  }
  out.sort(function (a, b) { return b - a; });
  return out;
}

/* `step` is an escape hatch: set explicitly it wins, otherwise the scale
   decides. Anything below 12 is not a ladder step, so it reads as "unset". */
function resolveStep(c, lat) {
  return (c && c.step >= XCT_STEP_MIN) ? c.step : stepForScale(c ? c.scale : 0, lat);
}

/* Integer-zoom labels, derived so the two cannot disagree. */
var XCT_SCALE = (function () {
  var o = {}, z;
  for (z = 5; z <= 15; z++) o[z] = XCT_LADDER[stepForZoom(z)];
  return o;
})();

var R_EARTH   = 6378137;
var EQ_CIRC   = 2 * Math.PI * R_EARTH;      /* 40075016.7 m */
var M_PER_DEG = EQ_CIRC / 360;              /* 111319.49 m per degree of lat */

/* ── SPEC — single source of truth for URL params AND the settings UI ──
   Add a parameter here and it appears in both, already clamped. Never
   hand-write a settings field. `ui:false` means URL-only; `only` marks a
   parameter that applies to one view.

   `grp` decides where the row lands. **A row with NO `grp` is one of the very
   few shown up front** — everything else goes behind the Advanced accordion,
   under its group's heading. That default is the right way round: a new
   parameter should have to argue for the front page, and the front page is
   what a pilot sees before their first flight with this.

   Only two rows are ungrouped today, and both because a wrong answer makes
   the overlay useless rather than merely unpolished: `scale`, which has to
   match XCTrack's own map, and `alt`, which is the one piece of context a
   station name cannot carry. Groups are rendered in first-appearance order,
   so SPEC order is the UI order. ──────────────────────────────────── */
var SPEC = [
  { k:"lat",   t:"num", d:null, ui:false,
    lab:"Latitude",  help:"Overrides the position chain. XCTrack substitutes ${lat}." },
  { k:"lng",   t:"num", d:null, ui:false,
    lab:"Longitude", help:"Overrides the position chain. XCTrack substitutes ${lng}." },

  /* ── shown up front: no `grp` ───────────────────────────────────────
     `help` IS THE PILOT'S TEXT, not ours. One or two short sentences, read
     one-handed on a phone. Everything that explains *why* belongs in a
     comment here or in docs/, where the next developer will look and the
     pilot will not. */

  /* The pilot picks a ground scale because a ladder step is not a scale —
     the same step is 8km on one phone and 6km on another, so a launcher
     running on a laptop cannot know which step to name. resolveStep() does
     it on the device, at the real density and latitude; if that scale has
     no step at all, it lands on the nearest and the overlay's bar says so.
     See docs/findings.md 2026-08-11 and stepForScale() above. */
  { k:"scale", t:"scale", d:8000, min:100, max:2000000,
    lab:"Map scale",
    help:"Set XCTrack's XC map to the same value." },

  { k:"alt",   t:"int", d:0, min:0, max:1, only:"widget",
    lab:"Show station altitude",
    help:"Adds each station's height under its speed." },

  /* ── behind Advanced, by group ────────────────────────────────────── */

  /* `peaks` filters on the network's own flag — never a guess of ours. */
  { k:"peaks", t:"int", d:0, min:0, max:1, grp:"Which stations",
    lab:"Summits only",
    help:"Hides everything the network does not mark as being on a summit." },
  /* Applied AFTER the view cull in prepare(), so on a map it caps what could
     be drawn rather than what happens to fall inside a radius. It was 40,
     which cost half the drawable markers at wide scales — findings 2026-08-11. */
  { k:"max",   t:"int", d:120, min:1, max:400, grp:"Which stations",
    lab:"Most stations at once",
    help:"An upper limit on how many markers are considered. Overlapping ones " +
         "are dropped as well." },
  /* A cache radius, not a display radius: 20 km buys ~30 min of flight at
     40 km/h, so movement never forces a refetch faster than the data
     cadence does. */
  { k:"pad",   t:"int", d:20, min:0, max:60, grp:"Which stations",
    lab:"Extra area fetched (km)",
    help:"Downloads a little beyond the screen, so flying on does not mean " +
         "waiting for a new download." },

  { k:"warn",  t:"int", d:15, min:1, max:120, grp:"How old is too old",
    lab:"Amber after (min)",
    help:"A reading this old is still shown, but marked." },
  { k:"stale", t:"int", d:30, min:5, max:180, grp:"How old is too old",
    lab:"Red after (min)",
    help:"Treat anything red as unknown, not as calm." },
  /* Rule 3 of winds.mobi's terms is "do not overload"; the data itself only
     moves on a ~10 min cadence, so a faster poll costs battery for nothing. */
  { k:"poll",  t:"int", d:600, min:300, max:3600, grp:"How old is too old",
    lab:"Download every (s)",
    help:"Stations report about every 10 minutes. Faster costs battery and " +
         "gets you the same numbers." },

  { k:"bar",   t:"int", d:1, min:0, max:1, only:"widget", grp:"Scale bar",
    lab:"Show scale bar",
    help:"Sits above XCTrack's own bar. Same length means the two maps match." },
  /* Ours has its ticks pointing DOWN and XCTrack's point up, so the two close
     on each other like facing brackets and the ends line up in one glance. */
  { k:"barY",  t:"int", d:46, min:0, max:200, only:"widget", grp:"Scale bar",
    lab:"Scale bar height (px)",
    help:"Moves our bar up or down. Set it once so it sits just above " +
         "XCTrack's, then leave it." },

  /* The exceptions are not negotiable: no position, OFFLINE, ALL STALE and
     BOX FULL are the display admitting it cannot be trusted, and no display
     setting may switch those off. `badge=0` was once inert — see plan.md 3f. */
  { k:"badge", t:"int", d:0, min:0, max:1, only:"widget", grp:"Status line",
    lab:"Show station count",
    help:"A line at the top: how many stations are drawn and how many are old. " +
         "Warnings still appear when this is off." },
  { k:"popup", t:"int", d:30, min:0, max:300, only:"widget", grp:"Interactive mode",
    lab:"Popup timeout (s)",
    help:"Tap a marker to see its last few hours. 0 keeps it open until you " +
         "tap again." },
  /* NOT widget-only: the list expands a row on tap and draws the same trend
     from the same wg/marker.js renderer, so it needs the same setting. `popup`
     stays widget-only — an expanded list row has no reason to time out. */
  { k:"hours", t:"int", d:3, min:1, max:12, grp:"Interactive mode",
    lab:"Trend length (h)",
    help:"How far back the history goes when you tap a station." },
  { k:"zbtn",  t:"int", d:0, min:0, max:1, only:"widget", grp:"Interactive mode",
    lab:"Show zoom buttons",
    help:"A + and − pair for the overlay's own scale." },
  { k:"zpos",  t:"enum", only:"widget", d:"bottom-right", grp:"Interactive mode",
    opts:["bottom-right", "bottom-left", "top-right", "top-left",
          "top-centre", "bottom-centre", "left-centre", "right-centre"],
    lab:"Where the buttons sit",
    help:"Avoid bottom-left and top-left — the scale bar and the status line " +
         "are already there." },
  { k:"zrow",  t:"int", d:0, min:0, max:1, only:"widget", grp:"Interactive mode",
    lab:"Buttons side by side",
    help:"Horizontal instead of stacked, leaving room for XCTrack's own pair " +
         "beside them." },
  { k:"ztap",  t:"int", d:0, min:0, max:1, only:"widget", grp:"Interactive mode",
    lab:"Tap the screen to change scale",
    help:"The top and bottom halves become invisible zoom controls. Off for " +
         "normal use." },

  { k:"size",  t:"int", d:50, min:0, max:100, grp:"Text and colour",
    lab:"Size", help:"Text on the pages, markers on the overlay." },
  { k:"theme", t:"enum", opts:["auto", "dark", "light"], d:"auto", grp:"Text and colour",
    lab:"Theme", help:"Auto follows your phone." },

  /* XCTrack draws its map in DEVICE pixels, so the ground scale of every step
     depends on density. The overlay reads its own and is always right; this
     exists only so a laptop can preview a phone's scale. probe.html and
     tools/ruler.html print the number. NEVER a per-device setting. */
  { k:"dpr",   t:"num", d:0, min:0, max:6, grp:"Calibration — you should not need these",
    lab:"Pixel density override",
    help:"Leave at 0. Only for previewing another phone's scale from this one." },
  /* Residual override on top of the computed correction. If this ever needs
     to move on a real device, that is a finding — re-run tools/ruler.html. */
  { k:"cal",   t:"num", d:1, min:0.5, max:2, only:"widget",
    grp:"Calibration — you should not need these",
    lab:"Scale correction",
    help:"Leave at 1. A last-resort nudge if the two scale bars still disagree." },

  /* NOT widget-only: both pages hide their technical line behind it, and a bug
     report from either one is worth the same. On the overlay it also forces the
     status line to appear whatever `badge` says. */
  { k:"debug", t:"int", d:0, min:0, max:1, grp:"Troubleshooting",
    lab:"Show technical details",
    help:"Adds a line with the position, the scale and what the last download " +
         "returned. Useful when reporting a problem." },

  /* No row anywhere, but kept in URLs and in storage — which is what
     separates `hidden` from `ui:false`, and it is NOT the same thing as the
     Advanced accordion above. Kept for old URLs and for anyone who knows
     exactly which ladder step they want. It stays out of the UI because a
     pinned step silently outranks the scale a pilot just picked. */
  { k:"step",  t:"int", d:0, min:0, max:34, hidden:true,
    lab:"Ladder step override",
    help:"0 = derive from the scale above, which is what you want. A number " +
         "12-34 pins XCTrack's ladder step directly and ignores the scale." }
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
  var v, i;
  if (spec.t === "enum") {
    if (raw === null || raw === undefined) return spec.d;
    for (i = 0; i < spec.opts.length; i++) if (spec.opts[i] === String(raw)) return String(raw);
    return spec.d;                                      /* unknown -> default */
  }
  /* "ladder" is an integer with a label map — clamped exactly like an int.
     Without this it fell through to the raw passthrough below, so ?step=99
     survived unclamped and a URL string stayed a string. */
  if (spec.t === "num" || spec.t === "int" || spec.t === "ladder" ||
      spec.t === "scale") {
    v = toNum(raw);
    if (v !== v) return spec.d;                       /* NaN -> default */
    if (spec.t !== "num") v = Math.round(v);
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
  /* Legacy: early URLs carried an OSM `zoom`. Map it onto the ladder so an
     old link, or one a pilot already saved, keeps working. */
  if (!q.hasOwnProperty("step") && q.hasOwnProperty("zoom")) {
    var z = toNum(q.zoom);
    if (z === z) out.step = clamp({ t:"int", d:25, min:XCT_STEP_MIN, max:XCT_STEP_MAX },
                                  stepForZoom(z));
  }
  return out;
}

/* The zoom the overlay renders at. There was briefly a range around it, for
   following XCTrack's zoom; that is gone — the 2026-08-11 probe established
   that a tap can never reach both the widget and a zoom button, so the overlay
   can never learn that the map zoomed. The scale is fixed by configuration,
   which is what makes it correct by construction. See docs/findings.md. */
function zoomOf(c, lat) { return zoomForStep(resolveStep(c, lat)); }

/* ── a live config object, for the launcher and any settings sheet ────
   `cfg(search)` is the pure parse used by the pages at load. This is the
   mutable one the configurator edits, seeded from the URL and clamped on
   every write so a field cannot hold an out-of-range value. ────────── */
var config = null;

function defaults() {
  var o = {}, i;
  for (i = 0; i < SPEC.length; i++) o[SPEC[i].k] = SPEC[i].d;
  return o;
}
var CFG_KEY = "cfg";

/* Precedence: defaults < stored < URL. The URL wins because a widget URL
   pasted into XCTrack, or a link shared to another pilot, must mean what it
   says regardless of what this device remembered. `opts.store` is opt-in:
   the overlay widget deliberately does NOT read stored settings, since its
   whole configuration arrives in the URL. */
function initConfig(search, opts) {
  config = defaults();
  if (opts && opts.store) {
    var raw = store.get(CFG_KEY), saved, k;
    if (raw) {
      try { saved = JSON.parse(raw); } catch (e) { saved = null; }
      if (saved) for (k in saved) if (saved.hasOwnProperty(k)) setConfig1(k, saved[k]);
    }
  }
  var q = parseQuery(search), i, sp;
  for (i = 0; i < SPEC.length; i++) {
    sp = SPEC[i];
    if (q.hasOwnProperty(sp.k)) config[sp.k] = clamp(sp, q[sp.k]);
  }
  return config;
}

function setConfig1(k, v) {
  var i;
  for (i = 0; i < SPEC.length; i++) {
    if (SPEC[i].k === k) {
      config[k] = clamp(SPEC[i], v);
      /* Choosing a scale means the scale is what you want. Without this, a
         pilot who opened the launcher from an old ?step=NN link could pick a
         new scale, watch the select change, get a URL carrying both — and the
         pinned step would silently win. The step row is hidden, so nothing on
         screen would have explained why the overlay ignored them. */
      if (k === "scale") config.step = 0;
      return true;
    }
  }
  return false;
}
function saveConfig() {
  var o = {}, i, sp;
  for (i = 0; i < SPEC.length; i++) {
    sp = SPEC[i];
    if (sp.ui === false) continue;            /* never persist a position */
    o[sp.k] = config[sp.k];
  }
  store.set(CFG_KEY, JSON.stringify(o));
}
function setConfig(patch) {
  if (!config) initConfig("");
  var k;
  for (k in patch) if (patch.hasOwnProperty(k)) setConfig1(k, patch[k]);
  saveConfig();
  return config;
}
function resetConfig() {
  config = defaults();
  store.del(CFG_KEY);
  return config;
}

/* Only non-default values reach the URL, so a shared link stays short and
   a later change of default reaches everyone who did not override it.

   `opts.placeholders` appends XCTrack's ${lat}/${lng} substitution tokens, and
   a widget URL should always have them. XCTrack fills them with its LAST KNOWN
   position even when there is no GPS fix, whereas getLocation() returns the
   string "null" in that case — so the placeholders are the only source that
   answers before a lock, which is exactly when the pilot is on the ground
   waiting and the screen would otherwise be blank.

   They are appended RAW. Percent-encoding them would leave XCTrack looking for
   a literal it can no longer find, and the widget would silently lose its
   fallback. An unsubstituted token parses to NaN and is ignored, so the chain
   falls through rather than rendering a wrong position. */
function buildUrl(page, opts) {
  if (!config) initConfig("");
  var q = [], i, sp, v;
  for (i = 0; i < SPEC.length; i++) {
    sp = SPEC[i]; v = config[sp.k];
    if (sp.ui === false) continue;              /* lat/lng are handled below */
    if (v === null || v === undefined || v === sp.d) continue;
    q.push(encodeURIComponent(sp.k) + "=" + encodeURIComponent(v));
  }
  if (opts && opts.placeholders) q.push("lat=${lat}", "lng=${lng}");
  return page + (q.length ? "?" + q.join("&") : "");
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
function mppXct(lat, z) { return mppOsm(lat, z) / getCal(); }

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
  var m = (mul === undefined) ? getCal() : mul;
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
   movement never forces a refetch faster than the data cadence does.

   `mul` defaults to getCal(), NOT the raw CAL constant. It used to be CAL,
   which is the dpr-3 value: on a denser screen the real view covers MORE
   ground than CAL predicts, so the box was smaller than the view and the
   edges were never fetched at all. The projector already used getCal(); the
   two disagreeing is exactly how stations went missing off-screen-left.
   Pass padKm 0 and this returns the view rectangle itself — which is what
   prepare()'s `keep` argument wants. */
function bboxAround(fix, z, W, H, padKm, mul) {
  var res = mppOsm(fix.lat, z) / ((mul === undefined) ? getCal() : mul);
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

/* ONE rounding rule, used for the displayed number AND for the band lookup, so
   the two can never disagree. A marker reading "7" in the white band would look
   broken, and a pilot could not tell which of the two to believe.

   Half-up, as the owner specified: 1.4 -> 1, 1.5 -> 2.

   This also retires an open question. The bands were given as integers while
   the providers return one decimal, so a literal reading left 6.4 km/h with no
   colour and the half-open boundaries below were an interpretation. Rounding
   first makes the owner's bands exactly correct as written: `< 7` over integers
   is precisely "up to 6". */
function roundKmh(v) {
  return (v === null || v === undefined || v !== v) ? NaN : Math.round(v);
}

function band(v, bands) {
  var r = roundKmh(v), i;
  if (r !== r) return -1;                                     /* unknown */
  for (i = 0; i < bands.length; i++) if (r < bands[i]) return i;
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
/* Point arrays are the source, so canvas and SVG cannot drift. */
var ARROW_PTS = [[0, -11.75], [9, 11.75], [0, 4.75], [-9, 11.75]];
var LEAF_PTS  = [[0, -11.75], [4, 11.75], [0, 5.75], [-4, 11.75]];

function toPath(pts) {
  var s = "M" + pts[0][0] + "," + pts[0][1], i;
  for (i = 1; i < pts.length; i++) s += " L" + pts[i][0] + "," + pts[i][1];
  return s + " Z";
}
var ARROW = toPath(ARROW_PTS);   /* 18 x 23.5, notch 30% */
var LEAF  = toPath(LEAF_PTS);    /* calm: 8 wide, implies no direction */

/* Concentric stroke widths, widest first. Each band's visible thickness is
   half the difference to the next one in: halo 1.25, near-black 1.75, gust
   2.5 outward from the outline. */
var BANDS = { halo: 11, outer: 8.5, gust: 5, inner: 1 };

/* The viewBox has to clear the ROTATED extent, not the upright one. The
   furthest vertex is a rear corner at hypot(9, 11.75) = 14.80, and the halo
   adds 11/2 = 5.5 on top, so anything under 20.3 clips the corners as the
   arrow turns — which is exactly what happened at 18. */
function reach() {
  var m = 0, i, r;
  for (i = 0; i < ARROW_PTS.length; i++) {
    r = Math.sqrt(ARROW_PTS[i][0] * ARROW_PTS[i][0] + ARROW_PTS[i][1] * ARROW_PTS[i][1]);
    if (r > m) m = r;
  }
  return m + BANDS.halo / 2;
}
var REACH = Math.ceil(reach());             /* 21 */
var VIEWBOX = (-REACH) + " " + (-REACH) + " " + (REACH * 2) + " " + (REACH * 2);

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
   convey. `peaks` filters on the provider's own peak flag.

   `keep` is an optional {s,n,w,e} rectangle applied BEFORE the `max` cut.
   Without it the cut is radial while the screen is a rectangle, so at a
   30 km scale on a 448x978 widget 17 of 40 slots went to stations that
   could never be drawn — and 13 drawable ones were dropped to pay for
   them. A list page wants nearest-regardless and passes nothing; a map
   passes its own view rectangle. Kept as lat/lon so core stays DOM-free
   and the rule stays testable. ─────────────────────────────────────── */
function inBox(st, b) {
  return st.lat >= b.s && st.lat <= b.n && st.lon >= b.w && st.lon <= b.e;
}
function prepare(list, fix, c, now, keep) {
  var out = [], i, st;
  for (i = 0; i < list.length; i++) {
    st = list[i];
    if (c.peaks && !st.peak) continue;
    if (keep && !inBox(st, keep)) continue;
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
  CAL: CAL, DPR_REF: DPR_REF, setCal: setCal, setDpr: setDpr, getCal: getCal,
  XCT_SCALE: XCT_SCALE, SPEC: SPEC, LEVELS: LEVELS,
  XCT_LADDER: XCT_LADDER, XCT_METRES: XCT_METRES,
  BAR_MAX_DP: BAR_MAX_DP, niceBelow: niceBelow,
  scaleMetres: scaleMetres, scaleLabel: scaleLabel, fmtScale: fmtScale,
  stepForScale: stepForScale, resolveStep: resolveStep,
  scaleOptions: scaleOptions, scaleMetresAtDpr: scaleMetresAtDpr,
  SCALE_OFFER_MAX: SCALE_OFFER_MAX,
  XCT_STEP_MIN: XCT_STEP_MIN, XCT_STEP_MAX: XCT_STEP_MAX,
  zoomForStep: zoomForStep, stepForZoom: stepForZoom,
  zoomOf: zoomOf,
  AVG_BANDS: AVG_BANDS, GUST_BANDS: GUST_BANDS, PALETTE: PALETTE,
  STROKE_INNER: STROKE_INNER, STROKE_OUTER: STROKE_OUTER, HALO: HALO,
  ARROW: ARROW, LEAF: LEAF, BANDS: BANDS, VIEWBOX: VIEWBOX, REACH: REACH,
  ARROW_PTS: ARROW_PTS, LEAF_PTS: LEAF_PTS, toPath: toPath,

  cfg: cfg, parseQuery: parseQuery, clamp: clamp, toNum: toNum,
  store: store,
  defaults: defaults, initConfig: initConfig, setConfig: setConfig,
  resetConfig: resetConfig, buildUrl: buildUrl, saveConfig: saveConfig,
  getConfig: function () { if (!config) initConfig(""); return config; },

  position: position, readXCTrack: readXCTrack, setGeoFix: setGeoFix,
  remember: remember,

  mppOsm: mppOsm, mppXct: mppXct, lonToPx: lonToPx, latToPx: latToPx,
  projector: projector, bboxAround: bboxAround,

  dist: dist, bearing: bearing,

  rateAvg: rateAvg, rateGust: rateGust, band: band, roundKmh: roundKmh,
  levelName: levelName, colour: colour,

  ageMin: ageMin, staleness: staleness,
  prepare: prepare, inBox: inBox, attribution: attribution,

  providers: {}
};
})();

if (typeof module !== "undefined" && module.exports) module.exports = WG;
