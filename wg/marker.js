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
   Pure arithmetic, no DOM, so tools/test-core.js exercises it directly.

   COST. draw() only runs when its key changes — position quantised to a whole
   device pixel, the widget size, the ladder step, the last fetch, or the
   minute. A glider at 40 km/h crosses one pixel every ~5 s at 8 km scale and
   ~2 s at 3 km scale; parked, the minute term fires once a minute. So this runs
   at roughly 0.5 Hz in the air and 1/min on the ground, not per frame. It is
   still written to stay cheap: phase 1 is the plain greedy pass, and the ring
   search in phase 2 only runs for markers that did not fit and only compares
   against neighbours inside a bounded radius.

   ── the two phases ──────────────────────────────────────────────────
   1. PLACE NORMALLY, nearest first, exactly as if nudging were off. Whatever
      fits at its true position is drawn there, unfaded. Everything else is
      hidden — and hidden is where the interesting part starts.

   2. For each hidden marker, try to put it back on screen:
      a. RING SEARCH. Stay at a small fixed radius from where it really is —
         close is the whole point — and rotate: score every angle and take the
         one that sits FURTHEST from the markers already there. Overlapping
         arrows are accepted; a covered NUMBER is not, so an angle is only
         eligible if its text stays clear.
      b. If no angle at any tried radius keeps the text clear, STACK IT BELOW
         the marker it collided with, fading by depth.

   NOTHING FADES. Every marker is drawn at full strength, moved or not — the
   LEADER LINE is the annotation, and it is unambiguous where a fade was not:
   two attempts at tying opacity to displacement and then to actual overlap both
   produced markers that were paler for reasons a pilot could not read off the
   screen. At most `maxPerCluster` markers end up in one pile.

   A DISPLACED MARKER NEVER PUSHES ONE THAT WAS NOT. Every normal placement is
   finished in phase 1, before anything is moved. Displaced markers do join the
   obstacle set afterwards, so two of them cannot land on the same spot.

   NOTE: this pass deliberately does NOT sort by altitude or staleness. Phase 1
   is plain nearest-first, so the nearest station of a pair keeps its true
   position. The earlier "highest on top, stale to the bottom" ordering was
   dropped at the owner's request while this placement is evaluated.
   ─────────────────────────────────────────────────────────────────── */
var ARROW_TOL = 0.6;             /* arrows may overlap by about 40% */
/* THE ONE BOUND, and everything else derives from it: no marker may be drawn
   further than MAX_ROWS stack rows from where it really is. Past that a reading
   is filed under the wrong ridge and is better omitted than misplaced.

   The ring radii are GENERATED up to that bound rather than hand-written, which
   is what stops the two halves drifting apart — and they had. The ring stopped
   at 3.0 reaches (58 px) while the stack routinely landed at 106-195 px, so the
   FALLBACK WAS TWO TO THREE TIMES WORSE than the thing it fell back from.
   Measured at Zermatt, scale 30000: every ring placement in that scene was
   <= 58 px and every stack placement >= 106 px, which is what "the stations at
   the bottom are so far apart" was. */
var MAX_ROWS = 1;
var RING_FROM = 1.15;              /* first radius, in marker reaches */
var RING_GAP = 0.6;                /* gap between radii, same units */
var RING_ANGLES = 16;

function layout(items, o) {
  var box = o.box || 20;
  var aw = box * ARROW_TOL;                 /* arrow half-extent, tolerant */
  var dtw = (o.labelW || box * 2) / 2;      /* fallback text half-width */
  var t0 = box - 1;                         /* label top, as labelCanvas draws */
  var th = (o.textH || box);
  var t1 = t0 + th;
  var maxPer = o.maxPerCluster || 3;
  var n = items.length, i, j, out = [], placed = [];
  /* One stack row, and the furthest anything may ever be moved. */
  var step = t1 + aw, maxMove = step * MAX_ROWS;

  /* THE EXACT REACH OF conflict(), on each axis separately, so both the
     neighbourhood scan and conflict() itself can reject a distant pair with two
     comparisons instead of twelve.

     They are genuinely different: in y a marker reaches t1 + aw, the bottom of
     its text plus an arrow's half-height (~55 px); in x only the wider of two
     text columns or two arrows (~40 px). One NEAR for both axes was sized by
     the y reach and so scanned a band 1.7x wider than anything in x could ever
     touch. These are upper bounds on when any of the four rectangle tests can
     fire, so rejecting outside them is exact, not a heuristic. */
  var maxTw = 0;
  for (i = 0; i < n; i++) {
    j = (items[i].tw > 0) ? items[i].tw : dtw;
    if (j > maxTw) maxTw = j;
  }
  var XMAX = Math.max(2 * maxTw, maxTw + aw, 2 * aw);
  var YMAX = t1 + aw;
  var NEARX = XMAX + maxMove, NEARY = YMAX + maxMove;
  /* Radii, closest first, generated up to the same bound the stack uses. */
  var RING = [], rr;
  for (rr = box * RING_FROM; rr <= maxMove; rr += box * RING_GAP) RING.push(rr);

  /* PER MARKER, because "3/7" is barely half the width of "14/22" and using
     the widest possible label for everyone was costing about 10 px of needless
     displacement on every short one. The caller measures its own text. */
  function twOf(it) { return (it.tw > 0) ? it.tw : dtw; }

  function cross(a0, a1, b0, b1) { return a0 < b1 && b0 < a1; }

  /* THE RULE, owner's words: "allow the arrow to partially overlap, but do not
     allow to overlap the labels (which include altitude)".

     So there are two different tolerances, and getting them the same way round
     is the whole game:

       ARROWS may overlap, but only PARTIALLY. `aw` is the arrow's half-extent
       scaled by ARROW_TOL, so two centres must stay 2*aw apart — anything
       closer and one arrow swallows the other. Letting them overlap without
       limit was measured as too cluttered.

       LABELS may not be overlapped BY ANYTHING — not by another label, not by
       an arrow. `t0..t1` spans the speed line and the altitude line together,
       because the owner counts both as the label. This is the constraint that
       sets how close two markers can get, and it should be: the number is the
       fallback for a colour scale many pilots cannot separate. */
  function conflict(ax, ay, atw, bx, by, btw) {
    /* Cheap exact reject first. Most of the neighbourhood is far enough away
       that none of the four tests below can possibly fire, and this is the
       difference between two comparisons and twelve on every one of them. */
    var qx = ax - bx; if (qx < 0) qx = -qx;
    if (qx >= XMAX) return false;
    var qy = ay - by; if (qy < 0) qy = -qy;
    if (qy >= YMAX) return false;
    /* label vs label */
    if (cross(ax - atw, ax + atw, bx - btw, bx + btw) &&
        cross(ay + t0, ay + t1, by + t0, by + t1)) return true;
    /* label vs the other's arrow, both ways */
    if (cross(ax - atw, ax + atw, bx - aw, bx + aw) &&
        cross(ay + t0, ay + t1, by - aw, by + aw)) return true;
    if (cross(bx - btw, bx + btw, ax - aw, ax + aw) &&
        cross(by + t0, by + t1, ay - aw, ay + aw)) return true;
    /* arrow vs arrow, tolerated up to ARROW_TOL */
    return cross(ax - aw, ax + aw, bx - aw, bx + aw) &&
           cross(ay - aw, ay + aw, by - aw, by + aw);
  }
  function free(x, y, tw) {
    var k;
    if (o.inBounds && !o.inBounds(x, y)) return false;
    if (o.blocked && o.blocked(x, y)) return false;
    for (k = 0; k < placed.length; k++)
      if (conflict(x, y, tw, placed[k][0], placed[k][1], placed[k][2])) return false;
    return true;
  }

  function put(idx, x, y, moved, depth) {
    placed.push([x, y, twOf(items[idx]), placed.length]);
    out.push({ i: idx, x: x, y: y, tx: items[idx].x, ty: items[idx].y,
               moved: moved, depth: depth || 0 });
  }

  /* ── phase 1: exactly what nudge=0 draws ── */
  var hidden = [];
  for (i = 0; i < n; i++) {
    if (free(items[i].x, items[i].y, twOf(items[i]))) put(i, items[i].x, items[i].y, false, 0);
    else if (!(o.blocked && o.blocked(items[i].x, items[i].y)) &&
             !(o.inBounds && !o.inBounds(items[i].x, items[i].y))) hidden.push(i);
  }
  var nPlaced = placed.length;               /* everything up to here is fixed */

  /* Neighbours worth scoring against — a bounded set, so the ring search stays
     cheap however many markers are on screen.

     IT INCLUDES MARKERS NOT YET PLACED, at their true positions. Without that,
     a marker searching for room sees only what has already been drawn and
     moves happily into the spot a later one is about to need. Measured at
     Zermatt, scale 12000: ZFC: Blauherd went 54 px SOUTH onto Gornergratsee's
     true position, which had not been placed yet, and Gornergratsee then had to
     move 47 px itself. North was empty the whole time. */
  var pending = [];

  /* ONE NEIGHBOURHOOD PER HIDDEN MARKER, not one per candidate.

     Every candidate for a marker lies within `maxMove` of its true position,
     and nothing further than NEARX/NEARY from that position can reach any of
     them — those bounds include maxMove for exactly this reason. So the set
     computed once at the true position is a superset of what all 48 candidates
     would each have computed for themselves.

     It was per candidate. Measured over 118 markers in one call: 3,875 nearby()
     calls scanning 287,823 entries and allocating 3,875 arrays, against 87
     calls and ~7,000 entries now. Filled into a REUSED buffer, so a draw
     allocates nothing here at all.

     The set includes markers NOT YET PLACED, at their true positions. Without
     that, a marker searching for room sees only what has already been drawn and
     moves happily into the spot a later one is about to need — measured at
     Zermatt scale 12000, ZFC: Blauherd went 54 px south onto Gornergratsee's
     true position and Gornergratsee then had to move 47 px itself. */
  var nearBuf = [], nearN = 0;
  function scanNear(x, y) {
    var k;
    nearN = 0;
    for (k = 0; k < placed.length; k++)
      if (Math.abs(placed[k][0] - x) < NEARX && Math.abs(placed[k][1] - y) < NEARY)
        nearBuf[nearN++] = placed[k];
    for (k = 0; k < pending.length; k++)
      if (Math.abs(pending[k][0] - x) < NEARX && Math.abs(pending[k][1] - y) < NEARY)
        nearBuf[nearN++] = pending[k];
  }
  function hitsNear(x, y, tw) {
    var k;
    for (k = 0; k < nearN; k++)
      if (conflict(x, y, tw, nearBuf[k][0], nearBuf[k][1], nearBuf[k][2])) return true;
    return false;
  }

  /* How far apart, as a fraction of the distance at which they would touch.
     >= 1 means clear. Normalised because the interaction is anisotropic: a
     marker is much taller than it is wide once its text is counted. */
  function roominess(x, y, tw) {
    var k, best = Infinity, p, dx, dy, s;
    for (k = 0; k < nearN; k++) {
      p = nearBuf[k];
      dx = Math.abs(x - p[0]); dy = Math.abs(y - p[1]);
      s = Math.max(dx / (tw + p[2]), dy / (th + aw));
      if (s < best) best = s;
    }
    return best;
  }

  /* Which already-drawn marker did this one collide with? Only used to key the
     pile so `maxPerCluster` can count it. Reads the same neighbourhood, and
     `p[3]` is the marker's slot in `placed` — phase-1 markers are the ones
     below nPlaced. */
  function hostOf(it, tw) {
    var k, p, best = -1, bd = Infinity, d;
    for (k = 0; k < nearN; k++) {
      p = nearBuf[k];
      if (!(p[3] < nPlaced)) continue;
      if (!conflict(it.x, it.y, tw, p[0], p[1], p[2])) continue;
      d = Math.abs(it.x - p[0]) + Math.abs(it.y - p[1]);
      if (d < bd) { bd = d; best = p[3]; }
    }
    return best;
  }

  /* A stack step that leaves the number ALONE. t1 is the bottom of the text and
     aw the arrow's half-height, so this is exactly the point where the lower
     marker's arrow stops touching the upper marker's number. Arrows may overlap
     each other — text may not, and the stack is no exception. */
  var depthAt = {};

  /* NOTHING BELOW THIS LINE RUNS WITH NUDGING OFF, which is the default — so
     the early return is the whole point of it, not tidiness. Everything from
     here on serves phase 2 only: measured 44.5 us with nudging off against
     711.9 us with it on, over 118 markers, so the ring search is 94% of the
     cost and a pilot who has not asked for it pays none of that.

     The `pending` seeding used to sit OUTSIDE the gate, allocating one array
     per hidden marker — about 87 of them per draw at Zermatt scale 30000 — for
     a loop that then never ran. */
  if (!o.nudge) return out;

  /* Seeded with every hidden marker's true position and drained as each is
     placed, so the scoring always knows about the ones still to come. */
  for (i = 0; i < hidden.length; i++)
    pending.push([items[hidden[i]].x, items[hidden[i]].y, twOf(items[hidden[i]])]);
  for (i = 0; i < hidden.length; i++) {
    pending.shift();                          /* this one is being placed now */
    var it = items[hidden[i]], tw = twOf(it);
    scanNear(it.x, it.y);                     /* once, for every candidate below */
    var host = hostOf(it, tw);
    var key = (host < 0) ? "-" : String(host);
    var depth = (depthAt[key] || 0) + 1;
    if (depth >= maxPer) continue;             /* a pile of four is lost */

    /* (a) ring search: closest radius that keeps every number readable, and at
       that radius the angle furthest from everything already drawn. */
    var got = false, bx = 0, by = 0, ri, ai, ang, cx, cy, sc, bestSc;
    for (ri = 0; ri < RING.length && !got; ri++) {
      var R = RING[ri];
      bestSc = -1;
      for (ai = 0; ai < RING_ANGLES; ai++) {
        ang = (ai / RING_ANGLES) * Math.PI * 2;
        cx = it.x + R * Math.sin(ang);
        cy = it.y + R * Math.cos(ang);
        if (o.inBounds && !o.inBounds(cx, cy)) continue;
        if (o.blocked && o.blocked(cx, cy)) continue;
        if (hitsNear(cx, cy, tw)) continue;     /* a label would be covered */
        sc = roominess(cx, cy, tw);
        if (sc > bestSc) { bestSc = sc; bx = cx; by = cy; got = true; }
      }
    }

    /* (b) nowhere rotationally: straight down, a row at a time, FROM ITS OWN
       POSITION rather than the host's. Anchoring to the host and multiplying by
       depth compounded — Mottec's host sat 85 px BELOW it and a depth-2 stack
       then added 110 px on top, putting a station 195 px from where it was
       measured. Rows from the marker's own place are bounded by construction,
       and since the pile collided in the first place they still land together. */
    for (ri = 1; ri <= MAX_ROWS && !got; ri++) {
      bx = it.x; by = it.y + step * ri;
      if (o.inBounds && !o.inBounds(bx, by)) continue;
      if (o.blocked && o.blocked(bx, by)) continue;
      if (!hitsNear(bx, by, tw)) got = true;
    }
    if (!got) continue;

    put(hidden[i], bx, by, true, depth);
    depthAt[key] = depth;
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
  leader: leader, layout: layout, ARROW_TOL: ARROW_TOL,
  hhmm: hhmm, esc: esc
};

})(typeof WG !== "undefined" ? WG : (module.exports = require("./core.js")));
