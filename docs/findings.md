# Findings

Probe results. Paste raw JSON plus a one-line verdict. Newest first.

---

### 2026-08-10 — XCTrack on Android 17 (Build/CP41.260717.006)

**Verdict:** unblocks the map architecture and settles the renderer question
outright, but does **not** clear the Phase 0 gate. Three questions are still
open, one of which (altitude) is the core feature.

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

#### Still open — the Phase 0 gate is not cleared.

1. **Altitude — the core feature.** `getLocation()` returned the string
   `"null"`, so `JSON.parse` yielded `null` and `Object.keys(null)` threw the
   reported `Cannot convert undefined or null to object`. That is XCTrack
   saying *no GPS fix*, not a broken bridge. The field name for altitude, and
   whether altitude is exposed at all, remain unknown. Per `plan.md`: "No
   altitude, no feature." **Re-run outdoors with a fix, or with XCTrack in
   simulation mode.**

   Useful anyway: the bridge *does* enumerate, and exposes exactly one
   function — `getLocation`. There is no separate altitude accessor, so if
   altitude exists it is a field in that payload.

2. **Blob survival across an XCTrack restart.** The blob is present at 10.0 MB,
   but it was written at `10:34:58.661Z` and read at `10:35:18.743Z` — 20
   seconds. That proves the write succeeded and survives a page reload. It says
   nothing about an app restart, which is the question Phase 3 depends on.
   **Fully kill XCTrack, reopen, reload the page, and check the timestamp is
   still the old one.**

3. **`persist()`.** `persisted (already): false`, and the `persist() granted`
   key is absent from the JSON — the button was never tapped. Without a grant,
   a ~50 MB pack is evictable under storage pressure.

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
- **`altitude` ships per station**, as a string in metres. The Δ-altitude
  ranking works off provider data alone — no DEM lookup needed for stations.
  The DEM is only ever for drawing terrain.
- `unit` is already `km/h`, matching the assumption in `plan.md`. `reference_ts`
  is ISO-8601 with `Z`, which feeds the staleness rule directly.

Also: most of the 190 KB is the per-station `description` HTML table, which we
never render. Relevant to the ~10 min poll on a flight battery.
