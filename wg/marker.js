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

   OPACITY IS FOR ACTUAL OVERLAP, not for displacement. A displaced marker
   whose arrow ends up in clear air is drawn at full strength — its leader line
   already says it was moved, and the fade exists so the arrow underneath stays
   visible. Where something IS underneath, the amount comes from depth:
   `NUDGE_ALPHA[0]` for the first displaced marker of a pile, `NUDGE_ALPHA[1]`
   for the second. Results carry `over`, the number of arrows this one covers.
   At most `maxPerCluster` markers end up in one pile.

   A DISPLACED MARKER NEVER PUSHES ONE THAT WAS NOT. Every normal placement is
   finished in phase 1, before anything is moved. Displaced markers do join the
   obstacle set afterwards, so two of them cannot land on the same spot.

   NOTE: this pass deliberately does NOT sort by altitude or staleness. Phase 1
   is plain nearest-first, so the nearest station of a pair keeps its true
   position. The earlier "highest on top, stale to the bottom" ordering was
   dropped at the owner's request while this placement is evaluated.
   ─────────────────────────────────────────────────────────────────── */
/* How pale a moved marker's ARROW is drawn, BY DEPTH: the first displaced
   marker of a pile, then the second. The number and the altitude always stay at
   full strength — the number is the fallback for a colour scale a lot of pilots
   cannot separate, so it never pays for the annotation. Fading the whole marker
   was measured as marginal against dark forest even at 0.6. */
var NUDGE_ALPHA = [0.6, 0.3];
function nudgeAlpha(depth) {
  return NUDGE_ALPHA[Math.min(Math.max(depth, 1), NUDGE_ALPHA.length) - 1];
}
var ARROW_TOL = 0.72;              /* arrows may overlap by about a quarter */
/* Search radii, in marker reaches. The largest is still under the height of a
   stack step, so a rotational placement always wins when one exists — measured:
   a level pair needs 48 px of clearance for two 46 px text columns, a stack
   needs 57. Two radii were not enough and every pair fell through to the
   stack, which is how this got found; a fourth was added when a marker in a
   dense corner still stacked 54 px straight down while north was empty. */
var RING = [1.15, 1.75, 2.4, 3.0];
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
  /* Nothing beyond this can possibly interact, so the ring search skips it. */
  var NEAR = (t1 + aw) * 2 + box * RING[RING.length - 1];

  /* PER MARKER, because "3/7" is barely half the width of "14/22" and using
     the widest possible label for everyone was costing about 10 px of needless
     displacement on every short one. The caller measures its own text. */
  function twOf(it) { return (it.tw > 0) ? it.tw : dtw; }

  function cross(a0, a1, b0, b1) { return a0 < b1 && b0 < a1; }

  /* THE ONE HARD RULE: two speed labels may not overlap. Everything else is a
     preference, expressed through the score below.

     ARROWS ARE ALLOWED TO OVERLAP, and that is the owner's call: "even if an
     arrow overlaps, the important part is that the wind speed label doesn't
     overlap, but the arrow can". Forbidding it is what kept markers ~50 px
     apart and made the fade meaningless — nothing ever actually overlapped, so
     a faded marker was announcing a collision that was not happening. */
  function conflict(ax, ay, atw, bx, by, btw) {
    return cross(ax - atw, ax + atw, bx - btw, bx + btw) &&
           cross(ay + t0, ay + t1, by + t0, by + t1);
  }
  /* Separate, because the ring PREFERS not to lay an arrow across a number even
     though it is allowed to when there is nowhere else to go. */
  function overText(ax, ay, atw, bx, by, btw) {
    return (cross(ax - atw, ax + atw, bx - aw, bx + aw) &&
            cross(ay + t0, ay + t1, by - aw, by + aw)) ||
           (cross(bx - btw, bx + btw, ax - aw, ax + aw) &&
            cross(by + t0, by + t1, ay - aw, ay + aw));
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
    placed.push([x, y, twOf(items[idx])]);
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
  function nearby(x, y) {
    var k, r = [];
    for (k = 0; k < placed.length; k++)
      if (Math.abs(placed[k][0] - x) < NEAR && Math.abs(placed[k][1] - y) < NEAR)
        r.push(placed[k]);
    for (k = 0; k < pending.length; k++)
      if (Math.abs(pending[k][0] - x) < NEAR && Math.abs(pending[k][1] - y) < NEAR)
        r.push(pending[k]);
    return r;
  }

  /* How far apart, as a fraction of the distance at which they would touch.
     >= 1 means clear. Normalised because the interaction is anisotropic: a
     marker is much taller than it is wide once its text is counted. */
  function roominess(x, y, tw, near) {
    var k, best = Infinity, p, dx, dy, s;
    for (k = 0; k < near.length; k++) {
      p = near[k];
      dx = Math.abs(x - p[0]); dy = Math.abs(y - p[1]);
      s = Math.max(dx / (tw + p[2]), dy / (th + aw));
      /* An arrow laid across someone's number is permitted but never
         preferred, so it costs score rather than disqualifying the angle. */
      if (overText(x, y, tw, p[0], p[1], p[2])) s *= 0.45;
      if (s < best) best = s;
    }
    return best;
  }

  /* Which placed marker did this one collide with? Used as the pile's host, so
     a stack goes below the thing it was hiding behind. */
  function hostOf(it, tw) {
    var k, best = -1, bd = Infinity, d;
    for (k = 0; k < nPlaced; k++) {
      if (!conflict(it.x, it.y, tw, placed[k][0], placed[k][1], placed[k][2])) continue;
      d = Math.abs(it.x - placed[k][0]) + Math.abs(it.y - placed[k][1]);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  /* A stack step that leaves the number ALONE. t1 is the bottom of the text and
     aw the arrow's half-height, so this is exactly the point where the lower
     marker's arrow stops touching the upper marker's number. Arrows may overlap
     each other — text may not, and the stack is no exception. */
  var depthAt = {}, step = t1 + aw;
  /* Seeded with every hidden marker's true position and drained as each is
     placed, so the scoring always knows about the ones still to come. */
  for (i = 0; i < hidden.length; i++)
    pending.push([items[hidden[i]].x, items[hidden[i]].y, twOf(items[hidden[i]])]);
  for (i = 0; o.nudge && i < hidden.length; i++) {
    pending.shift();                          /* this one is being placed now */
    var it = items[hidden[i]], tw = twOf(it);
    var host = hostOf(it, tw);
    var key = (host < 0) ? "-" : String(host);
    var depth = (depthAt[key] || 0) + 1;
    if (depth >= maxPer) continue;             /* a pile of four is lost */

    /* (a) ring search: closest radius that keeps every number readable, and at
       that radius the angle furthest from everything already drawn. */
    var got = false, bx = 0, by = 0, ri, ai, ang, cx, cy, near, sc, bestSc;
    for (ri = 0; ri < RING.length && !got; ri++) {
      var R = box * RING[ri];
      bestSc = -1;
      for (ai = 0; ai < RING_ANGLES; ai++) {
        ang = (ai / RING_ANGLES) * Math.PI * 2;
        cx = it.x + R * Math.sin(ang);
        cy = it.y + R * Math.cos(ang);
        if (o.inBounds && !o.inBounds(cx, cy)) continue;
        if (o.blocked && o.blocked(cx, cy)) continue;
        near = nearby(cx, cy);
        for (j = 0; j < near.length; j++)
          if (conflict(cx, cy, tw, near[j][0], near[j][1], near[j][2])) break;
        if (j < near.length) continue;          /* two numbers would collide */
        sc = roominess(cx, cy, tw, near);
        if (sc > bestSc) { bestSc = sc; bx = cx; by = cy; got = true; }
      }
    }

    /* (b) nowhere rotationally: stack below the host and let the fade carry it.
       Still verified — the step clears the host's own text by construction, but
       a third marker may be sitting where the stack wants to go. */
    if (!got && host >= 0) {
      for (ri = depth; ri <= depth + 1 && !got; ri++) {
        bx = it.x; by = placed[host][1] + step * ri;
        if (o.inBounds && !o.inBounds(bx, by)) continue;
        if (o.blocked && o.blocked(bx, by)) continue;
        near = nearby(bx, by);
        for (j = 0; j < near.length; j++)
          if (conflict(bx, by, tw, near[j][0], near[j][1], near[j][2])) break;
        if (j >= near.length) got = true;
      }
    }
    if (!got) continue;

    put(hidden[i], bx, by, true, depth);
    depthAt[key] = depth;
  }

  /* WHICH MARKERS ACTUALLY OVERLAP. Now that arrows are allowed to, the fade
     can mean what it says instead of being applied to every displaced marker
     whether or not anything is underneath it. A displaced marker that landed
     in clear air is drawn at full strength — its leader line still says it was
     moved, which is the annotation that matters; the fade is there so you can
     see the arrow beneath, and there is nothing beneath. */
  for (i = 0; i < out.length; i++) {
    out[i].over = 0;
    for (j = 0; j < out.length; j++) {
      if (i === j) continue;
      if (Math.abs(out[i].x - out[j].x) < aw * 2 &&
          Math.abs(out[i].y - out[j].y) < aw * 2) out[i].over++;
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
  NUDGE_ALPHA: NUDGE_ALPHA, nudgeAlpha: nudgeAlpha, ARROW_TOL: ARROW_TOL,
  hhmm: hhmm, esc: esc
};

})(typeof WG !== "undefined" ? WG : (module.exports = require("./core.js")));
