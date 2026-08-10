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
| ~~Does a `tel:` link open the dialer?~~ | **Answered by `hx-call`, no probe needed. It does not.** Measured on Android 17 / WebView 150: anchor `tel:`, `tel:` by assignment, `intent://…ACTION_DIAL` and `window.open` all land on "Web page not available", which *strands the widget there until it reloads*. `navigator.clipboard` works, so `hx-call` copies the number instead. Irrelevant to windgrade except as proof that non-http schemes are unusable — and as confirmation that the probe's "Copy results as JSON" button is sound. |

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

**Two poll rates, and the difference is deliberate.** `hx-call` polls position
every 60 s and warns not to lower it, because its data changes on a 15–30 minute
cycle and battery matters more than freshness. That reasoning holds for
*readings* here too — the ~10 minute fetch cadence. It does **not** hold for the
overlay in Phase 3b, where position is a *rendering* input that has to track
XCTrack's own 2 Hz map redraw. Same discipline, different conclusion: gate the
work, not the poll. Poll at 2 Hz, but redraw only when the projected centre
shifts by ≥1 px, which at z11 is roughly once every five seconds anyway.

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

## Phase 3b — the overlay widget  ✅ REGISTRATION CONFIRMED 2026-08-10

**It works.** `tools/registration.html`, stacked on an XCTrack map widget at
**8 km / North-up** with a valid GPS fix, aligned to the owner's satisfaction
against airspace edges. Full numbers in `findings.md`. The calibration:

```
XCTrack "8 km"  ==  our z11 × 0.942  ==  54.95 m/px  ==  fractional OSM zoom 10.914
```

**The correction is the finding.** XCTrack's ladder is *not* on integer OSM zoom
levels — it sits a constant 1.062× coarser, −0.086 of a zoom level. chmd's table
gets the pairing right (8 km ↔ z11) and the scale wrong, so it cannot be used
without this factor.

**Confirmed at three steps** (15 km/z10, 8 km/z11, 4 km/z12) with `zEff` spacing
of exactly 1.000, which also proves two things worth having: the printed labels are
merely rounded (15 ÷ 8 = 1.875 would have given 0.907 spacing), and the setting is
a **resolution**, not a ground distance fitted to the widget — so the correct zoom
does not depend on widget size. The complete model is one line:

```
m/px = 156543.034 · cos(lat) / 2^z / 0.942        4km=z12  8km=z11  15km=z10  30km=z9
```

Left to check, low risk: whether 0.942 is latitude-independent (one run in Valais
or Ticino), and widget-size independence, which is inferred from the spacing rather
than measured.



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
in XCTrack is a widget placed on a page, and **both scale and rotation are
per-widget options**. So this layout uses a **dedicated map widget** with the scale
set to a value from the table and rotation pinned to north-up, and those settings
hold for the flight. There is no drifting zoom left to detect, and no reliance on
the pilot remembering anything mid-air.

chmd's related observation — "there is exactly one XC map getting changed when zoom
in/zoom out inputs are sent (the map at the bottom of the stack)" — adds a second
layer of safety: if our map is not the one receiving zoom input, no gesture can
reach it. Whether a gesture *can* override a per-widget scale on the map that does
receive it is the one thing left to check, and it does not matter if ours never
receives any.

**Position, however, must track continuously**, and the URL cannot do it. The
owner's instinct was right; `hx-call`'s notes make the mechanism precise, and it
is worse for an overlay than "stuck at the start position":

> "with `${lat}/${lng}` substitution XCTrack reloads the whole page periodically"

So placeholders *do* update — by **reloading the entire page** at the widget's
configured refresh rate, which `hx-call` recommends setting to 60–120 s when using
them. For a map overlay that is the wrong mechanism twice over: a 1–2 minute
position step is far too coarse, and every step throws away the canvas, the
station cache and any in-flight fetch.

Hence the required configuration, straight from `hx-call`:

- **Refresh rate 0** — no reload at all — with **"Allow web page to access XCTrack
  data" ON**. This is the documented pairing: refresh 0 with the JS interface,
  60–120 s only when relying on placeholders.
- `XCTrack.getLocation()`, polled at ~2 Hz, is the live centre. It is a **pull**
  API returning a JSON string or `"null"`, with an `isValid` field — which is why
  it is polled rather than subscribed. The probe confirmed the bridge exists and
  exposes exactly that one method.
- `${lat}` / `${lng}` stay as the **fallback** for a pilot who leaves the JS
  interface off. `hx-call` also records the failure mode to copy: an unsubstituted
  placeholder arrives as the literal string `${lat}`, parses to `NaN`, and must be
  *ignored* so the chain falls through to the next source rather than rendering a
  wrong position.
- **"Allow tapping on the web page when locked" must be ON** if the widget is ever
  to be interactive in flight. `hx-call` lists this as one of the two settings
  pilots reliably get wrong.

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
| Zoom | Not exposed, but **fixed per widget** and pairable via the table |
| Rotation | **Fixed per widget** — north-up pins and holds |
| Widget rect vs map rect alignment | **Handled by the layout** — see below |

**The layout, owner's decision 2026-08-10.** Two widgets stacked over the exact
same area: XCTrack's native map underneath with the dedicated settings, our
WebView widget **on top** with matching settings. So alignment stops being
something the code has to discover — the pilot builds it into the layout, and our
canvas rectangle *is* the map rectangle. Our layer being on top is also the right
way round: chmd stacks the web page below a transparent XC map, which would run
airspace lines and the track across our arrows.

Scale handling: **follow the table from the issue queue blindly and test whether
it works.** No derivation, no cleverness. The airspace-overlay check below is what
says yes or no.

**The risk that remains is setup, not geometry.** Zoom and rotation are pinned per
widget, and the rectangles match by construction, so what is left is a pilot who
pairs mismatched settings — our widget at z11 over a map set to 12 km. If that
happens the arrows land on the wrong terrain *while still looking authoritative*,
a valley station read as a summit station, which is the confident wrong answer
`AGENTS.md` forbids. Hence the permanent on-screen badge below: it exists so a
mis-pairing is readable against the scale XCTrack already displays.

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

**Feasibility — all five unknowns answered, 2026-08-10.** Four by the owner, one
by deduction. The questions were: CSS or device pixels; does the map centre on the
pilot; does a non-bottom map hold its scale; is north-up per widget; and are
`${lat}`/`${lng}` load-time only.

1. **Scale is a per-widget option, chosen in kilometres** from the same list as
   the table's "Map scale" column. The pilot picks `6 km`; no config-file editing.
   **But the label is not the geometry.** At z11 a 448 px widget spans 23.3 km,
   not 6 km, so `6 km` denotes something else — a scale-bar length or a nominal
   radius. Never derive the projection from the label; use chmd's verified table.
   Because OSM zoom is a *resolution* in m/px, the pairing holds at any widget
   size: widget size changes the area covered, not the scale.
2. **CSS pixels, by deduction.** chmd verified alignment against spotair, a web
   map whose z11 is CSS-pixel based. Had XCTrack's scale been in device pixels the
   airspace outlines could not have matched at DPR 3. So compute geometry in CSS
   px and cap the canvas backing store at DPR 1–2 per `AGENTS.md`. Still worth
   confirming in the airspace test — this was the largest single risk.
3. **The map centres on the pilot**, with a small lag before redrawing. XCTrack's
   screen redraw rate is a **global** setting, currently 2 Hz. At z11 that lag is
   0.5 s × 0.21 px/s ≈ **0.1 px** — negligible. Poll `getLocation()` at the same
   ~2 Hz so both layers lag equally and the *relative* offset stays near zero.
   This scales with zoom: at z15 (3.3 m/px) the same glider moves 3.4 px/s, so
   0.5 s is 1.7 px and matching the cadence begins to matter.
4. **Rotation is per widget**, so north-up pins on our dedicated map and holds
   for the flight.
5. **Placeholders do trigger reloads** — see the correction below.

What "non-bottom map" meant, since it was unclear: chmd reported that zoom input
reaches only the map at the bottom of the widget stack, so I was reaching for a
map that no gesture can re-zoom. Given that scale is a per-widget setting like
rotation, the concern largely dissolves. The only residue worth a glance during
the test: **can a zoom gesture override the per-widget scale on whichever map does
receive it?** If ours never receives zoom input, it cannot.

**Acceptance test — `tools/registration.html`, built 2026-08-10.** Live at
`/windgrade/tools/registration.html`. No data, no arrows; it exists only to answer
whether the overlay can be registered at all. Three independent checks, ordered by
how much they isolate:

1. **Centre cross vs XCTrack's aircraft symbol** — centring alone, and it needs no
   external coordinates, so nothing of ours can contaminate it.
2. **Range rings (5/10/20/40 km) vs XCTrack's scale bar** — scale, to eyeball
   precision. Catches a gross error, not a 10% one.
3. **Airspace outlines vs XCTrack's airspace layer** — the whole transform at once,
   to the pixel. This is chmd's method, so our result is directly comparable to the
   measurement that produced the table. Polygons come from SHV
   (`airspace.shv-fsvl.ch/api/v2/geojson/airspaces`, CORS `*`, 328 rings), the
   endpoint `hx-call` already documented.

On-screen buttons change integer zoom and a fine ×multiplier, so the answer is a
*measurement* rather than pass/fail: if alignment needs ×3, XCTrack's scale is in
device pixels rather than CSS pixels; if a different integer zoom lines up, the
table is wrong for this build. Either outcome is a result worth recording.

Caveat when reading check 3: XCTrack draws airspace from its own OpenAIR files,
which may be a different vintage than SHV's API. A consistent *offset* across many
polygons is a registration error; one polygon disagreeing is probably data.

Projection maths verified numerically before shipping: 52.086 m/px at z11/47°N, a
10 km ground offset round-trips to 10.000 km, and x/y isotropy is within 0.08%.

**Sequencing worth considering.** Phase 3b is dramatically cheaper than Phase 3 —
no build step, no packs, no storage, no byte-range risk — and it reuses the zoom
level Phase 3 had already picked. Phase 2 → 3b is a much shorter path to
something useful in the air than Phase 2 → 3. Shipping 3b first, and treating our
own basemap as the durable answer that follows, is probably the better order.
Owner's call.

## Phase 3c — zoom sync  ❌ REJECTED 2026-08-11

**Tested, answered no, removed the same day.** A tap over the web widget never
reaches an XCTrack widget underneath it — not in any mode, not in either layer
order. The widget and the zoom buttons are strictly exclusive, so the overlay can
never learn that the map zoomed, and a zoom it cannot see is arrows on the wrong
terrain with nothing to detect it. Raw log and the full table in
`docs/findings.md`.

`pointer-events: none` was the last hope and it is the informative failure: the
page stopped being a hit target and XCTrack *still* received nothing. The WebView
consumes the Android `MotionEvent` regardless of what the page does with it, so no
CSS or JS trick can decline it on the page's behalf.

**Removed:** the `zspan` parameter and the `coarsestStep` / `coarsestZoom` /
`finestStep` helpers. `widget.html` fetches at the configured zoom again. Total
cost of the detour: one probe, one parameter, three helpers — because `zspan`
defaulted to 0, nothing ever shipped a wider fetch on the strength of an
unproven feature.

**Kept, and not part of this feature:** `zoomForStep`, `stepForZoom` and
`XCT_LADDER`. They are how the configurator offers XCTrack's own 23 scale labels,
and they are what made `5km` and `10km` selectable at all. The closed-form ladder
derivation stands on its own measurement.

**Kept as evidence:** `tools/tap.html`, with the verdict written into it. If a
future XCTrack build ever answers "both", the feature becomes buildable and the
maths is already done.

**What the probe found instead, which matters more.** With *Allow tapping on the
web page when locked* **ON**, the overlay swallows every tap over its area —
including the ones meant for the pilot's own zoom buttons underneath. The overlay
has nothing to tap; it is a passive layer. So the setup instructions now say to
leave tapping **OFF**, and the pilot keeps the zoom controls they already rely on.
A probe built to test a feature turned up a regression in the recommended setup,
which was worth more than the feature.

**Still open from it:** only "tapping off + widget in the background" preserves the
zoom buttons. Does XCTrack's XC map then draw over the arrows? That is chmd's stack
— web page below, transparent XC map above — which works visually but runs airspace
lines and the track across the markers. Needs one look on device.

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
