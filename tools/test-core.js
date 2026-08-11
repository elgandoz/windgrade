/* Engine tests. Run on a laptop:  node tools/test-core.js
   Add --live to also hit winds.mobi (network, and it counts against their
   "do not overload" rule — so keep it to one call).

   core.js touches no DOM precisely so this can exist. */
"use strict";

var WG = require("../wg/core.js");
var fail = 0, pass = 0;

function eq(name, got, want, tol) {
  var ok = (tol === undefined) ? (got === want) : (Math.abs(got - want) <= tol);
  if (ok) { pass++; console.log("  ok    " + name); }
  else    { fail++; console.log("  FAIL  " + name + "\n          got  " + got + "\n          want " + want); }
}
function head(s) { console.log("\n── " + s + " ──"); }

head("config / SPEC clamping");
var c = WG.cfg("?step=99&pad=-5&max=abc&lat=47.1&lng=8.5");
eq("step clamped to the ladder top", c.step, 34);
eq("pad clamped to min", c.pad, 0);
eq("unparseable max -> default", c.max, 120);
eq("lat parsed", c.lat, 47.1);
eq("default scale is 8km of ground", WG.cfg("").scale, 8000);
eq("step is unset by default, so the scale decides", WG.cfg("").step, 0);
eq("default stale", WG.cfg("").stale, 30);
eq("default poll is the 10 min data cadence", WG.cfg("").poll, 600);

/* The configurator's shape is a rule, not a layout accident: a row with no
   `grp` is on the front page, and the front page has to stay short enough to
   be read before a first flight. Adding a parameter without a group is how
   that quietly stops being true, so it fails here instead. */
head("SPEC grouping — what the configurator shows up front");
var front = [], noGrp = [], gi, gs;
for (gi = 0; gi < WG.SPEC.length; gi++) {
  gs = WG.SPEC[gi];
  if (gs.ui === false || gs.hidden) continue;
  (gs.grp ? noGrp : front).push(gs.k);
}
eq("exactly two rows are shown before the accordion", front.join(","), "scale,alt");
eq("every other UI row names a group", noGrp.indexOf(undefined), -1);
eq("groups are few enough to scan", (function () {
  var seen = {}, n = 0, i2;
  for (i2 = 0; i2 < WG.SPEC.length; i2++)
    if (WG.SPEC[i2].grp && !seen[WG.SPEC[i2].grp]) { seen[WG.SPEC[i2].grp] = 1; n++; }
  return n;
})() <= 8, true);
/* `hidden` is NOT the accordion. It means no control anywhere, while the
   parameter keeps working in URLs — unlike ui:false, which also strips it. */
eq("the ladder-step override has no control at all",
   WG.SPEC.filter(function (s) { return s.k === "step"; })[0].hidden, true);
eq("but it still survives a URL round-trip",
   WG.cfg("?step=27").step, 27);

head("XCTrack placeholder trap (from hx-call)");
eq("literal ${lat} is NaN, not 0", isNaN(WG.toNum("${lat}")), true);
eq("cfg drops it to null so the chain falls through", WG.cfg("?lat=${lat}").lat, null);

head("measured calibration — docs/findings.md 2026-08-10");
eq("CAL", WG.CAL, 0.942);
eq("mppOsm  z11 @47.361", WG.mppOsm(47.361, 11), 51.78, 0.02);
eq("mppXct  z11 (measured 54.95)", WG.mppXct(47.361, 11), 54.95, 0.03);
eq("mppXct  z10 (measured 109.89)", WG.mppXct(47.361, 10), 109.89, 0.06);
eq("mppXct  z12 (measured 27.47)", WG.mppXct(47.361, 12), 27.47, 0.02);
function zEff(z) {
  return Math.log(156543.034 * Math.cos(47.361 * Math.PI / 180) / WG.mppXct(47.361, z)) / Math.LN2;
}
eq("zEff z11 = 10.914", zEff(11), 10.914, 0.002);
eq("zEff spacing z10->z11 is exactly 1", zEff(11) - zEff(10), 1, 1e-9);
eq("zEff spacing z11->z12 is exactly 1", zEff(12) - zEff(11), 1, 1e-9);

head("XCTrack scale ladder — sqrt2 per step");
eq("z from step 25 (8km)", WG.zoomForStep(25), 11);
eq("z from step 23 (15km)", WG.zoomForStep(23), 10);
eq("z from step 27 (4km)", WG.zoomForStep(27), 12);
eq("a step is half a zoom level", WG.zoomForStep(24), 10.5);
eq("one step is sqrt2 in scale",
   WG.mppXct(47.361, WG.zoomForStep(24)) / WG.mppXct(47.361, WG.zoomForStep(25)),
   Math.SQRT2, 1e-9);
eq("two steps double",
   WG.mppXct(47.361, WG.zoomForStep(23)) / WG.mppXct(47.361, WG.zoomForStep(25)), 2, 1e-9);
eq("step<->zoom round trips", WG.stepForZoom(WG.zoomForStep(25)), 25);
eq("and at a half step too", WG.stepForZoom(WG.zoomForStep(24)), 24);

/* THE EVIDENCE THAT SETTLED IT. The printed labels come from the scale bar,
   not the ladder: the bar shows the largest nice number fitting a fixed max
   length of ~150 dp. One sqrt2 ladder plus the measured density law reproduces
   two different devices' label lists exactly — 46 labels, no misses. An
   alternating ladder fitted to one list cannot explain the other.

   The width the labels react to is DENSITY, not css width: the same 150 dp bar
   covers less ground on a denser screen, because XCTrack's map is drawn in
   device pixels. A fraction-of-width bar manages at best 42 of 46 here. */
(function () {
  var phone = "300m,500m,600m,1km,1200m,2km,2500m,4km,5km,8km,10km,15km,20km,30km,40km,60km,80km,120km,150km,250km,300km,500km,600km".split(","),
      pixel = "300m,400m,600m,800m,1200m,1500m,2500m,3km,5km,6km,10km,12km,20km,25km,40km,50km,80km,100km,150km,200km,300km,400km,600km".split(","),
      v, i = 0, okP = 0, okX = 0;
  for (v = 34; v >= 12; v--, i++) {
    WG.setDpr(3);     if (WG.scaleLabel(v, 47.361) === phone[i]) okP++;
    WG.setDpr(2.625); if (WG.scaleLabel(v, 47.361) === pixel[i]) okX++;
  }
  WG.setDpr(3);
  eq("reproduces all 23 labels on the owner's phone (dpr 3)", okP, 23);
  eq("reproduces all 23 labels on a Pixel 9a (dpr 2.625)", okX, 23);
})();
eq("same step, different densities, different printed label",
   WG.scaleLabel(25, 47.361) !== (WG.setDpr(2.625), WG.scaleLabel(25, 47.361)), true);
WG.setDpr(3);
eq("  phone prints 8km", WG.scaleLabel(25, 47.361), "8km");
WG.setDpr(2.625);
eq("  pixel prints 6km", WG.scaleLabel(25, 47.361), "6km");
WG.setDpr(3);
eq("...at exactly the same resolution",
   WG.mppXct(47.361, WG.zoomForStep(25)), 54.96, 0.02);
eq("labels derive from the ladder, so they cannot disagree",
   WG.XCT_SCALE[11], WG.XCT_LADDER[WG.stepForZoom(11)]);
eq("8km is z11 in this build", WG.XCT_SCALE[11], "8km");
eq("15km is z10", WG.XCT_SCALE[10], "15km");
eq("10km is NOT an integer zoom (it is step 24)", WG.XCT_LADDER[24], "10km");
eq("ladder spans 23 steps", WG.XCT_STEP_MAX - WG.XCT_STEP_MIN + 1, 23);
eq("label metres: 8km", WG.XCT_METRES[25], 8000);
eq("label metres: 2500m", WG.XCT_METRES[28], 2500);
eq("label metres: 600km", WG.XCT_METRES[12], 600000);
eq("every step has a parsed distance",
   (function(){ var v, n = 0; for (v = 12; v <= 34; v++) if (WG.XCT_METRES[v] > 0) n++; return n; })(), 23);
/* The bar is only a valid check if its pixel length equals the label distance
   divided by the resolution we are actually drawing at. */
eq("8km bar at z11 is ~146 css px", 8000 / WG.mppXct(47.361, 11), 145.6, 0.5);
eq("step 24 resolution", WG.mppXct(47.361, WG.zoomForStep(24)), 77.73, 0.02);


head("legacy ?zoom= keeps working");
eq("zoom=10 maps to the 15km step", WG.XCT_LADDER[WG.cfg("?zoom=10").step], "15km");
eq("zoom=11 maps to 8km", WG.XCT_LADDER[WG.cfg("?zoom=11").step], "8km");
eq("an explicit step wins over a legacy zoom",
   WG.cfg("?zoom=10&step=27").step, 27);

head("scale labels survive a missing latitude");
/* A null latitude used to reach Math.cos and become the equator, shifting every
   label a whole step and sending the pilot to the wrong map scale. */
eq("null latitude falls back, not to the equator", WG.scaleLabel(24, null), "10km");
eq("undefined too", WG.scaleLabel(24, undefined), "10km");
eq("NaN too", WG.scaleLabel(24, NaN), "10km");
eq("a real latitude is still used", WG.scaleLabel(24, 47), "10km");
eq("and it genuinely varies with latitude",
   WG.scaleLabel(24, 0) !== WG.scaleLabel(24, 60), true);

head("ground scale -> ladder step, resolved on the device");
/* THE BUG THIS FIXES. The launcher offered step 25 as "8km" because that is
   what a dpr-3 phone prints; on a Pixel 9a the same step prints 6km. A step is
   not a scale, so the pilot picks a scale and the step is worked out here. */
WG.setDpr(3);
eq("8km on the reference phone is step 25", WG.stepForScale(8000, 47.361), 25);
eq("...and it really does print 8km there", WG.scaleLabel(25, 47.361), "8km");
WG.setDpr(2.625);
eq("8km on a Pixel 9a is NOT step 25", WG.stepForScale(8000, 47.361) !== 25, true);
/* A Pixel 9a's ladder goes 6km, 10km — it has no 8km at all, and 10/8 is a
   smaller factor than 8/6, so nearest-in-log-space lands on 10km. */
eq("it has no 8km step, so the nearest is taken",
   WG.scaleLabel(WG.stepForScale(8000, 47.361), 47.361), "10km");
eq("a scale it DOES have is hit exactly",
   WG.scaleLabel(WG.stepForScale(6000, 47.361), 47.361), "6km");
WG.setDpr(3);

eq("resolveStep uses the scale when step is unset",
   WG.resolveStep({ scale:8000, step:0 }, 47.361), 25);
eq("an explicit step wins over the scale",
   WG.resolveStep({ scale:8000, step:22 }, 47.361), 22);
eq("a below-ladder step reads as unset, not as a step",
   WG.resolveStep({ scale:8000, step:5 }, 47.361), 25);
eq("a junk scale falls back rather than picking an extreme",
   WG.resolveStep({ scale:0, step:0 }, 47.361), 25);
/* The pilot's choice must survive the trip to a different phone: the same
   requested scale resolves to a different step, which is the entire point.
   (Not every scale flips — 20km is step 22 on both — so this asserts on one
   that does, and on the invariant that matters underneath.) */
eq("8km resolves to step 25 at dpr 3 and step 24 at dpr 2.625",
   (WG.setDpr(3), WG.stepForScale(8000, 47.361)) + "/" +
   (WG.setDpr(2.625), WG.stepForScale(8000, 47.361)), "25/24");
/* The invariant: whenever a device can actually print the requested scale, it
   is what the pilot gets. Anything else and the launcher is lying again. */
(function () {
  var d, m, hit = 0, reachable = 0, v, i, lab;
  var want = [300, 500, 600, 1000, 1200, 2000, 2500, 4000, 5000, 6000,
              8000, 10000, 15000, 20000, 30000];
  for (d = 0; d < 2; d++) {
    WG.setDpr(d ? 2.625 : 3);
    for (i = 0; i < want.length; i++) {
      lab = WG.fmtScale(want[i]);
      for (v = 12; v <= 34; v++) if (WG.scaleLabel(v, 47.361) === lab) break;
      if (v > 34) continue;                        /* this screen has no such scale */
      reachable++;
      if (WG.scaleLabel(WG.stepForScale(want[i], 47.361), 47.361) === lab) hit++;
    }
  }
  eq("every scale a device can print is hit exactly, on both", hit, reachable);
  eq("  and that was a real sample, not an empty one", reachable > 20, true);
})();
WG.setDpr(3);

head("the launcher's scale list covers every device");
/* THE SECOND HALF OF THE SAME BUG. Resolving the step on the device is no use
   if the pilot cannot express the scale in the first place: built from the
   reference phone's ladder the list had no 6km at all, and a Pixel 9a prints
   6km. Missing an option is a hard failure; an extra one nobody would pick is
   not, so the list is the union over the densities a phone plausibly has. */
(function () {
  var opts = WG.scaleOptions(47.361), d, v, m, missing = [];
  eq("6km is offered, which one device's ladder alone did not",
     opts.indexOf(6000) >= 0, true);
  eq("so is 8km, which the other one needs", opts.indexOf(8000) >= 0, true);
  for (d = 0; d < 2; d++) {
    WG.setDpr(d ? 2.625 : 3);
    for (v = WG.XCT_STEP_MIN; v <= WG.XCT_STEP_MAX; v++) {
      m = WG.scaleMetres(v, 47.361);
      if (m && opts.indexOf(m) < 0) missing.push(m);
    }
  }
  WG.setDpr(3);
  eq("nothing either measured device can print is missing from the list",
     missing.join(",") || "none", "none");
  eq("descending, so the select reads coarse to fine like XCTrack's",
     opts[0] > opts[opts.length - 1], true);
  /* Every offered scale must be a scale SOME device really prints, or the list
     has drifted from the ladder into invented numbers. */
  eq("no duplicates", opts.length, (function () {
    var u = {}, n = 0, i;
    for (i = 0; i < opts.length; i++) if (!u[opts[i]]) { u[opts[i]] = 1; n++; }
    return n;
  })());
})();

head("a pinned step must not silently outrank a fresh choice");
/* The step row is hidden from the settings UI, so if an old ?step=NN link
   opened the launcher and the pilot then picked a scale, the step would win
   with nothing on screen to explain why. Choosing a scale clears it. */
WG.initConfig("?step=24");
eq("the old link's step is honoured on arrival", WG.getConfig().step, 24);
WG.setConfig({ scale: 6000 });
eq("choosing a scale clears the pin", WG.getConfig().step, 0);
eq("and the scale is what is stored", WG.getConfig().scale, 6000);
eq("so the URL carries no stale step",
   WG.buildUrl("widget.html").indexOf("step=") < 0, true);
/* But a URL that only pins a step still works untouched — that is the whole
   reason the parameter still exists. */
WG.initConfig("?step=24");
eq("step=24 still resolves to step 24", WG.resolveStep(WG.getConfig(), 47.361), 24);
WG.initConfig("");

head("pixel density");
/* MEASURED 2026-08-11, tools/ruler.html, one emulator at two densities, reading
   XCTrack's own scale bar against a css-pixel ruler — so nothing here depends
   on our calibration being right in the first place. Step 22, near 46.3 N:

       dpr 2.625  ->  bar 15km over 111.0 css px  ->  135.1 m/css px
       dpr 2.000  ->  bar 15km over 141.7 css px  ->  105.9 m/css px

   A css-fixed resolution predicts those two are EQUAL; they differ by 28%.
   Fixed in device pixels predicts the ratio is 2.625/2 = 1.312; measured 1.277.
   These are the numbers the whole density correction rests on — if this block
   ever goes red, the correction is wrong, not the test. */
eq("defaults to the reference phone, so nothing moves for it", WG.getCal(), WG.CAL);
eq("reference dpr is the phone CAL was measured on", WG.DPR_REF, 3);

WG.setDpr(2.625);
eq("Pixel 9a at stock density reproduces the measured resolution",
   WG.mppXct(46.3, 9.5), 135.1, 4);          /* within 3% of measured */
WG.setDpr(2);
eq("the same emulator at density 320 does too",
   WG.mppXct(46.3, 9.5), 105.9, 4);

/* The falsified model, kept as a test so it cannot creep back: if resolution
   were fixed in css px the two would agree, and they must not. */
WG.setDpr(2.625); var rA = WG.mppXct(46.3, 9.5);
WG.setDpr(2);     var rB = WG.mppXct(46.3, 9.5);
eq("resolution scales with density rather than being fixed in css px",
   rA / rB, 2.625 / 2, 0.001);

eq("a bad ratio falls back rather than blanking the map", WG.setDpr(0), 1);
WG.setDpr(3);
eq("back to the measured constant on the reference phone", WG.getCal(), 0.942);

head("manual cal, on top of density");
WG.setCal(1.1);
eq("cal multiplies the density correction", WG.getCal(), 0.942 * 1.1, 1e-9);
WG.setDpr(2);
eq("and the two compose", WG.getCal(), 0.942 * 1.5 * 1.1, 1e-9);
eq("a bad value is ignored rather than blanking the map", WG.setCal(0), 1);
WG.setCal(1); WG.setDpr(3);
eq("back to the measured constant", WG.getCal(), 0.942);
/* Labels DO move with density — that is the whole finding — but not with cal,
   which is a residual on a resolution the labels already agree with. */
eq("label at step 25 is 8km at the reference density",
   WG.scaleLabel(25, 47.361), "8km");
var P = WG.projector({ lat:47.361, lon:8.578 }, 11, 448, 978);
eq("centre x", P.x(8.578), 224, 1e-6);
eq("centre y", P.y(47.361), 489, 1e-6);
var east10 = 10000 / (111319.49 * Math.cos(47.361 * Math.PI / 180));
eq("10 km east in px", (P.x(8.578 + east10) - 224) * P.res, 10000, 15);
eq("10 km north in px", (489 - P.y(47.361 + 10000 / 111319.49)) * P.res, 10000, 25);

head("rounding — half-up, one rule for display and colour");
eq("1.4 -> 1", WG.roundKmh(1.4), 1);
eq("1.5 -> 2", WG.roundKmh(1.5), 2);
eq("6.4 -> 6", WG.roundKmh(6.4), 6);
eq("6.5 -> 7", WG.roundKmh(6.5), 7);
eq("missing stays missing", isNaN(WG.roundKmh(NaN)), true);

head("rating bands — six levels, two tables, rated on the rounded value");
[[0,0],[6,0],[6.4,0],[6.49,0],[6.5,1],[6.9,1],[7,1],[14.4,1],[14.5,2],[15,2],
 [24.4,2],[24.5,3],[25,3],[30.4,3],[30.5,4],[31,4],[36.4,4],[36.5,5],[37,5],[99,5]]
 .forEach(function (p) {
  eq("avg " + p[0] + " -> " + WG.LEVELS[p[1]], WG.rateAvg(p[0]), p[1]);
});
[[0,0],[14,0],[14.4,0],[14.5,1],[15,1],[24.4,1],[24.5,2],[25,2],[32.4,2],[32.5,3],
 [33,3],[38.4,3],[38.5,4],[39,4],[44.4,4],[44.5,5],[45,5],[99,5]].forEach(function (p) {
  eq("gust " + p[0] + " -> " + WG.LEVELS[p[1]], WG.rateGust(p[0]), p[1]);
});
eq("missing reading -> unknown, not calm", WG.rateAvg(NaN), -1);
eq("unknown has its own colour", WG.levelName(-1), "unknown");

/* The point of a single rounding rule: a marker showing "7" must never be in the
   white band, or the pilot cannot tell which of the number and the colour to
   believe. Swept across every boundary at 0.1 resolution. */
head("the displayed number and the band can never disagree");
var mism = 0, v, shown, lvl, i2;
for (v = 0; v <= 60.05; v += 0.1) {
  shown = WG.roundKmh(v);
  lvl = WG.rateAvg(v);
  /* recompute the band from the number the pilot actually sees */
  for (i2 = 0; i2 < WG.AVG_BANDS.length; i2++) if (shown < WG.AVG_BANDS[i2]) break;
  if (i2 !== lvl) mism++;
}
eq("avg: no value displays in a band it does not belong to", mism, 0);
mism = 0;
for (v = 0; v <= 60.05; v += 0.1) {
  shown = WG.roundKmh(v);
  lvl = WG.rateGust(v);
  for (i2 = 0; i2 < WG.GUST_BANDS.length; i2++) if (shown < WG.GUST_BANDS[i2]) break;
  if (i2 !== lvl) mism++;
}
eq("gust: same", mism, 0);

head("the mismatch signal is the point of two tables");
eq("22/37 fill", WG.LEVELS[WG.rateAvg(22)], "yellow");
eq("22/37 rim is HOTTER — real gust factor", WG.LEVELS[WG.rateGust(37)], "orange");
eq("21/31 fill", WG.LEVELS[WG.rateAvg(21)], "yellow");
eq("21/31 rim MATCHES — ordinary gusting", WG.LEVELS[WG.rateGust(31)], "yellow");
eq("a shared table would make every rim hotter", WG.rateAvg(31) > WG.rateGust(31), true);

head("calm glyph agrees with the displayed number");
var MK = require("../wg/marker.js").marker || WG.marker;
eq("0/0 is calm", MK.isCalm({ avg:0, gust:0, dir:200 }), true);
eq("0.4/0.4 displays 0/0, so it is calm too",
   MK.isCalm({ avg:0.4, gust:0.4, dir:200 }), true);
eq("0.4/0.4 does display 0/0", MK.labelText({ avg:0.4, gust:0.4 }), "0/0");
eq("0.5/0.4 rounds to 1/0, so it is NOT calm",
   MK.isCalm({ avg:0.5, gust:0.4, dir:200 }), false);
eq("no direction is always calm", MK.isCalm({ avg:9, gust:12, dir:NaN }), true);
eq("a real reading is not calm", MK.isCalm({ avg:9, gust:12, dir:200 }), false);

head("station altitude line");
/* A missing altitude must draw NOTHING — not a dash, not a zero. The provider
   not knowing is different from the station being at sea level, and this tool
   shows facts, so it stays silent rather than inventing either. */
eq("a real altitude carries its unit", MK.altText({ alt:3020 }), "3020m");
eq("rounded to the metre", MK.altText({ alt:412.6 }), "413m");
eq("sea level is a real reading, not an absent one", MK.altText({ alt:0 }), "0m");
eq("null draws nothing", MK.altText({ alt:null }), "");
eq("undefined draws nothing", MK.altText({}), "");
eq("NaN draws nothing", MK.altText({ alt:NaN }), "");
eq("Infinity draws nothing", MK.altText({ alt:Infinity }), "");
/* The widget widens its collision box by exactly this, so the two must agree
   or an altitude lands on the arrow of the station below it. */
eq("the line is smaller than the speed it sits under", MK.altSize(13) < 13, true);
eq("but never microscopic at the smallest marker size", MK.altSize(9), 8);

head("geo (equirectangular, ranking only)");
eq("10 km east", WG.dist(47, 8, 47, 8 + 10000 / (111319.49 * Math.cos(47 * Math.PI / 180))), 10000, 12);
eq("10 km north", WG.dist(47, 8, 47 + 10000 / 111319.49, 8), 10000, 12);
eq("bearing N", Math.round(WG.bearing(47, 8, 48, 8)), 0);
eq("bearing E", Math.round(WG.bearing(47, 8, 47, 9)), 90);
eq("bearing S", Math.round(WG.bearing(47, 8, 46, 8)), 180);

head("fetch bbox — 448x978 widget at z11 with a 20 km cache margin");
var b = WG.bboxAround({ lat:47.0447, lon:8.6430 }, 11, 448, 978, 20);
var wKm = WG.dist(47.0447, b.w, 47.0447, b.e) / 1000;
var hKm = WG.dist(b.s, 8.643, b.n, 8.643) / 1000;
eq("width  = 24.6 view + 40 pad", wKm, 64.6, 0.6);
eq("height = 53.8 view + 40 pad", hKm, 93.8, 0.6);
eq("box contains the fix", b.s < 47.0447 && b.n > 47.0447 && b.w < 8.643 && b.e > 8.643, true);

/* The box has to follow the SAME resolution the projector draws with. It used
   to divide by the raw CAL — the dpr-3 value — so on a denser screen the view
   covered more ground than the box did and the edges were never fetched. */
head("fetch bbox follows pixel density, like the projector");
WG.setDpr(1.5);
var bLo = WG.bboxAround({ lat:47.0447, lon:8.6430 }, 11, 448, 978, 0);
WG.setDpr(3);
var bHi = WG.bboxAround({ lat:47.0447, lon:8.6430 }, 11, 448, 978, 0);
eq("a denser screen shows more ground, so it fetches a wider box",
   (bHi.e - bHi.w) > (bLo.e - bLo.w), true);
eq("and by exactly the density ratio",
   (bHi.e - bHi.w) / (bLo.e - bLo.w), 2, 0.001);
eq("pad 0 gives the view rectangle itself, which is what prepare's keep wants",
   WG.dist(47.0447, bHi.w, 47.0447, bHi.e) / 448, WG.mppXct(47.0447, 11), 0.5);
WG.setDpr(3);

head("staleness — old wind must never look current");
var cf = WG.cfg(""), now = 1786370000000;
eq("5 min  -> fresh", WG.staleness({ ts:now - 5 * 60000 }, cf, now).cls, "fresh");
eq("20 min -> warn",  WG.staleness({ ts:now - 20 * 60000 }, cf, now).cls, "warn");
eq("45 min -> stale", WG.staleness({ ts:now - 45 * 60000 }, cf, now).cls, "stale");
eq("no timestamp -> stale, not fresh", WG.staleness({ ts:NaN }, cf, now).cls, "stale");

head("prepare: rank, filter, cap");
var far  = { id:"far",  name:"Far",  lat:48.0, lon:8.6, alt:500,  avg:5,  gust:9,  ts:now, peak:false, provider:"a" };
var near = { id:"near", name:"Near", lat:47.05, lon:8.65, alt:2000, avg:22, gust:37, ts:now, peak:true,  provider:"b" };
var out  = WG.prepare([far, near], { lat:47.0447, lon:8.6430 }, cf, now);
eq("nearest first", out[0].id, "near");
eq("distance computed", out[0].dist < out[1].dist, true);
eq("rating attached", WG.LEVELS[out[0].rAvg], "yellow");
eq("peaks=1 filters on the provider's fact",
   WG.prepare([far, near], { lat:47.0447, lon:8.6430 }, WG.cfg("?peaks=1"), now).length, 1);
eq("max caps the list", WG.prepare([far, near], { lat:47.0447, lon:8.6430 }, WG.cfg("?max=1"), now).length, 1);
eq("attribution names the networks, not just the aggregator",
   WG.attribution([far, near]).join(","), "a,b");

/* The screen is a rectangle and distance is a circle. Culling to the view
   BEFORE the cap is what stops C.max being spent on stations that can never
   be drawn — measured at 17 of 40 wasted on a 448x978 widget at 30 km. */
head("prepare: the view cull runs before the cap");
var view = { s:47.0, n:47.1, w:8.6, e:8.7 };
var east = { id:"east", name:"East", lat:47.05, lon:9.4, alt:900, avg:8, gust:12, ts:now, peak:false, provider:"c" };
eq("a station outside the rectangle is dropped",
   WG.prepare([near, east], { lat:47.0447, lon:8.6430 }, cf, now, view).length, 1);
eq("and it is the one inside that survives",
   WG.prepare([near, east], { lat:47.0447, lon:8.6430 }, cf, now, view)[0].id, "near");
eq("no rectangle means no cull — the list page wants nearest regardless",
   WG.prepare([near, east], { lat:47.0447, lon:8.6430 }, cf, now).length, 2);
/* The case that matters: a station that is NEARER but off the side of the
   screen. Radial ranking hands it the only slot; the cull gives the slot to
   the one that can actually be drawn. */
var sideCloser = { id:"side", name:"Side", lat:47.0447, lon:8.71, alt:900, avg:8, gust:12, ts:now, peak:false, provider:"c" };
var farInside  = { id:"deep", name:"Deep", lat:47.0980, lon:8.6430, alt:900, avg:8, gust:12, ts:now, peak:false, provider:"c" };
eq("off-screen station really is the nearer of the two",
   WG.dist(47.0447, 8.643, 47.0447, 8.71) < WG.dist(47.0447, 8.643, 47.098, 8.643), true);
eq("without the cull, max=1 spends its only slot off-screen",
   WG.prepare([sideCloser, farInside], { lat:47.0447, lon:8.6430 }, WG.cfg("?max=1"), now)[0].id, "side");
eq("with the cull, the slot goes to the one that can be drawn",
   WG.prepare([sideCloser, farInside], { lat:47.0447, lon:8.6430 }, WG.cfg("?max=1"), now, view)[0].id, "deep");
eq("inBox is inclusive on the edges", WG.inBox({ lat:47.0, lon:8.6 }, view), true);
eq("inBox rejects outside", WG.inBox({ lat:46.9, lon:8.6 }, view), false);

head("provider: url building");
var WM = require("../wg/windsmobi.js");
var P2 = (WM.providers ? WM.providers : WG.providers).windsmobi;
var u = P2.buildUrl(b, { maxAgeSec:1800 });
eq("bbox params present", /within-pt1-lat=.*within-pt2-lon=/.test(u.replace(/&/g, "")), true);
eq("keys are REPEATED, not comma-joined", (u.match(/keys=/g) || []).length, 11);
eq("no comma-joined keys", u.indexOf("keys=name%2C") === -1 && u.indexOf("keys=name,") === -1, true);
eq("dedupe requested", u.indexOf("is-highest-duplicates-rating=true") !== -1, true);
eq("server-side staleness filter", u.indexOf("last-measure=1800") !== -1, true);
eq("limit within the documented max 500", +/limit=(\d+)/.exec(u)[1] <= 500, true);

head("provider: normalise a real record shape");
var st = P2.normalise([{
  _id:"meteoswiss-DIS", alt:1208,
  loc:{ type:"Point", coordinates:[8.853427, 46.706596] },
  name:"Disentis", peak:false, "pv-name":"meteoswiss.ch", short:"Disentis",
  status:"green", last:{ _id:1786371600, "w-dir":192, "w-avg":4.3, "w-max":11.9 }
}])[0];
eq("id", st.id, "meteoswiss-DIS");
eq("lat from GeoJSON [lon,lat] order", st.lat, 46.706596);
eq("lon from GeoJSON [lon,lat] order", st.lon, 8.853427);
eq("alt", st.alt, 1208);
eq("avg is km/h, no conversion", st.avg, 4.3);
eq("gust is km/h, no conversion", st.gust, 11.9);
eq("dir", st.dir, 192);
eq("unix seconds -> ms", st.ts, 1786371600000);
eq("provider network named for attribution", st.provider, "meteoswiss.ch");
eq("peak flag preserved", st.peak, false);
eq("status preserved as a separate axis from age", st.status, "green");
eq("name and short identical -> no separate place to show", st.place, "");

/* The trap that made a station look absent: for openwindmap.org the API's
   `name` is a geocoded municipality and `short` is the name the owner gave
   it. A pilot looking for "Decollo TRUCETTI" was shown "Valgioie". */
head("provider: the openwindmap name/short swap");
var ow = P2.normalise([{
  _id:"pioupiou-1363", alt:978,
  loc:{ type:"Point", coordinates:[7.347268, 45.07645] },
  name:"Valgioie", peak:true, "pv-name":"openwindmap.org",
  short:"Decollo TRUCETTI 980m", status:"green",
  last:{ _id:1786453264, "w-dir":202, "w-avg":5.5, "w-max":9.8 }
}])[0];
eq("the owner's name is what the pilot is shown", ow.name, "Decollo TRUCETTI 980m");
eq("the geocoded municipality is kept alongside", ow.place, "Valgioie");
var ws = P2.normalise([{
  _id:"ffvl-x", loc:{ type:"Point", coordinates:[6, 45] },
  name:"Baouroux 1600m ", short:"Baouroux  1600m ", "pv-name":"ffvl.fr"
}])[0];
eq("nbsp and doubled spaces squeezed", ws.name, "Baouroux 1600m");
eq("so the two fields still compare equal and place stays empty", ws.place, "");
eq("no name at all falls back to the id",
   P2.normalise([{ _id:"bare", loc:{ type:"Point", coordinates:[6, 45] } }])[0].name, "bare");

head("widget URL carries the XCTrack placeholders");
WG.initConfig("");
var wurl = WG.buildUrl("widget.html", { placeholders: true });
eq("lat placeholder present and RAW", wurl.indexOf("lat=${lat}") !== -1, true);
eq("lng placeholder present and RAW", wurl.indexOf("lng=${lng}") !== -1, true);
eq("not percent-encoded, or XCTrack would never match it",
   wurl.indexOf("%24%7B") === -1, true);
eq("omitted unless asked for", WG.buildUrl("app.html").indexOf("${") === -1, true);
/* The whole point: a substituted value is used, an unsubstituted one is not. */
eq("substituted -> a usable position", WG.cfg("?lat=47.05&lng=8.64").lat, 47.05);
eq("unsubstituted -> ignored, chain falls through",
   WG.cfg("?lat=${lat}&lng=${lng}").lat, null);

head("provider: history");
var hu = P2.historicUrl("meteoswiss-DIS", { duration: 10800 });
eq("station id is in the path", hu.indexOf("/meteoswiss-DIS/historic/") !== -1, true);
eq("duration passed", hu.indexOf("duration=10800") !== -1, true);
eq("only the keys we plot", (hu.match(/keys=/g) || []).length, 4);
var hs = P2.normaliseHistoric([
  { _id: 1786402200, "w-dir": 285, "w-avg": 1.8, "w-max": 4.0 },
  { _id: 1786395000, "w-dir": 36,  "w-avg": 6.5, "w-max": 15.5 }
]);
eq("api returns newest first; we hand back oldest first", hs[0].ts < hs[1].ts, true);
eq("unix seconds -> ms", hs[0].ts, 1786395000000);
eq("values carried", hs[1].avg, 1.8);
eq("a sample with no timestamp is dropped",
   P2.normaliseHistoric([{ "w-avg": 5 }]).length, 0);

console.log("\n" + (fail ? "FAILED " + fail + " of " : "passed all ") + (pass + fail) + " assertions");

if (process.argv.indexOf("--live") !== -1) {
  head("LIVE winds.mobi (one call)");
  global.XMLHttpRequest = null;
  var https = require("https");
  https.get(P2.buildUrl(b, { maxAgeSec:1800 }), function (r) {
    var body = "";
    r.on("data", function (d) { body += d; });
    r.on("end", function () {
      console.log("  HTTP " + r.statusCode + "  acao=" + r.headers["access-control-allow-origin"] +
                  "  " + body.length + " bytes");
      var list = P2.normalise(JSON.parse(body));
      console.log("  " + list.length + " stations, " + WG.attribution(list).length + " networks");
      var r2 = WG.prepare(list, { lat:47.0447, lon:8.6430 }, cf, Date.now());
      console.log("  nearest 5:");
      r2.slice(0, 5).forEach(function (s) {
        console.log("    " + (Math.round(s.dist / 100) / 10 + " km").padStart(8) +
          "  " + String(Math.round(s.alt) + " m").padStart(7) +
          "  " + (s.peak ? "peak" : "    ") +
          "  " + String(s.avg + "/" + s.gust).padStart(11) + " km/h" +
          "  " + WG.LEVELS[s.rAvg] + "/" + WG.LEVELS[s.rGust] +
          "  " + s.stale.cls + " " + Math.round(s.stale.age) + "m" +
          "  " + s.name);
      });
    });
  }).on("error", function (e) { console.log("  live fetch failed: " + e.message); });
}

process.exitCode = fail ? 1 : 0;
