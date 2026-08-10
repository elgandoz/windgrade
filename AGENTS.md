# Windgrade

An XCTrack web widget (plus a standalone page) that shows nearby **wind-station
readings on terrain**, each rendered as an arrow coloured by a rating scale. For
paraglider XC pilots flying areas they don't know.

Two ways to get the terrain, and the cheap one came first: **Phase 3b** overlays
transparent arrows on XCTrack's *own* map, which needs no basemap of ours at all.
**Phase 3** ships our own offline PMTiles basemap, and remains the durable answer
for the standalone page.

**Status: Phases 1, 2 and 3b built. Phase 3 (our own basemap) and Phase 4 not
started.** Working: the engine, the winds.mobi provider, a launcher, a list page
and the XCTrack overlay whose registration against XCTrack's own map is measured
and confirmed. Read `docs/findings.md` before proposing anything — it settles the
renderer, the data source and the map calibration. Then `docs/plan.md` for the
phases and `docs/handover.md` for why each decision was made the way it was.

Still open: sync the widget zoom to the map automatically (owner has a plan),
the `User-Agent` question for winds.mobi, and a latitude check on the 0.942
calibration constant.

`windgrade` is a placeholder name — renaming is a folder move and three lines
of docs.

## Who it's for, and under what conditions

Swiss (later, wider) XC paraglider pilots. In the air, one-handed, in gloves,
in bright sunlight, on a small screen, often with no data connection and always
on a battery that has to last the flight.

The specific gap it fills: existing tools list stations *by name*. If you don't
fly an area regularly, a name tells you nothing — you can't tell whether a
reading came from a valley floor, a summit, or a gorge that funnels. Seeing the
station on terrain is the whole point.

## Rules — do not relax these

- **Show facts, never inferences.** Station altitude, terrain shape, measured
  speed and gust: yes. Lee-side guesses, turbulence predictions, risk
  interpolation between stations: no. Alpine terrain makes such heuristics
  unreliable and a confident wrong answer is worse than no answer. The owner
  rejected a lee-side heuristic for exactly this reason.
- **The colour belongs to the marker, not the space around it.** No heat
  surfaces, no interpolation between stations. A reading describes one
  instrument at one point.
- **Stale data must announce itself.** This tool cannot work offline for
  readings — only for terrain. Old wind shown confidently is the main way this
  could hurt someone. Go visibly red past a staleness threshold; never silently
  render an old value.
- **The speed number stays visible at every size.** The rating scale's middle —
  green / yellow / orange / red — is a hue-only cluster, invisible to a
  significant fraction of male pilots, and yellow is lighter than green so there
  is no luminance ramp to fall back on either. The number is the fallback, not an
  optional decoration.
- **Never claim a safety verdict.** The rating scale is a rough aid supplied by
  the owner, not a computed assessment of whether a flight is safe.

## Technical constraints

- **Static hosting only.** GitHub Pages or Netlify, no runtime server. If a
  data provider needs a proxy to satisfy CORS, that is a finding to report, not
  a licence to add a backend without discussion.
- **A build step is allowed here** (unlike the sibling project `hx-call`) but
  only at build time: `pmtiles extract`, `gdaldem hillshade`, output committed.
  The *shipped* pages stay dependency-light and work without a bundler.
- **Map packs must stay under ~50 MB each.** Git warns at 50 MB and refuses at
  100 MB, and Git LFS is not an option — GitHub Pages serves the LFS pointer
  file, not the content. Split regions into multiple packs rather than raising
  the ceiling.
- **Canvas, not WebGL**, for map rendering (`protomaps-leaflet`). This is
  **settled, not a preference**: the 2026-08-10 probe reported `webgl: false`
  inside XCTrack's WebView on Android 17 with 8 GB of RAM, so WebGL is simply
  not available to us. MapLibre is out. Cap the canvas backing store at DPR 1–2
  — the probe measured DPR 3, and full-DPR rendering costs ~9× the fill rate for
  no legibility gain at ~100 m/px.
- **Minimise DOM writes and wakeups.** Same discipline as `hx-call`: build
  elements once, write only changed text nodes, poll no faster than the data
  actually changes. Wind readings update on a ~10 minute cadence; don't fetch
  faster than that.
- **The widget's `<body>` stays unpainted.** XCTrack renders white or absent
  backgrounds as transparent so the widget floats over its map.

## Reused from `hx-call`

The sibling repo's `hx/core.js` is the engine base: position sources
(`XCTrack.getLocation()` → URL params → browser geolocation → **last known
position**), the `SPEC` config pattern that drives both URL parameters and the
settings UI from one array, distance/bearing ranking, and the guarded
`localStorage` wrapper. Copy it, don't couple to it — two dependency-free static
sites shouldn't share a library at this size.

**Read `/Users/marcus/Repos/hx-call/CLAUDE.md` and `hx-call/docs/background.md`
before touching widget plumbing.** They record measured XCTrack behaviour that
does not need rediscovering. The load-bearing ones:

- **`tel:` and all non-http schemes are dead** in XCTrack's WebView, and worse,
  they strand the widget on an error page until it reloads. `navigator.clipboard`
  works.
- **`${lat}`/`${lng}` substitution makes XCTrack reload the whole page** on the
  widget's refresh rate. So: **refresh rate 0 and the JS interface on** — never
  placeholders as the live position source. An unsubstituted placeholder arrives
  as the literal `${lat}` and must be ignored, not parsed.
- `getLocation()` is a **pull** API returning a JSON string or `"null"` with
  `isValid`, gated on *"Allow web page to access XCTrack data"*. Poll it.
- *"Allow tapping on the web page when locked"* must be ON for in-flight
  interaction.
- Any service-worker cache must key on **path, not full URL**, or XCTrack's
  `?lat=…&lng=…` reloads miss it every time.
- Distance ranking uses equirectangular maths with a cached `cos(lat)` — 0.5%
  worst case in Switzerland. The Phase 3b overlay is the exception and needs real
  Web Mercator, because it must agree with a tile projection.
- Keep `core.js` free of the DOM: it returns state, pages draw. That is what
  stops the widget and the standalone page from drifting apart.

**The overlay calibration is measured, do not re-derive it.** For the Phase 3b
widget that sits over XCTrack's own map:

```
m/px = 156543.034 · cos(lat) / 2^z / 0.942     4km=z12  8km=z11  15km=z10  30km=z9
```

XCTrack's map scale is a *resolution* on an exact power-of-two ladder, but it is
**not** on integer OSM zoom levels — it runs 1.062× coarser, hence the 0.942.
Verified at three ladder steps against airspace edges; `docs/findings.md` has the
numbers and `tools/registration.html` reproduces it. The printed km labels are
rounded and must never be used to compute geometry.

## Running it locally

Pure static files, so any server works. There is nothing to build or watch.

    node tools/test-core.js            # engine: 90 assertions, no network
    node tools/test-core.js --live     # + one real winds.mobi call
    python3 -m http.server 8080        # then http://localhost:8080/ (launcher)

Three things that will otherwise cost an hour:

- **Do not open the pages via `file://`.** Browsers refuse geolocation there, so
  `app.html` can never get a fix. `localhost` counts as a secure context, so it
  works; any equivalent server is fine.
- **A LAN address like `http://192.168.x.x:8080` is *not* a secure context**, so
  geolocation is blocked there too. For phone or XCTrack testing, publish to
  GitHub Pages (the real target) or open a tunnel:
  `cloudflared tunnel --url http://localhost:8080`.
- **winds.mobi sends `access-control-allow-origin: *`**, verified from a localhost
  origin, so no proxy is needed in development or production.

Unlike `hx-call` there is no service worker yet, so an edit appears on the first
reload rather than the second. If one is ever added, that changes — and its cache
must key on the path, not the full URL, or XCTrack's `?lat=…&lng=…` reloads miss
it every time.

Testing without a position: append `?lat=47.05&lng=8.64`. Any parameter in `SPEC`
works the same way, e.g. `?zoom=10&peaks=1&stale=45` — or just use the
configurator on `index.html`, which builds the URL and a QR code for it.

Pages: `index.html` launcher/configurator, `app.html` list, `widget.html` overlay.
Engine: `wg/core.js` (no DOM), `wg/marker.js` (both renderers), `wg/windsmobi.js`
(provider), `wg/fields.js` (SPEC-driven controls), `wg/qr.js` (launcher only).
Tools: `tools/registration.html`, `tools/arrow.html`, `tools/arrow.svg`,
`tools/test-core.js`, `probe.html`.

A headless browser is available for visual checks, which beats shipping UI blind:

    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
      --virtual-time-budget=9000 --window-size=460,900 --screenshot=/tmp/s.png \
      "http://localhost:8080/app.html?lat=47.05&lng=8.64"

Caveat: it does not capture a canvas drawn asynchronously — the widget's markers
come out blank even though `getImageData` proves they are there. SVG captures
fine, so `app.html` and `tools/arrow.html` are the pages to check this way.

## Conventions

- Plain ES5-compatible JS in shipped pages. Old Android WebViews.
- Build scripts may use whatever is convenient; they run on a laptop.
- Findings from probes go in `docs/findings.md`, dated, raw JSON included.
- **`node tools/test-core.js`** exercises the engine — config clamping, the
  calibration, the rating bands, geo, bbox, staleness, ranking and the provider's
  URL building and normalisation. Add `--live` for one real winds.mobi call. This
  is only possible because `wg/core.js` touches no DOM; keep it that way.
