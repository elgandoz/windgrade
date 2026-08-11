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
eq("unparseable max -> default", c.max, 40);
eq("lat parsed", c.lat, 47.1);
eq("default step is 8km", WG.XCT_LADDER[WG.cfg("").step], "8km");
eq("default stale", WG.cfg("").stale, 30);
eq("default poll is the 10 min data cadence", WG.cfg("").poll, 600);

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
   not the ladder: the bar shows the largest nice number that fits ~0.325 of
   the widget width. One sqrt2 ladder plus two different widths reproduces two
   different devices' label lists exactly — 46 labels, no misses. An
   alternating ladder fitted to one list cannot explain the other. */
(function () {
  var phone = "300m,500m,600m,1km,1200m,2km,2500m,4km,5km,8km,10km,15km,20km,30km,40km,60km,80km,120km,150km,250km,300km,500km,600km".split(","),
      pixel = "300m,400m,600m,800m,1200m,1500m,2500m,3km,5km,6km,10km,12km,20km,25km,40km,50km,80km,100km,150km,200km,300km,400km,600km".split(","),
      v, i = 0, okP = 0, okX = 0;
  for (v = 34; v >= 12; v--, i++) {
    if (WG.scaleLabel(v, 47.361, 448) === phone[i]) okP++;
    if (WG.scaleLabel(v, 47.361, 411) === pixel[i]) okX++;
  }
  eq("reproduces all 23 labels on the owner's phone (448 css px)", okP, 23);
  eq("reproduces all 23 labels on a Pixel 9a (411 css px)", okX, 23);
})();
eq("same step, different screens, different printed label",
   WG.scaleLabel(25, 47.361, 448) !== WG.scaleLabel(25, 47.361, 411), true);
eq("  phone prints 8km", WG.scaleLabel(25, 47.361, 448), "8km");
eq("  pixel prints 6km", WG.scaleLabel(25, 47.361, 411), "6km");
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
eq("null latitude falls back, not to the equator", WG.scaleLabel(24, null, 448), "10km");
eq("undefined too", WG.scaleLabel(24, undefined, 448), "10km");
eq("NaN too", WG.scaleLabel(24, NaN, 448), "10km");
eq("a real latitude is still used", WG.scaleLabel(24, 47, 448), "10km");
eq("and it genuinely varies with latitude",
   WG.scaleLabel(24, 0, 448) !== WG.scaleLabel(24, 60, 448), true);

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
/* Labels must NOT move with cal: they depend on bar width x resolution, and a
   correction to one is compensated by the bar the pilot is comparing against. */
eq("label at step 25 is still 8km on a 448 px screen",
   WG.scaleLabel(25, 47.361, 448), "8km");
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
