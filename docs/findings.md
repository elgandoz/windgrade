# Findings

Probe results. Paste raw JSON plus a one-line verdict. Newest first.

---

### 2026-08-10 — provider research: winds.mobi, and the XCTrack widget API

**Verdict:** changes Phase 2's data source and closes open decision 4. Also
answers the `getLocation()` question from the desk, so no second probe run is
needed for it.

#### winds.mobi — one CORS-open API for 13 station networks

Found by following what Windspion actually uses: it is a front end for
**winds.mobi**, not a direct provider integration.

```
GET https://winds.mobi/api/2/stations/?near-lat=46.8&near-lon=8.2&limit=400
  -> 200, access-control-allow-origin: *, application/json
```

OpenAPI spec at `https://winds.mobi/api/2.3/openapi.json` (v2.3; `/api/2/` also
resolves). Endpoints: `/stations/`, `/stations/{id}/`,
`/stations/{id}/historic/`.

400 stations around central Switzerland, by provider:

```
141  slf.ch                 12  fluggruppe-aletsch.ch    2  gxaircom.net
 99  meteoswiss.ch          10  aviationweather.gov      2  pdcs.ch
 85  holfuy.com              5  windball.ch              1  thunerwetter.ch
 35  openwindmap.org         4  windline.ch              1  ffvl.fr
                             3  pgsonda.cz
```

A verbatim record:

```json
{
 "_id": "pioupiou-1510",
 "alt": 1666,
 "loc": {"type": "Point", "coordinates": [8.194709, 46.787928]},
 "name": "Lungern",
 "peak": true,
 "pv-name": "openwindmap.org",
 "short": "Hüttstett",
 "status": "green",
 "tz": "Europe/Zurich",
 "last": {"_id": 1786370955, "w-dir": 292, "w-avg": 11.0, "w-max": 16.0}
}
```

Field semantics, quoted from the OpenAPI schema:

| Field | Spec |
|---|---|
| `w-avg` | Wind speed **[km/h]** |
| `w-max` | Wind speed max **[km/h]** |
| `w-dir` | Wind direction [°] (0–359) |
| `alt` | Altitude [m] |
| `peak` | **"Is the station on a peak"** |
| `status` | green: station ok · orange: data might be inaccurate · red: station isn't … |
| `last._id` | Measure date [unix timestamp] |
| `url` | Provider station URLs per language |
| `pv-code` / `pv-id` / `pv-name` | Provider identity |

Measured: `alt` spans 198–3581 m. `peak` is true for 255 of 400. `status` was
green for 395, orange 4, red 1. Timestamps ranged from live to **18 days old**,
so stale stations *are* returned and must be filtered by us.

**Terms of Use**, quoted from the spec, because one of them is a problem:

1. "Always identify your calls to winds.mobi API by setting a **user-agent HTTP
   header**"
2. "**Do not monetize** your service using winds.mobi data in any way"
3. "**Do not overload** this server by minimizing your number of calls. Get data
   for multiple stations at once."

"Any IP or service that doesn't respect these rules will be blacklisted without
any notice." Contact is Yann, `info@winds.mobi`.

**Rule 1 cannot be satisfied from a browser.** `User-Agent` is a forbidden header
name in the Fetch spec, so `fetch()` silently drops any attempt to set it. Rules
2 and 3 we meet trivially. This needs an email to Yann rather than a workaround —
the automatic `Origin: https://elgandoz.github.io` header does identify the
deployment, and proposing that is the obvious ask.

#### XCTrack's documented JS interface — altitude answered from the desk

`https://xctrack.org/JavaScriptInterface.html` documents `getLocation()` as
returning a JSON *string* with:

```
lon, lat, time, altGps, isValid, stdBaroAlt (null if no baro sensor),
pressure (null if no baro sensor), speedGps, speedComputed,
bearingGps, heading, airspeed
```

So the answer to the Phase 0 altitude question is **`altGps`** and
**`stdBaroAlt`** — no second probe run required. It also confirms the probe's
`"null"` result was the documented no-fix return value, and that `getLocation` is
the only method, matching what the probe enumerated.

Requires **"Allow web page to access XCTrack data"** in the widget settings.

Two traps worth writing down:

- **`stdBaroAlt` is standard pressure altitude**, referenced to 1013.25 hPa, not
  height above sea level. Comparing it to a station's `alt` is wrong by the QNH
  deviation, easily 100 m+. `altGps` is ellipsoidal. Moot while relative altitude
  stays withdrawn, but it is the obvious future mistake. (winds.mobi returns
  `pres.qnh`, so a real barometric altitude is computable if ever wanted.)
- **`heading` and `bearingGps` are both exposed**, which is what a track-up
  rotation or a radar orientation would need.

#### Widget URL placeholders, and the zoom gap

XCTrack substitutes **`${lat}`** and **`${lng}`** into a Web page widget's URL.
Zoom is *not* exposed — it must be hardcoded. Two open requests:

| Issue | Title | Opened | State |
|---|---|---|---|
| [#1097](https://gitlab.com/xcontest-public/xctrack-public/-/issues/1097) | Forwart zooming to WebView widget | 2024-04-27 | open, 1 upvote, 0 comments |
| [#1235](https://gitlab.com/xcontest-public/xctrack-public/-/issues/1235) | Pass a zoom level to the web widget | 2025-07-04 | open, 3 upvotes, 3 comments |

Neither has a milestone or a developer commitment; #1097 has not been touched
since the day it was filed. **Do not plan on this API arriving.**

The pattern nevertheless works today with a hardcoded zoom. #1235's author
writes: "I embed spotair in a widget, and I overlay on top of this widget a
transparent XC map in order to visualize my track over spotair", using
`https://www.spotair.mobi/widget/map?lat=${lat}&lng=${lng}&zoom=11&layers=wind,radarmf`.
XCMaps wants the same thing from the other side — "add XCMaps with transparent
Base Map as web widget over the XCTrack map" — and is blocked on the same gap.

#### XCTrack's map scale ↔ OSM zoom, and it aligns *exactly*

The comments on #1235 are more useful than the request itself. `chmd`, 2025-07-08
and 2026-06-12, obtained via
`/-/issues/1235/discussions.json` (the REST notes endpoint 401s; the web
discussions JSON is public).

XCTrack stores the XC map scale as an integer, `mapWidget_scale.value`, in the
`.xcfg` layout export. It runs 12 (labelled 600 km) to 34 (300 m).

| `mapWidget_scale.value` | XCTrack scale label | OSM zoom |
|---|---|---|
| 13 | 400 km | 5 |
| 15 | 200 km | 6 |
| 17 | 100 km | 7 |
| 19 | 50 km | 8 |
| 21 | 25 km | 9 |
| 23 | 12 km | 10 |
| **25** | **6 km** | **11** |
| 27 | 3 km | 12 |
| 29 | 1500 m | 13 |
| 31 | 800 m | 14 |
| 33 | 400 m | 15 |

`osm_zoom = floor(mapWidget_scale.value / 2) - 1`

**Only the odd values map.** The reason the alignment is exact rather than
coincidental: XCTrack's integer steps the scale by about √2, so two steps double
it, while OSM zoom doubles per level. Every second XCTrack step therefore lands
on an OSM level. The even values are intermediate scales with no OSM equivalent,
which is why the feature request asks XCTrack for an option to skip them.

**And it is verified, not asserted.** chmd's method, which is also *our*
acceptance test:

> 1. Take the url `https://www.spotair.mobi/?lat=${lat}&lng=${lng}&layers=asairspace&zoom=11`
> 2. Overlay a transparent XC map
> 3. Choose zoom level 6km
> 4. Enable/Disable airspaces on the XC map
> 5. Verify that they match perfectly with the airspaces shown by spotair

Airspace boundaries are a shared, hard-edged reference visible in both layers, so
toggling one against the other proves registration to the pixel. Repeating it at
several scales is what produced the table.

Two further details from the same comments:

- **"There is exactly one XC map getting changed when zoom in/zoom out inputs are
  sent (the map at the bottom of the stack)."** So zoom applies to the
  bottom-most map widget.
- **The XC map widget can itself be transparent and stacked above a web widget.**
  chmd puts the web page *below* and a transparent XC map *on top*. Both orders
  are possible, and the choice matters for us: our arrows on top stay legible,
  our arrows underneath get crossed by airspace lines and the track.

Other sites already built for this pattern, useful as prior art:
`spotair.mobi`, `thermik.pumpt.net`, `meteo-parapente.com`, `puretrack.io`.

### 2026-08-10 — XCTrack on Android 17 (Build/CP41.260717.006)

**Verdict: the Phase 0 gate is CLEARED — Phase 1 can start.** Every question in
`plan.md`'s feasibility table now has an answer. WebGL is absent, so Canvas is
settled. The 10 MB blob survives a full app restart, so the offline design holds.
Quota is ~10 GB. Service Worker, Cache Storage and IndexedDB are all present.
MeteoSwiss serves CORS headers, so no proxy and no backend. Byte ranges return
206.

What is left is not gating: `persist()` was never tapped (hardening, not a
precondition), `getLocation()`'s payload shape is unknown but was downgraded out
of the critical path, and byte ranges against a real `.pmtiles` cannot be tested
until a pack exists — a Phase 3 risk with a known fallback.

```json
{
 "timestamp": "2026-08-10T10:35:18.743Z",
 "url": "https://elgandoz.github.io/windgrade/probe.html",
 "protocol": "https:",
 "secureContext": true,
 "userAgent": "Mozilla/5.0 (Linux; Android 17; Build/CP41.260717.006; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 ",
 "screen": "448x978 @3",
 "onLine": true,
 "deviceMemoryGB": 8,
 "hardwareConcurrency": 9,
 "XCTrack object": true,
 "XCTrack methods": "getLocation",
 "getLocation() raw": "null",
 "parse": "failed: Cannot convert undefined or null to object",
 "serviceWorker": true,
 "caches": true,
 "indexedDB": true,
 "storageManager": true,
 "localStorage": true,
 "canvas2d": true,
 "webgl": false,
 "OffscreenCanvas": true,
 "webp": true,
 "persisted (already)": false,
 "quota": "10250.1 MB",
 "usage": "10.1 MB",
 "test blob present": true,
 "test blob size": "10.0 MB",
 "test blob written": "2026-08-10T10:34:58.661Z",
 "range status": 206,
 "content-range": "bytes 0-99/4948",
 "CORS Holfuy live (no key)": "BLOCKED (Failed to fetch)",
 "CORS MeteoSwiss gust 10min": "200 · 284ms · 0.2 MB",
 "CORS MeteoSwiss STAC root": "200 · 298ms · 0.0 MB"
}
```

Notes:
- altitude field name: **UNANSWERED** — `getLocation()` returned `"null"`
- blob survived restart: **UNANSWERED** — 20 s elapsed, not a restart
- quota: 10250.1 MB (~10 GB), `persist()` **never requested**
- CORS: MeteoSwiss 200 with no proxy. Holfuy blocked in-WebView.

#### Settled: no WebGL. Canvas is mandatory, not preferred.

`webgl: false` on Android 17 with a current WebView and 8 GB of RAM. This is
not an old-device artifact — WebGL is simply not exposed to XCTrack's WebView.

That removes the conditional from `AGENTS.md` ("unless the probe shows WebGL is
solid") and from `handover.md` ("revisit only if the probe shows WebGL is
solid"). MapLibre is out. `protomaps-leaflet` to Canvas is the only path, which
is what Phase 3 already assumed.

Supporting: `canvas2d: true`, `OffscreenCanvas: true`, `webp: true`. WebP means
the hillshade raster can ship as WebP rather than PNG. OffscreenCanvas means
tile rasterisation can move off the main thread if it ever needs to.

`screen: 448x978 @3` — device pixel ratio 3, i.e. 1344×2934 physical. Rendering
the map at full DPR is ~9× the fill rate of DPR 1 for no legibility gain at
100 m/px. Cap the canvas backing store at DPR 1–2.

#### Settled: MeteoSwiss needs no proxy, confirmed from inside the WebView.

200 in 284 ms for the gust endpoint, 298 ms for STAC. Static hosting holds; no
backend needed. Holfuy is `BLOCKED (Failed to fetch)` from the WebView, matching
the missing `access-control-allow-origin` seen from curl — so Holfuy is two
gates, permission **and** a proxy.

#### Settled: storage is abundant and the pack ceiling is a hosting limit.

`serviceWorker`, `caches`, `indexedDB`, `storageManager`, `localStorage` all
present; `secureContext: true`. Quota ~10 GB against a ~50 MB pack.

So the "~50 MB per pack" rule in `AGENTS.md` is purely a git/GitHub-Pages
constraint, never a device one. If packs move to R2, that ceiling lifts and the
region split can be reconsidered — the device does not care.

#### The 206 result is real but tests the wrong representation.

`range status: 206` from inside the WebView. Byte ranges work.

But `content-range: bytes 0-99/4948`, and `probe.html` is 14348 bytes on disk.
4948 is its **gzipped** length. Verified from the laptop:

```
Range + Accept-Encoding: gzip, deflate, br  -> 206  content-encoding: gzip  bytes 0-99/4948
Range + no Accept-Encoding (curl default)   -> 206  (no encoding)           bytes 0-99/14348
```

**This corrects the earlier laptop entry below, which concluded that Pages
resolves ranges against the identity representation.** It does not. It resolves
them against whichever representation content negotiation selected. Plain
`curl` sends no `Accept-Encoding` and so silently tested identity; a browser
always offers gzip and gets the compressed one.

Why this matters more than the 206: PMTiles computes absolute byte offsets from
its own directory. Offsets into a gzipped stream are meaningless. And a browser
**cannot** opt out — `Accept-Encoding` is a forbidden header name in `fetch()`,
so the identity workaround that works in curl is unavailable in the client.

This origin does compress `application/octet-stream`:

```
/LICENSE     (1408 B)  application/octet-stream  content-encoding: gzip   total 855
/.gitignore  ( 195 B)  application/octet-stream  no encoding              total 195
/.nojekyll   (   0 B)  application/octet-stream  416, content-range */0
```

So compression here tracks a size threshold, not the content type — `.gitignore`
escaped only by being under it. Whether Fastly's on-the-fly gzip has an upper
size cap that a tens-of-MB `.pmtiles` would exceed is **not established**, and
it is now the one remaining PMTiles unknown.

**The test that actually settles it** (needs a real binary on the origin):

```
curl -s -D- -o /dev/null -r 0-99 \
  -H 'Accept-Encoding: gzip, deflate, br' \
  https://elgandoz.github.io/windgrade/packs/<region>.pmtiles \
  | grep -iE '^HTTP|content-type|content-encoding|content-range'
```

Pass = 206, **no** `content-encoding`, and a `content-range` total equal to the
file's real byte size. Anything else and the packs go to R2 — which is why
Phase 3's manifest already holds absolute pack URLs.

#### Settled: the 10 MB blob survives a full XCTrack restart.

**Owner-confirmed** — the JSON above was copied out of XCTrack *after* force-
closing and reopening the app, and `test blob present: true` with
`test blob written: 2026-08-10T10:34:58.661Z` is the pre-restart blob being read
back.

This entry originally disputed that, on the grounds that only 20 seconds separate
the write from the page load. That was an inference from a timestamp, and it was
wrong: the restart happened inside that window.

**This is the result Phase 3 depends on.** Offline map packs in Cache Storage are
viable, so the offline design stands as written.

Two things worth drawing out:

- It survived while `persisted` was `false`. Eviction did not touch a 10 MB blob
  across an app restart *without* a persistence grant, which makes
  `navigator.storage.persist()` a hardening step rather than a precondition. The
  handover called eviction "an unsolved problem" quoting the CDMX PWA author;
  on this device, at this size, it did not occur.
- 10 MB is not 50 MB. Nothing here says a full-size pack behaves the same under
  real storage pressure, so check quota and call `persist()` before downloading,
  as Phase 3 already specifies.

#### Still open — nothing that gates Phase 1.

1. **`getLocation()`'s payload shape — no longer a blocker.** It returned the
   string `"null"`, so `JSON.parse` yielded `null` and `Object.keys(null)` threw
   the reported `Cannot convert undefined or null to object`. That is XCTrack
   saying *no GPS fix*, not a broken bridge. Field names for latitude, longitude
   and altitude are all still unknown.

   **Downgraded the same day.** The owner has ruled that relative altitude is
   not important and that the map must render even with no position at all. So
   this no longer gates anything — it is now just an unknown to resolve
   opportunistically on the next run with a fix. `plan.md`'s old "no altitude,
   no feature" is withdrawn.

   Useful anyway: the bridge *does* enumerate, and exposes exactly one
   function — `getLocation`. There is no separate altitude accessor, so if
   altitude exists it is a field in that payload.

2. **`persist()` — not requested, and no longer a gate.** `persisted (already):
   false`, and neither `persist() granted` nor `persist()` appears in the JSON,
   so the button was not tapped (or the JSON was copied before the promise
   resolved). Worth doing, but see the blob result below: eviction did not bite
   even *without* a grant, so `persist()` is hardening rather than a
   prerequisite.

3. **Byte ranges against a real `.pmtiles`.** The one genuinely unresolved
   architectural risk, described above. It cannot be tested until a pack exists,
   so it is a Phase 3 risk with a known fallback (R2), not a Phase 0 blocker.

#### Probe defects that cost this run

Recording these rather than patching, since the probe is frozen until Phase 0
closes.

- **The user-agent is sliced at exactly 110 characters**, which lands precisely
  at the end of `Version/4.0 ` and cuts the `Chrome/xxx.x.x.x Mobile Safari`
  token — the one field that determines which JS and CSS features are safe. The
  slice needs to be ~180.
- **A null fix reports as a type error.** `"Cannot convert undefined or null to
  object"` reads like a probe bug. It should say "no GPS fix — go outside and
  re-run", because that ambiguity is what left question 1 open.
- **The two manual tests can be silently skipped.** `persist()` and the restart
  check need button taps, and a run that omits them looks complete in the JSON
  rather than showing "not run".
- **The range test targets `location.href`**, i.e. gzipped HTML. It proves 206
  but not the representation semantics PMTiles needs. It should target a
  committed binary.

---

### 2026-08-10 — laptop / curl (NOT a WebView run)

**Verdict:** settled CORS and the provider payload shape. Its byte-range
conclusion was wrong — see the correction in the WebView entry above.

These are `curl` results from macOS, not `probe.html` output.

#### HTTP 206 / byte ranges — GitHub Pages

Origin: `https://elgandoz.github.io/windgrade/`

```
GET /probe.html  Range: bytes=0-99      -> 206, content-range: bytes 0-99/14348, 100 bytes
GET /probe.html  Range: bytes=500-599   -> 206, correct plaintext at that offset
HEAD /probe.html Range: bytes=0-99      -> 200  (Fastly ignores Range on HEAD — not a failure)
```

`accept-ranges: bytes` and `access-control-allow-origin: *` on every response.
The `*` matters for later: packs can be served from another origin without a
client change.

**Test ranges with GET, not HEAD.** `curl -I` reports a misleading 200.

> **Superseded.** This entry originally concluded that Pages resolves ranges
> against the identity representation. That was an artifact of curl sending no
> `Accept-Encoding` at all. See the WebView entry above.

#### CORS — providers

```
200  acao: *      MeteoSwiss gust 10min   (190 KB, content-type binary/octet-stream)
200  acao: *      MeteoSwiss avg 10min    ch.meteoschweiz.messwerte-windgeschwindigkeit-kmh-10min
200  acao: *      MeteoSwiss STAC collection ch.meteoschweiz.ogd-smn
200  no acao      Holfuy live  -> {"errorCode":"no_access"}
```

MeteoSwiss needs **no proxy**. Static hosting holds.

#### MeteoSwiss payload shape — the 2020 gist URLs still resolve

155 features. Confirmed live, so the `handover.md` doubt is settled. Two
endpoints are required, one per colour channel: `boeenspitze` (gust → border)
and `windgeschwindigkeit` (average → fill).

```json
{
 "type": "Feature",
 "geometry": { "type": "Point", "coordinates": [2771036.8, 1184825.9] },
 "id": "ARO",
 "properties": {
  "station_name": "Arosa",
  "value": 20.9,
  "wind_direction": 98,
  "wind_direction_radian": 1.710423,
  "unit": "km/h",
  "reference_ts": "2026-08-10T10:20:00Z",
  "altitude": "1888.00",
  "measurement_height": "10.00 m",
  "description": "<table>…"
 }
}
```

Three things that change Phase 2, all facts, no inference:

- **Coordinates are EPSG:2056 (Swiss LV95), not WGS84.** Top-level
  `crs.properties.name` declares it. A provider module must transform before
  anything can be placed on a map. swisstopo's approximate LV95→WGS84 formula
  is a short pure function, no library.
- **`altitude` ships per station**, as a string in metres above sea level, so no
  DEM lookup is needed to label a station. The DEM is only ever for drawing
  terrain. (This entry originally added that it also powers Δ-altitude ranking;
  that ranking was dropped later the same day. The altitude is still displayed
  as a fact.)
- `unit` is already `km/h`, matching the assumption in `plan.md`. `reference_ts`
  is ISO-8601 with `Z`, which feeds the staleness rule directly.

Also: most of the 190 KB is the per-station `description` HTML table, which we
never render. Relevant to the ~10 min poll on a flight battery.
