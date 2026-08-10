# Plan

## Phase 0 — feasibility gate  ← we are here

Run `probe.html` **inside XCTrack's Web page widget**, and again in Chrome for
comparison. Record the JSON in `docs/findings.md`.

It answers, in one page:

| Question | Why it decides something |
|---|---|
| Does `getLocation()` expose altitude, and under what field name? | Δ-altitude colouring is the core feature. No altitude, no feature. |
| Does a 10 MB Cache Storage blob survive an XCTrack restart? | If not, offline map packs die and Phase 3 changes shape entirely. |
| `storage.estimate()` quota, and is `persist()` granted? | Sets the maximum pack size, hence the region split and zoom ceiling. |
| Service Worker available in the WebView? | Decides whether caching is SW-intercepted or a custom PMTiles source. |
| Does the origin serve HTTP 206 to a `Range` request? | PMTiles requires byte ranges. |
| Do the wind APIs send CORS headers? | No CORS means a proxy, which means it is no longer purely static. |
| WebGL present and sane? | Canvas vs MapLibre. |
| Does a `tel:` link open the dialer? | Not needed here, but the sibling project needs the answer. |

**Do not start Phase 1 until this is filled in.** A negative on storage
persistence should trigger a conversation with the owner, not a workaround.

## Phase 1 — skeleton

New pages, engine copied from `hx-call`'s `hx/core.js` and stripped of the
airspace specifics. Three entry points: launcher/config, standalone page,
transparent widget. No data, no map — just position, config and layout.

## Phase 2 — data, no map

Ships something useful on its own, and is where the rating scale gets tuned.

- Provider modules normalising to
  `{id, name, lat, lon, alt, dir, avg, gust, ts}`. MeteoSwiss first.
- Fetch layer with staleness: cache last good reading, show its age, go red
  past a threshold.
- Rating table, thresholds owner-supplied. Fill colour from average, border
  colour from gust. The mismatch between the two is itself the signal — calm
  average with violent gusts is the most useful thing on the screen.
- Render as chips, sorted by a ranking that weights Δ-altitude heavily rather
  than horizontal distance alone. Ranking purely by distance is why existing
  tools surface useless valley-airport readings.

## Phase 3 — map

- Build script → two `.pmtiles` per region: a vector basemap extract at a low
  max zoom (~z11; 40 km across a 400 px widget is about 100 m/px, so higher
  zooms are wasted bytes) and a hillshade raster from Copernicus GLO-30.
- A region manifest: bbox, both pack URLs (absolute, so packs can move to R2
  later without a refactor), and which providers cover it.
- Render with `protomaps-leaflet` to canvas, markers on top. Desaturated
  basemap so the rating colours are the only saturated thing on screen.
- A "download this region" button that **lives inside the WebView** — storage
  written in Chrome is not visible to XCTrack's WebView. Check quota and call
  `persist()` before downloading.

## Phase 4 — polish

`size` / `theme` / `range` / `max` parameters, radar orientation, README,
and an update to AGENTS.md.

---

## Decisions still open

1. **Repo name.** `windgrade` is a placeholder.
2. **Rating thresholds.** Owner to supply real km/h boundaries for
   green / yellow / orange / red / black. Until then Phase 2 uses obvious
   placeholders, clearly marked.
3. **First region.** Leaning Switzerland split into a few sub-50 MB packs,
   rather than one Alps-wide file.
4. **Providers.** MeteoSwiss only to start, or approach Holfuy in parallel?
   Holfuy is the network paraglider pilots actually use and is international,
   but its API is not open by default and needs permission.
5. **Units.** Assumed km/h throughout.
