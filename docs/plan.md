# Plan

## Phase 0 — feasibility gate  ← we are here

Run `probe.html` **inside XCTrack's Web page widget**, and again in Chrome for
comparison. Record the JSON in `docs/findings.md`.

It answers, in one page:

| Question | Why it decides something |
|---|---|
| What does `getLocation()` return, and under what field names? | Position selects which stations are nearby. Altitude is **informational only** — see "Altitude" below. |
| Does a 10 MB Cache Storage blob survive an XCTrack restart? | If not, offline map packs die and Phase 3 changes shape entirely. |
| `storage.estimate()` quota, and is `persist()` granted? | Sets the maximum pack size, hence the region split and zoom ceiling. |
| Service Worker available in the WebView? | Decides whether caching is SW-intercepted or a custom PMTiles source. |
| Does the origin serve HTTP 206 to a `Range` request? | PMTiles requires byte ranges. |
| Do the wind APIs send CORS headers? | No CORS means a proxy, which means it is no longer purely static. |
| WebGL present and sane? | Canvas vs MapLibre. |
| Does a `tel:` link open the dialer? | Not needed here, but the sibling project needs the answer. |

**Do not start Phase 1 until this is filled in.** A negative on storage
persistence should trigger a conversation with the owner, not a workaround.

### Altitude — downgraded 2026-08-10

Owner's call: **relative (pilot − station) altitude is not important.** An
earlier draft of this table called Δ-altitude "the core feature" and said "no
altitude, no feature." That was wrong, and it is withdrawn.

What follows from it:

- Pilot altitude is **not** a gate on any phase. If `getLocation()` never
  exposes it, nothing is lost.
- **Station** altitude is still shown — it is a measured fact shipped by the
  provider, and `AGENTS.md` explicitly permits it. Only the *subtraction* is out.
- Ranking no longer weights Δ-altitude. Comprehension comes from seeing the
  station on terrain, which was always the stronger half of the idea.
- The ellipsoidal-vs-orthometric datum problem disappears with the subtraction.
  GPS altitude is height above the WGS84 ellipsoid; MeteoSwiss altitudes are
  above sea level, and in the Alps the geoid offset is roughly 50 m. Nothing now
  mixes the two.

### The map must render without a position

Also owner's call, same date. The map has to be readable when XCTrack returns no
position at all — as it did on the first probe run, which reported
`getLocation() raw: "null"`.

So the position chain from `hx-call` grows a fourth link:

```
XCTrack.getLocation() -> URL params -> browser geolocation -> last known position
```

The last known position persists via the guarded `localStorage` wrapper. The map
draws from whatever the chain yields, and degrades to "no position" rather than
to a blank page.

**Remembering a position is safe; remembering a reading is not.** Terrain does
not move, so a stale position costs nothing. Wind does, so readings stay bound
by the staleness rule in `AGENTS.md`. These are two independent clocks and must
not be conflated — a remembered position must never make an old reading look
current.

## Phase 1 — skeleton

New pages, engine copied from `hx-call`'s `hx/core.js` and stripped of the
airspace specifics. Three entry points: launcher/config, standalone page,
transparent widget. No data, no map — just position, config and layout.

Includes the four-link position chain above, with the last known position
written to `localStorage` and a visible indication of which link supplied the
current fix.

## Phase 2 — data, no map

Ships something useful on its own, and is where the rating scale gets tuned.

- Provider modules normalising to
  `{id, name, lat, lon, alt, dir, avg, gust, ts}`. MeteoSwiss first.
- Fetch layer with staleness: cache last good reading, show its age, go red
  past a threshold.
- Rating table, thresholds owner-supplied. **Four levels** — green safe, yellow
  warning, red dangerous, black extremely dangerous. Colour comes from wind
  speed only: fill from the average, rim from the gust. The mismatch between the
  two is itself the signal — calm average with violent gusts is the most useful
  thing on the screen. Marker geometry is specified in `handover.md`.
- Render as chips, ranked by horizontal distance, each showing the station's own
  altitude as a fact. Δ-altitude weighting is **out** — see "Altitude" above.
  Placing the station on terrain is what makes a valley reading legible as a
  valley reading, so that job belongs to Phase 3's map, not to the ranking.

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
2. **Rating thresholds.** The scale is now four levels — green / yellow / red /
   black; **orange is dropped**. Owner still to supply the km/h boundaries.
   Until then Phase 2 uses obvious placeholders, clearly marked.
   Two sub-questions raised by the marker spec and still unanswered:
   whether a black gust keeps the mandatory white halo *outside* its near-black
   stroke, and where the speed number sits once two arrows are stacked.
3. **First region.** Leaning Switzerland split into a few sub-50 MB packs,
   rather than one Alps-wide file.
4. **Providers.** MeteoSwiss only to start, or approach Holfuy in parallel?
   Holfuy is the network paraglider pilots actually use and is international,
   but its API is not open by default and needs permission.
5. **Units.** Assumed km/h throughout.
