/* ══════════════════════════════════════════════════════════════════════
   wg/marker.js — draws the marker, to canvas and to SVG.

   Extracted because it was living inside widget.html, where it could not be
   tested or screenshotted on its own. Both renderers read the same point
   arrays and band widths from core.js, so the chips page and the overlay
   cannot drift apart.

   THE CONSTRUCTION, in one place so it is not re-derived:

     One path, drawn as concentric STROKE OUTSETS of decreasing width —
     never a second scaled copy of the shape. Scaling a notched outline
     pinches the gap near the notch and the rim stops reading as a rim.

       halo    white           outermost; keeps a BLACK fill off dark terrain
       outer   near black      keeps a WHITE fill off light terrain
       gust    GUST colour     the rim, from the gust threshold table
       fill    AVERAGE colour  the body, plus a thin dark-grey stroke

     Each band's visible thickness is half the difference to the next one
     in. Neither stroke is decoration: they are what makes the marker
     survive an arbitrary basemap, and the thin inner one is what stops the
     two shapes collapsing into one blob when average and gust land in the
     same band — the common case, the gust table being the average table
     shifted up.

   Points DOWNWIND: providers report a from-bearing, so callers rotate by
   dir + 180. Calm or unknown direction gets the leaf, because at zero wind
   an arrow would invent a direction.
   ═══════════════════════════════════════════════════════════════════ */
(function (WG) {
"use strict";

/* Calm, or no direction to show. Kept here so both renderers and any future one
   agree on when the leaf appears.

   Tested against the ROUNDED values, for the same reason the bands are: a marker
   displaying "0/0" while drawing a directional dart claims a direction it is no
   longer showing a speed for. Whatever the pilot reads, the glyph must agree. */
function isCalm(st) {
  return !(st.dir === st.dir) ||
         (WG.roundKmh(st.avg) === 0 && WG.roundKmh(st.gust) === 0);
}
function ptsFor(st)  { return isCalm(st) ? WG.LEAF_PTS : WG.ARROW_PTS; }
function rotFor(st)  { return isCalm(st) ? 0 : ((st.dir + 180) % 360); }

/* The four bands, outside in. `opts.halo` false drops the halo only. */
function layers(st, opts) {
  var a = WG.colour(st.rAvg), g = WG.colour(st.rGust), B = WG.BANDS, out = [];
  if (!opts || opts.halo !== false) out.push([WG.HALO, B.halo, null]);
  if (!opts || opts.outer !== false) out.push([WG.STROKE_OUTER, B.outer, null]);
  out.push([g.fill, B.gust, null]);
  out.push([WG.STROKE_INNER, B.inner, a.fill]);   /* fill comes with the last */
  return out;
}

/* ── canvas ───────────────────────────────────────────────────────── */

function trace(g, pts, cx, cy, rot, scale) {
  var r = rot * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r), i, x, y, px, py;
  g.beginPath();
  for (i = 0; i < pts.length; i++) {
    x = pts[i][0] * scale; y = pts[i][1] * scale;
    px = cx + x * cos - y * sin; py = cy + x * sin + y * cos;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
}

function drawCanvas(g, st, x, y, scale, opts) {
  var L = layers(st, opts), i;
  g.lineJoin = "round"; g.lineCap = "round";
  trace(g, ptsFor(st), x, y, rotFor(st), scale);
  for (i = 0; i < L.length; i++) {
    if (L[i][2]) { g.fillStyle = L[i][2]; g.fill(); }   /* fill under the last stroke */
    g.strokeStyle = L[i][0];
    g.lineWidth = L[i][1] * scale;
    g.stroke();
  }
}

/* The avg/gust pair, BELOW the marker and never rotating with it, with a
   white casing so it survives over airspace lines, roads and water. The
   number is mandatory at every size: the scale's middle is a hue-only
   cluster, invisible to a significant fraction of male pilots, and yellow is
   lighter than green so there is no luminance ramp to fall back on. */
function labelText(st) {
  return fmt(st.avg) + "/" + fmt(st.gust);
}
/* Whole km/h. Goes through the same rounding as the band lookup in core.js, so
   the number and the colour always tell the same story. */
function fmt(v) { var r = WG.roundKmh(v); return (r !== r) ? "—" : r; }

function labelCanvas(g, st, x, y, scale, fs) {
  var t = labelText(st);
  g.font = "700 " + fs + "px ui-monospace, 'Roboto Mono', monospace";
  g.textAlign = "center"; g.textBaseline = "top";
  g.lineJoin = "round";
  var ly = y + WG.REACH * scale - 1;
  g.strokeStyle = "#FFFFFF"; g.lineWidth = Math.max(3, fs * 0.34);
  g.strokeText(t, x, ly);
  /* a stale reading announces itself in the number too, not only the badge */
  g.fillStyle = (st.stale && st.stale.cls === "stale") ? "#B3160E" : "#0A1116";
  g.fillText(t, x, ly);
  return ly;
}

/* Station altitude, a second line under the speed.

   Offerable at all only because it is a FACT the provider supplies — no
   inference, no interpolation. And it is the fact this whole tool exists for:
   a station NAME cannot tell a pilot who does not fly the area whether a
   reading came from a valley floor or a 2900 m ridge, which is precisely the
   gap on-terrain markers fill.

   Smaller, lighter in weight and slate rather than near-black, so the hierarchy
   reads at a glance: the speed is still the thing you see first. That ordering
   is not cosmetic — the speed is the mandatory fallback for the rating scale's
   hue-only middle, and nothing may compete with it.

   The unit is included. A bare number sitting under another bare number invites
   being read as more wind, and 2900 would be a spectacular misreading. */
function altText(st) {
  var a = st ? st.alt : null;
  return (typeof a === "number" && isFinite(a)) ? (Math.round(a) + "m") : "";
}

/* Height it adds below the label, so the caller can widen its collision box by
   exactly this and no more. Same arithmetic as the draw, in one place. */
function altSize(fs) { return Math.max(8, Math.round(fs * 0.78)); }

function altCanvas(g, st, x, labelY, fs) {
  var t = altText(st);
  if (!t) return labelY;
  var af = altSize(fs), ay = labelY + fs + 1;
  g.font = "600 " + af + "px ui-monospace, 'Roboto Mono', monospace";
  g.textAlign = "center"; g.textBaseline = "top";
  g.lineJoin = "round";
  g.strokeStyle = "#FFFFFF"; g.lineWidth = Math.max(3, af * 0.34);
  g.strokeText(t, x, ay);
  g.fillStyle = "#3A4A56";
  g.fillText(t, x, ay);
  return ay + af;
}

/* ── svg ──────────────────────────────────────────────────────────────
   Same layers, same order. Used by app.html's chips, where a handful of
   static markers are cheaper as elements than as canvases. */
function svg(st, px, opts) {
  var d = WG.toPath(ptsFor(st)), L = layers(st, opts), i, s;
  s = '<svg viewBox="' + WG.VIEWBOX + '"' +
      (opts && opts.cls ? ' class="' + opts.cls + '"' : "") +
      (px ? ' width="' + px + '" height="' + px + '"' : "") +
      ' aria-hidden="true"><g transform="rotate(' + rotFor(st).toFixed(1) +
      ')" stroke-linejoin="round" stroke-linecap="round">';
  for (i = 0; i < L.length; i++) {
    s += '<path d="' + d + '" fill="' + (L[i][2] || "none") +
         '" stroke="' + L[i][0] + '" stroke-width="' + L[i][1] + '"/>';
  }
  return s + "</g></svg>";
}

/* ── laying out markers that will not all fit ─────────────────────────
   Pure arithmetic, no DOM, so tools/test-core.js exercises it directly. Given
   projected positions it returns where each marker should actually be drawn.

   WHAT A MARKER OCCUPIES, and why it is two boxes and not one. A single
   rectangle sized to the whole thing is what made the first two versions push
   markers so far: it had to be as wide as the LABEL and as tall as the arrow
   plus the label plus the altitude line, so any escape cost ~50 px whichever
   way it went. In fact a marker is an arrow with a narrow column of text
   hanging below it, and the gap between two of them is mostly empty:

       arrow   x +- box*ARROW_TOL,  y +- box*ARROW_TOL
       text    x +- labelW/2,       y + box-1 .. y + box-1 + textH

   Two markers conflict if any of those four rectangles cross. So a marker can
   be placed DIAGONALLY very close indeed — the arrows overlap a little and the
   two text columns sit at different heights, which is exactly what the eye
   needs and nothing more.

   ARROW_TOL < 1 is the owner's "even if they overlap a tad is not an issue".
   The TEXT boxes are never allowed to touch anything: the number is the
   fallback for a colour scale many pilots cannot separate, so it is the one
   thing that may not be covered — not by another number, and not by an arrow.

   A NUDGED MARKER NEVER PUSHES ANOTHER ONE. Anchors — the highest-priority
   member of each cluster — are all placed FIRST, at their true positions, in
   one pass over every cluster. Only then is anything displaced. So a marker
   that has been moved can never take territory a marker that has not been
   moved was going to use. Two anchors cannot conflict with each other by
   construction: if they did, they would be one cluster.

   ORDER WITHIN A CLUSTER, owner's rule:
     stale readings go to the bottom, whatever their altitude
     everything fresher is equal priority, and the HIGHEST STATION IS ON TOP
   So a stack reads as a vertical profile of the valley — which is the point,
   since 1648 m and 2600 m 390 m apart is the whole question in a valley wind.

   AT MOST `maxPerCluster` (3) ARE DRAWN. Past three, a pile stops being
   readable and the extras are dropped rather than shuffled somewhere they
   would be read as a different station's reading. ─────────────────────── */
var ARROW_TOL = 0.72;              /* arrows may overlap by about a quarter */

function prioOf(it) {
  return (it.stale === "stale") ? 2 : (it.stale === "warn" ? 1 : 0);
}

function layout(items, o) {
  var box = o.box || 20;
  var aw = box * ARROW_TOL;                 /* arrow half-extent, tolerant */
  var dtw = (o.labelW || box * 2) / 2;      /* fallback text half-width */
  var t0 = box - 1;                         /* label top, as labelCanvas draws */
  var t1 = t0 + (o.textH || box);
  var maxPer = o.maxPerCluster || 3;
  var n = items.length, i, j, out = [], placed = [];

  /* PER MARKER, because "3/7" is barely half the width of "14/22" and using
     the widest possible label for everyone was costing about 10 px of needless
     displacement on every short one. The caller measures its own text. */
  function twOf(it) { return (it.tw > 0) ? it.tw : dtw; }

  function cross(a0, a1, b0, b1) { return a0 < b1 && b0 < a1; }
  function boxes(x, y, tw) {
    return [[x - aw, y - aw, x + aw, y + aw],       /* arrow */
            [x - tw, y + t0, x + tw, y + t1]];      /* text */
  }
  function conflict(ax, ay, atw, bx, by, btw) {
    var A = boxes(ax, ay, atw), B = boxes(bx, by, btw), p, q;
    for (p = 0; p < 2; p++)
      for (q = 0; q < 2; q++)
        if (cross(A[p][0], A[p][2], B[q][0], B[q][2]) &&
            cross(A[p][1], A[p][3], B[q][1], B[q][3])) return true;
    return false;
  }
  function free(x, y, tw) {
    var k;
    if (o.inBounds && !o.inBounds(x, y)) return false;
    if (o.blocked && o.blocked(x, y)) return false;
    for (k = 0; k < placed.length; k++)
      if (conflict(x, y, tw, placed[k][0], placed[k][1], placed[k][2])) return false;
    return true;
  }

  /* Candidates on rings of increasing radius, so the FIRST hit is the closest
     placement there is — not the closest entry someone remembered to add to a
     hand-written list. Angles are measured from straight down and never exceed
     90 degrees, so dy >= 0 and a marker is never pushed above its own true
     position; the priority floor below handles the rest of the ordering.
     Diagonals come first at a given radius because that is where the two text
     columns land at different heights, which is what lets them sit close. */
  var ANG = [45, -45, 30, -30, 60, -60, 90, -90, 0];
  var STEP = Math.max(2, box * 0.28), RMAX = (t1 + box) * 2.2;
  var CAND = [], r, a, rad;
  for (r = STEP; r <= RMAX; r += STEP)
    for (a = 0; a < ANG.length; a++) {
      rad = ANG[a] * Math.PI / 180;
      CAND.push([r * Math.sin(rad), r * Math.cos(rad)]);
    }

  /* clusters: connected components of "these two conflict where they really
     are", so membership is a fact about the stations, not about the layout */
  var parent = [];
  for (i = 0; i < n; i++) parent[i] = i;
  function find(a2) { while (parent[a2] !== a2) { parent[a2] = parent[parent[a2]]; a2 = parent[a2]; } return a2; }
  for (i = 0; i < n; i++)
    for (j = i + 1; j < n; j++)
      if (conflict(items[i].x, items[i].y, twOf(items[i]),
                   items[j].x, items[j].y, twOf(items[j]))) {
        var ra = find(i), rb = find(j);
        if (ra !== rb) parent[rb] = ra;
      }

  /* Grouped in first-appearance order, and `items` arrives nearest-first, so
     the nearest cluster gets first pick of the screen. */
  var groups = [], byRoot = {}, root;
  for (i = 0; i < n; i++) {
    root = find(i);
    if (byRoot[root] === undefined) { byRoot[root] = groups.length; groups.push([]); }
    groups[byRoot[root]].push(i);
  }

  for (i = 0; i < groups.length; i++) {
    groups[i].sort(function (a2, b2) {
      var pa = prioOf(items[a2]), pb = prioOf(items[b2]);
      if (pa !== pb) return pa - pb;                  /* stale sinks */
      var aa = items[a2].alt, ab = items[b2].alt;     /* then highest on top */
      var na = !(aa === aa), nb = !(ab === ab);       /* no altitude sorts last */
      if (na !== nb) return na ? 1 : -1;
      if (!na && aa !== ab) return ab - aa;
      return a2 - b2;                                 /* else nearest first */
    });
  }

  function put(idx, x, y, moved) {
    placed.push([x, y, twOf(items[idx])]);
    out.push({ i: idx, x: x, y: y, tx: items[idx].x, ty: items[idx].y, moved: moved });
  }

  /* ── pass A: every anchor, before anything is displaced ── */
  var anchored = [];
  for (i = 0; i < groups.length; i++) {
    var top = groups[i][0];
    if (o.blocked && o.blocked(items[top].x, items[top].y)) { anchored[i] = false; continue; }
    if (o.inBounds && !o.inBounds(items[top].x, items[top].y)) { anchored[i] = false; continue; }
    put(top, items[top].x, items[top].y, false);
    anchored[i] = true;
  }

  /* ── pass B: the rest, closest free spot ── */
  for (i = 0; i < groups.length; i++) {
    var g = groups[i], drawn = anchored[i] ? 1 : 0;
    /* THE PRIORITY FLOOR. Candidates all have dy >= 0, which stops a marker
       being pushed above its OWN true position — but that is not the rule. The
       rule is about the arrangement: a stale reading goes to the bottom of the
       cluster, and it may well start out above everything else. So a marker of
       strictly lower priority is forbidden from landing above any higher-
       priority one already placed. Equal priority may sit level, which is what
       lets a same-tier pair go side by side at the cheapest distance. */
    var floorY = anchored[i] ? items[g[0]].y : -Infinity;
    var floorPrio = anchored[i] ? prioOf(items[g[0]]) : -1;
    for (j = anchored[i] ? 1 : 0; j < g.length; j++) {
      if (drawn >= maxPer) break;                     /* a pile of four is lost */
      var it = items[g[j]], p = prioOf(it);
      var lim = (p > floorPrio) ? floorY + 1 : -Infinity;
      var px = 0, py = 0, got = false, c, cx, cy;
      var tw = twOf(it);
      if (it.y >= lim && free(it.x, it.y, tw)) { px = it.x; py = it.y; got = true; }
      else if (o.nudge) {
        for (c = 0; c < CAND.length; c++) {
          cx = it.x + CAND[c][0]; cy = it.y + CAND[c][1];
          if (cy >= lim && free(cx, cy, tw)) { px = cx; py = cy; got = true; break; }
        }
      }
      if (!got) continue;                             /* nowhere to put it */
      put(g[j], px, py, px !== it.x || py !== it.y);
      /* floorY is the running maximum over everything placed in this cluster;
         floorPrio the lowest priority tier reached so far. Together they mean
         "the next tier down starts below all of this". */
      if (py > floorY) floorY = py;
      if (p > floorPrio) floorPrio = p;
      drawn++;
    }
  }
  return out;
}

/* ── leader line, for a marker that had to be moved ───────────────────
   The overlay nudges a marker DOWN when it would overlap one already placed,
   rather than dropping the reading — see draw() in widget.html. This is what
   keeps that honest: the line says the marker is not where it is drawn, and the
   dot says where it really is.

   Drawn from the true point down to just above the moved marker, cased in white
   like everything else on that canvas, because it has to survive snow, rock and
   an airspace edge. It belongs here rather than in the page so tools/nudge.html
   judges the same drawing the widget makes.

   The CALLER must draw every leader before any marker: a line that has to cross
   a speed number must be hidden behind it, not scribbled over it. Painting each
   marker as it was placed put the next line straight through the previous
   marker's number — caught by screenshotting it, not by reading it. */
function leader(g, tx, ty, x, y, box) {
  var dx = x - tx, dy = y - ty, len = Math.sqrt(dx * dx + dy * dy);
  if (!len) return;
  /* Stop short of the marker along the line's own direction, so a sideways or
     diagonal displacement is trimmed the same way a vertical one is. */
  var back = Math.min(box * 0.55, len * 0.45);
  var ex = x - dx / len * back, ey = y - dy / len * back;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(tx, ty);
  g.lineTo(ex, ey);
  g.strokeStyle = "#FFFFFF"; g.lineWidth = 3.4; g.stroke();
  g.strokeStyle = "#3A4A56"; g.lineWidth = 1.4; g.stroke();
  g.beginPath(); g.arc(tx, ty, 3.1, 0, 6.2832);
  g.fillStyle = "#FFFFFF"; g.fill();
  g.beginPath(); g.arc(tx, ty, 1.9, 0, 6.2832);
  g.fillStyle = "#3A4A56"; g.fill();
}

/* How pale a moved marker's ARROW is drawn. The number and the altitude stay at
   full strength: the number is the fallback for a colour scale a lot of pilots
   cannot separate, so it never pays for the annotation. 0.6 applied to the whole
   marker was measured as marginal against dark forest. */
var NUDGE_ALPHA = 0.6;

/* ── the trend strip ──────────────────────────────────────────────────
   Recent history as a row of small markers, oldest left. Purely descriptive —
   the same measured values, over time — so it breaks no rule, and it answers
   the one question a single reading cannot: is this building or easing?

   Lives here rather than in a page because BOTH the overlay's popup and the
   list's expanded row draw it, and two copies of "which colour does 22 km/h
   get" is exactly the drift this file exists to prevent. It returns the strip's
   inner HTML; each page owns the container and its CSS. The class names are
   part of the contract — `.t`, `.wait`, and `em`/`span` inside `.t`.

   The loading and error states are in here too, because "no history for this
   station" is a fact about the data and both pages must say it the same way.
   ─────────────────────────────────────────────────────────────────── */
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function hhmm(ts) {
  var d = new Date(ts);
  return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
}

/* samples: oldest-first, from the provider's normaliseHistoric. `null` means
   still loading — an empty array means the station has no history, which is a
   different thing and must not read as a spinner that never finishes. */
function trendHtml(samples, opts) {
  var o = opts || {}, px = o.size || 34, i, s, h = "";
  if (o.err) return '<span class="wait">No history: ' + esc(o.err) + '</span>';
  if (!samples) return '<span class="wait">Loading…</span>';
  if (!samples.length) return '<span class="wait">This station keeps no history.</span>';
  for (i = 0; i < samples.length; i++) {
    s = samples[i];
    h += '<div class="t">' +
         svg({ dir:s.dir, avg:s.avg, gust:s.gust,
               rAvg:WG.rateAvg(s.avg), rGust:WG.rateGust(s.gust) }, px) +
         '<em>' + labelText(s) + '</em>' +
         '<span>' + hhmm(s.ts) + '</span></div>';
  }
  return h;
}

/* Scroll the strip to the NEWEST sample, and mark it when the oldest end is
   cut off.

   Oldest-left reads naturally but puts the newest sample — the one actually
   wanted — off the right edge: three hours of MeteoSwiss ten-minute samples is
   eighteen cells, far more than a phone is wide, so scrolling is inherent, not
   a layout mistake to design away.

   The subtle part is what that does to the left edge. Scrolled fully right, the
   leftmost visible cell is cut mid-width, and a clipped time does not look
   clipped — it looks like bad data. The first strip drawn showed "5:00" where
   the value was 15:00. Snapping to a cell boundary cannot fix it: the two edges
   can only both align when the viewport is an exact multiple of the cell pitch,
   and if one of them has to be cut it must be the oldest sample, never the
   newest. So the fade says so instead. `cut` is set only while there is
   something hidden to the left, because a permanent fade would dim a cell that
   is in fact fully visible. */
function trendScroll(el) {
  if (!el) return;
  var max = el.scrollWidth - el.clientWidth;
  el.scrollLeft = (max > 0) ? max : 0;
  if (!el.getAttribute("data-bound")) {
    el.setAttribute("data-bound", "1");
    el.addEventListener("scroll", function () { trendCut(el); });
  }
  trendCut(el);
}
function trendCut(el) {
  var cut = el.scrollLeft > 2, has = / cut\b/.test(" " + el.className);
  if (cut !== has) el.className = cut ? (el.className + " cut")
                                     : el.className.replace(/\s*\bcut\b/, "");
}

WG.marker = {
  isCalm: isCalm, pts: ptsFor, rot: rotFor, layers: layers,
  canvas: drawCanvas, trace: trace,
  label: labelCanvas, labelText: labelText, fmt: fmt,
  alt: altCanvas, altText: altText, altSize: altSize,
  svg: svg, trendHtml: trendHtml, trendScroll: trendScroll,
  leader: leader, layout: layout,
  NUDGE_ALPHA: NUDGE_ALPHA, ARROW_TOL: ARROW_TOL,
  hhmm: hhmm, esc: esc
};

})(typeof WG !== "undefined" ? WG : (module.exports = require("./core.js")));
