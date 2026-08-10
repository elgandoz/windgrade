# Plan

## Phase 0 — feasibility gate  ✅ CLEARED 2026-08-10

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

**Cleared.** `docs/findings.md` has the run. Every row above is answered, and
nothing came back negative enough to need a conversation: no WebGL (Canvas was
already the plan), the blob survives a restart, ~10 GB of quota, Service Worker
present, 206 on ranges, and MeteoSwiss serving CORS headers so the build stays
static. Phase 1 is unblocked.

Two results did not gate anything but changed the plan, below: relative altitude
was withdrawn, and byte ranges turned out to resolve against the *negotiated*
representation, which is a Phase 3 risk to verify on a real pack.

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
  `{id, name, lat, lon, alt, dir, avg, gust, ts}`. **winds.mobi first**, with
  MeteoSwiss-direct kept as the fallback module — see "The provider decision"
  in `handover.md`. The normalised shape grows two fields that winds.mobi
  supplies as facts: `peak` (is the station on a summit) and `status` (the
  provider's own health flag, distinct from our staleness clock).
  Near-identity mapping, no projection maths: coordinates are already WGS84 and
  speeds are already km/h.
- Fetch layer with staleness: cache last good reading, show its age, go red
  past a threshold.
- **One bounding-box call per ~10 minutes, not a whole-country download.** The
  box is the visible area padded by 20 km, with `keys` trimmed to what we render,
  `last-measure` filtering stale stations server-side and
  `is-highest-duplicates-rating` collapsing co-located ones. Measured at ~18 KB
  for 72 stations across six networks in the densest part of Switzerland — exact
  query and numbers in `findings.md`.
  The 20 km pad is a **cache** radius, not a display radius: it buys 30 minutes
  of flight at 40 km/h, so movement never forces a refetch faster than the ~10
  minute data cadence does. That satisfies winds.mobi's "do not overload" rule
  without extra logic.
- Rating table: **six levels** (white/grey, green, yellow, orange, red, black) on
  a burnair-style scale, thresholds supplied and recorded in `handover.md` along
  with the marker geometry. Colour comes from wind speed only. **Average and gust
  use two different threshold tables**, the gust bands sitting 8–10 km/h higher —
  which is what turns a hotter rim into real information instead of a constant.
  No placeholders needed any more.
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

## Phase 3b — the overlay widget (alternative, owner's idea 2026-08-10)

A second, much cheaper widget: **draw only the arrows on a transparent page and
let it sit over XCTrack's own map.** No basemap of ours at all.

What it deletes, if it works: `pmtiles extract`, `gdaldem hillshade`, the build
step, the ~50 MB pack ceiling, the region split, Cache Storage, the download
button, and the unresolved `.pmtiles` byte-range risk. Essentially all of Phase 3.
It also *improves* on our own basemap — XCTrack's map already shows terrain, and
the pilot already knows how to read it.

**Try this one first.** Owner's call, 2026-08-10: 3b is the easy win and gets
built ahead of Phase 3, with Phase 3 kept as the durable answer that follows.

**Registration is solvable today, at fixed scales.** Owner's position, and it is
the right one: **do not wait on the XCTrack API change** — the devs are slow, and
#1097 has sat untouched since April 2024. We do not need it.

**The zoom desync is designed out, not mitigated.** Owner's insight: each XC map
in XCTrack is a widget placed on a page, so this layout uses a **dedicated map
widget pinned to a fixed scale**. chmd's observation that "there is exactly one XC
map getting changed when zoom in/zoom out inputs are sent (the map at the bottom
of the stack)" is what makes this work — a map widget that is not bottom-most
never receives zoom input, so it holds its configured scale for the whole flight.
There is then no drifting zoom to detect.

**Position, however, must track continuously.** Also owner's, and it is the real
problem with the naïve version: `${lat}` and `${lng}` are substituted **when the
widget loads**, so a URL-parameter overlay would sit at its start-of-flight
position while the XC map pans along underneath. The fix is to stop treating the
URL as the position source:

- `${lat}` / `${lng}` are a **bootstrap only**, and the fallback when "Allow web
  page to access XCTrack data" is switched off.
- `XCTrack.getLocation()`, polled, is the live centre. The probe already confirmed
  the bridge exists and exposes exactly that method.

**And this is cheap, which is the non-obvious part.** At z11 the ground resolution
is 52 m/px, so a glider at 40 km/h (11.1 m/s) moves **0.21 px/s** — about one
pixel every five seconds. Polling `getLocation()` every couple of seconds and
redrawing only when the projected centre shifts by ≥1 px is both smooth and nearly
free. `AGENTS.md`'s "minimise DOM writes and wakeups" and "the position should
adjust frequently" do not actually conflict here: the zoom is coarse enough that
frequent polling costs almost nothing.

The comments on #1235 establish that XCTrack's XC map aligns **exactly** with OSM
zoom levels at its odd scale settings, verified by overlaying airspace layers.
The full table and the reason the alignment is exact are in `findings.md`. The
one we care about:

```
XCTrack scale "6 km"  ==  mapWidget_scale.value 25  ==  OSM zoom 11
```

Which is the zoom Phase 3 already chose for its own basemap, for the same reason:
about 100 m/px, 40 km across a small widget.

So the widget hardcodes a zoom, documents which XCTrack scale to pair it with,
and uses plain Web Mercator maths. What remains unavailable:

| Needed | Available? |
|---|---|
| Map centre | Live, via polled `getLocation()` |
| Zoom | Not exposed, but **fixed by configuration** and pairable via the table |
| Rotation (north-up vs track-up) | **No.** `heading` is exposed, but not whether the map is using it — so the pilot must select north-up |
| Widget rect vs map rect alignment | **No** |

**The risk that remains.** Rotation and alignment, not zoom. If the map is left
track-up, or the widget rectangle does not sit exactly over the map rectangle, the
arrows land on the wrong terrain *while still looking authoritative* — a valley
station read as a summit station. That is the confident wrong answer `AGENTS.md`
forbids, and it is worse than no map.

Mitigations, in order of how much they actually buy:

- The widget **states its assumptions permanently** — a `6 km · z11 · N↑` badge —
  to be read against the scale XCTrack already displays. A mismatch becomes a
  visible disagreement between two labels rather than silent drift.
- Arrow *positions* are the only thing at risk. The `avg/gust` numbers, colours,
  names and altitudes stay correct regardless, so a desynced widget degrades into
  a still-useful list rather than into a lie.
- It is a **second** widget, offered alongside the real one, never a replacement.
- Keep it visually thin, and prefer our layer **on top** — chmd stacks the web
  page below a transparent XC map, which would put airspace lines and the track
  across our arrows.

**Feasibility unknowns to settle before building — all measurable in one test
layout:**

1. **Is the map scale in CSS pixels or device pixels?** The probe measured DPR 3.
   Guessing wrong scales every offset by 3×. This is the single biggest risk to
   registration.
2. **Does XCTrack centre the map exactly on the pilot,** or offset it (many
   navigators place the aircraft low on screen when moving)?
3. **Does a non-bottom-most map widget really hold its scale** against zoom input?
4. **Is north-up settable per map widget** or only globally?
5. **Does XCTrack ever re-substitute `${lat}`/`${lng}`** — i.e. reload the widget —
   or is it strictly load-time?

Answer 1 and 2 with chmd's airspace method below; 3 and 4 by trying it; 5 by
logging whether the page ever re-navigates.

**Acceptance test, borrowed from chmd:** overlay against a layer that exists in
both renderings and toggle it. Airspace boundaries are hard-edged and shared, so
they prove registration to the pixel. Do this before trusting any arrow position.

**Sequencing worth considering.** Phase 3b is dramatically cheaper than Phase 3 —
no build step, no packs, no storage, no byte-range risk — and it reuses the zoom
level Phase 3 had already picked. Phase 2 → 3b is a much shorter path to
something useful in the air than Phase 2 → 3. Shipping 3b first, and treating our
own basemap as the durable answer that follows, is probably the better order.
Owner's call.

## Phase 4 — polish

`size` / `theme` / `range` / `max` parameters, radar orientation, README,
and an update to AGENTS.md.

---

## Decisions still open

1. **Repo name.** `windgrade` is a placeholder.
2. ~~**Rating thresholds.**~~ **Closed 2026-08-10.** Six levels, burnair-style,
   with separate km/h tables for average and gust — see `handover.md`. Three
   smaller questions it left behind:
   - Are the band boundaries half-open as interpreted (`< 7`, `< 15`, …)? The
     bands as given are integers, the data has decimals, so 6.4 km/h otherwise
     has no colour.
   - Does the mandatory white halo sit *outside* the near-black stroke? Needed
     now at both ends of the scale: black fill on dark terrain, white fill on
     light terrain.
   - ~~Where does the speed number sit?~~ **Answered** by the SeeYou reference in
     `handover.md`: a compact `average/gust` text pair beside the arrow, on the
     map as well as in any detail view.
   - ~~Which way does the arrow point?~~ **Answered: downwind.** Both winds.mobi
     `w-dir` and MeteoSwiss `wind_direction` are from-bearings, so render at
     `bearing + 180`.
     Arrow geometry, label treatment and the calm glyph are all specified in
     `handover.md`, copied from SeeYou Navigator.
3. **First region.** Leaning Switzerland split into a few sub-50 MB packs,
   rather than one Alps-wide file.
4. ~~**Providers.**~~ **Closed 2026-08-10 — winds.mobi.** It aggregates 13
   networks including Holfuy, MeteoSwiss and 141 high-alpine SLF stations, in one
   CORS-open call with no key, already in WGS84 and km/h. The Holfuy permission
   gate disappears: we no longer talk to Holfuy at all. MeteoSwiss-direct stays
   as a second provider module for resilience, not as the primary.
   One follow-up, and it is an email not a code change: winds.mobi's terms
   require identifying calls with a `User-Agent` header, which browsers forbid
   `fetch()` from setting. Ask Yann (`info@winds.mobi`) whether the automatic
   `Origin` header suffices. Do not just ignore the rule.
5. ~~**Units.**~~ **Closed 2026-08-10 — km/h, confirmed not assumed.**
   winds.mobi's OpenAPI schema documents `w-avg` and `w-max` as `[km/h]`, and the
   rating thresholds are km/h. No conversion anywhere in the pipeline.
