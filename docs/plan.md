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

## Phase 3d — scale bar, and an opt-in manual zoom (2026-08-11)

The owner's workaround after zoom sync was ruled out, plus the piece of it that
turned out to be worth having on its own.

### The scale bar — shipped, on by default

XCTrack prints a scale bar bottom-left: a label over a bracketed line. We now draw
**our own bar, at the same ground distance its label names, just above it.**

Comparing *lengths* is a strictly better check than comparing *labels*, and that is
the whole reason it exists. Matching labels with mismatched lengths means the
calibration is wrong for this device or this latitude — which no amount of reading
the settings would reveal, and which the badge alone cannot catch. It also gives
the outstanding latitude check a permanent, passive form: fly to Ticino and the
bars either still agree or they do not.

At z11 an 8 km bar is 145.6 CSS px; the owner's screenshot measured XCTrack's at
roughly 150, consistent within eyeball error and with the calibration already
verified against airspace edges.

### Manual zoom, `ztap=1` — off by default, and it must stay off by default

Owner's proposal: move XCTrack's zoom buttons **outside** the widget rectangle, tap
the widget to change *its* scale, then re-zoom the map by hand to match, using the
two bars to confirm.

Clunky, and the owner said so. It works because the conflict found on 2026-08-11 is
only about *overlap*: the widget swallows taps over its own area, so buttons placed
elsewhere are unaffected.

Why the default matters more than the feature: **any tap zone here is a zone taken
away from XCTrack.** With `ztap=0` the widget creates no hit targets at all, and the
pilot keeps every control they had. So this is opt-in, and the normal setup stays
one scale, set once, correct by construction.

**The widget cannot verify the map followed.** So while the scale differs from the
configured one, the badge says `SET MAP` in amber — amber, not red, because red
means the data is stale and conflating the two would blunt both. Tapping the badge
resets to the configured scale. The widget never claims a sync it cannot see.

### Can the JS API drive the map? No.

`getLocation()` is the entire interface — confirmed by the documentation and by the
probe, which enumerated exactly one method. There is no `setMapScale`, and nothing
else that touches the map.

**Worth asking the developers, and the existing issues ask for the wrong shape.**
[#1235](https://gitlab.com/xcontest-public/xctrack-public/-/issues/1235) asks for
the zoom as a **URL placeholder**, `${osm_zoom}`. That would force a full page
reload on every zoom change, which for a canvas overlay throws away the canvas, the
station cache and any in-flight fetch — precisely why our setup requires refresh
rate 0. The better ask is a **read** on the JS interface:

```
XCTrack.getMapScale()   ->  mapWidget_scale.value, or its OSM equivalent
```

Polled like `getLocation()`, that solves the whole problem with no taps, no dead
reckoning and no manual step — and it is a smaller change than a write API, which
nobody needs. Reading beats writing here: the widget only ever wants to *follow*.

## Phase 3e — tap a marker for its trend (2026-08-11)

Owner asked whether station history was available; it is, it is CORS-open and it
costs ~0.5–1 KB per station for a few hours. Numbers in `findings.md`.

Tapping a marker opens a panel with the station's name, altitude, distance,
provider, current `avg/gust`, direction and age, then a **trend strip**: the same
marker geometry at small size, one per sample, oldest left to newest right. Tap
anywhere to dismiss; it also closes itself after `popup` seconds (default 30, `0`
keeps it until dismissed), because a panel left open over a moving map hides the
thing it sits on.

Modelled on SeeYou's station popup, which the owner supplied as the reference. The
trend is what makes it worth the tap — it is purely descriptive, so it breaks no
rule, and it answers the question a single reading cannot: building or easing.

### Tap precedence, and why it needs stating

Three things now want the same pixels, so the order is fixed and deliberate:

```
1. a marker under the finger   -> open its popup
2. a popup already open        -> dismiss it
3. otherwise                   -> the zoom zone's action, if any
```

A marker tap must never be eaten by a zoom half that happens to cover the same
pixels, and a dismissing tap must never also zoom. Markers are hit-tested against
the positions actually drawn, nearest first so overlaps resolve predictably.

### Zoom controls, now two independent options

Owner wanted the `ztap` zoom moved to a dedicated button while keeping the
invisible halves available. They are separate parameters and compose:

| | |
|---|---|
| `ztap=1` | the invisible 50% halves — top finer, bottom coarser |
| `zbtn=1` | a small `+` / `−` pair, bottom right |

Both default off. That default is still the important part: with tapping enabled
the widget swallows every touch over its area, so any control here is one taken
away from XCTrack.

**All of this needs "Allow tapping" ON**, which means the pilot's own zoom buttons
must live outside the widget rectangle. That is the same constraint the manual
zoom already had, and it is the price of any interactivity at all.

Every one of these is in the launcher's configurator, generated from `SPEC`, and
the launcher carries an "Interactive mode (optional)" section explaining the
trade — including that turning tapping on costs the pilot their own zoom buttons
over the widget area.

### Placement, after the first device run

- **The two bars close on each other like facing brackets.** Ours draws its end
  ticks pointing **down**, XCTrack's point up, so the four tick ends line up in a
  single vertical glance. That turns the check into a shape-match rather than a
  length estimate, and it works without reading either number. Same left inset
  (15 px, matching XCTrack's), number centred **above** the line so the gap
  between the bars stays clear.
- **`barY` tunes the vertical gap** and is a parameter rather than a constant,
  because XCTrack's bar height is device-specific and guessing it wrong is the
  difference between "easy to compare" and "useless".
- **The off-scale message is a prompt, not a banner.** A full-width bar at the
  bottom covered XCTrack's own scale — the very thing it was asking to be
  compared against, so it made itself pointless. It is now a compact `set map ↓`
  chip directly above our bar, pointing at the pair, and it **fades after 15 s**:
  being told once is enough.
- **The lasting signal is quieter and better placed.** While the scale is offset
  the bar's *number* is drawn amber — permanent, unobtrusive, and sitting on the
  exact value that needs comparing. Reset lives on the badge, which never fades,
  as well as on the prompt while it is up.
- **The zoom buttons never move**, and their placement is the pilot's: any corner
  or edge centre via `zpos`, stacked or side by side via `zrow`. The widget shares
  its rectangle with XCTrack's own controls and only the pilot knows what is
  already there — the row layout exists so a second pair, driving XCTrack's map,
  can sit beside ours.
- **The prompt sits beside the bar, not above it**, with the arrow pointing back.
  It says *where* to look as well as what to do, and it is the one place that
  neither stacks into a corner nor covers XCTrack's own bar. *(Superseded by
  Phase 3f: the wording and both coordinates changed.)*

## Phase 3f — the overlay's furniture (2026-08-11)

Owner review on device, after the pixel-density work landed. Four changes and
two bugs found while making them.

### The popup follows the theme

It was hardcoded dark. It now honours `?theme=` by the same
`<html data-theme="dark|light">` convention `base.css` uses — **restated inside
`widget.html`**, because that page cannot load `base.css`: its `<body>` must stay
unpainted or it stops floating over XCTrack's map. Same token names and values,
so the two cannot drift in meaning even though they must be maintained twice.

**Only the popup is themed.** The status line, the prompt and the scale bar sit
on XCTrack's map, where they need contrast against *terrain* — snow, grass,
rock — not against a page. They stay dark-on-light at every setting. The peak
triangle's hardcoded `#54A6DC` moved to `var(--chart)` with the rest.

### The prompt: `← Check scale!`, and it stopped sliding

Its left edge used to follow the bar's right end, which moves with the scale —
so the prompt slid sideways every time the pilot zoomed. Movement reads as a
fault, not as a pointer.

It is now fixed at `BAR_X + WG.BAR_MAX_DP + 8`. `BAR_MAX_DP` is the bar's ceiling
*by construction*, so this clears the bar at every scale — ours and XCTrack's
alike — without ever covering either, and it clamps to the viewport on a widget
too narrow to hold both, because a prompt hanging off the edge says nothing.

Vertically it is centred on the **gap between the two bars**, so the arrow points
at the pair rather than at ours: the instruction is to *compare*, not to look.
Measured from the element rather than assumed, so it stays centred if the text
changes. Verified at chip centre 731.1 against a gap centre of 731, and it tracks
`barY` (at `barY=70`: 719.1 against 719).

`XCT_BAR_Y = 10` css px, XCTrack's own bar height off the bottom, taken from the
two ruler runs. Nothing about the geometry depends on it — only this centring.

### The status line, cut back and off by default

It led with the assumed scale and `N↑` permanently. Both are redundant: the bar
shows the scale against XCTrack's **own**, which is the comparison that actually
catches a mis-pairing, and north-up is required setup rather than news. They are
behind `?debug=1` now, which also forces the line on whatever `badge` says.

    default            hidden
    ?badge=1           26 stations (3 stale)
    ?debug=1           10km N↑  26 stations (3 stale)

**The alarms are not switchable.** `no position`, `OFFLINE` and `ALL STALE` show
with `badge=0` — they are the display admitting it cannot be trusted, and no
cosmetic setting may turn that off. Verified.

### FOUND: `badge=0` was inert

It suppressed nothing. It only shrank the marker keep-out rectangle, so the
setting appeared to do something while the line stayed on screen. Fixed with the
above. The keep-out rectangle is now measured off the element for the same
reason: the line can appear *despite* `badge=0`, and the old `190x26` constant
never described the shortened text anyway.

### Optional station altitude, `?alt=1`

A second line under the speed. Offerable at all only because it is a **fact the
provider supplies** — no inference, no interpolation. And it is the fact this
tool exists for: a station *name* cannot tell a pilot who does not fly the area
whether a reading came from a valley floor or a 2900 m ridge.

| | speed | altitude |
|---|---|---|
| size | `fs` | 78% of `fs` |
| weight | 700 | 600 |
| colour | `#0A1116` | `#3A4A56` slate |
| casing | white | white |

- **The speed stays dominant.** Not cosmetic: the speed is the mandatory fallback
  for the rating scale's hue-only middle, so nothing may compete with it.
- **The unit is included** — `2870m`. A bare number under another bare number
  invites being read as more wind, and 2900 would be a spectacular misreading.
- **A missing altitude draws nothing** — not a dash, not a zero. The provider not
  knowing is different from the station being at sea level.
- **Staleness stays on the speed only.** Red means *this reading is old*; an
  altitude cannot be.
- Off by default, and the collision box grows by exactly the line height, taken
  from the renderer rather than guessed — so fewer markers fit with it on. That
  is the honest trade.

Checked over snow, grass, rock and dark rock with an airspace line and a river
crossing the markers, at sizes 0 and 100: the smaller text is where legibility
over an arbitrary basemap fails first.

## Phase 3g — coverage: the map was showing half of what it had (2026-08-11)

Reported from Piedmont: `?scale=25000&lat=44.88&lng=7.33` drew 15 markers and
appeared to omit sites the owner knows. Full probe in `docs/findings.md`; the
short version is that the fetch was fine — 125 stations arrived — and four
things downstream of it were not.

**The cull now runs before the cap.** `prepare()` takes an optional lat/lon
rectangle. Distance ranking is a circle and a widget is a tall rectangle, so
17 of `max`'s 40 slots were being spent on stations off the sides. The widget
passes its view; `app.html` passes nothing, because a list genuinely does want
the nearest regardless of any view. A rectangle rather than a predicate, so
`core.js` stays DOM-free and the behaviour is testable — six assertions,
including the discriminating one: a station that is *nearer* but off-screen
must lose its slot to a farther one that can be drawn.

**`max` 40 → 120** (ceiling 200 → 400). What limits a map should be collision
eviction, which knows about pixels, not a cap that does not.

Measured on the same 125 records: 17 → 30 markers at 448 × 978, 20 → 41 at
540 × 1097.

**`bboxAround` follows `getCal()`, not the raw `CAL`.** The projector already
did. The two disagreeing meant that on a screen denser than the dpr-3
reference, the view covered more ground than the box and the edges were never
fetched at all. Counter-intuitively this also *stabilises* `app.html`, whose
box is a nominal widget: `zoomOf()` already compensates for density, so the
raw `CAL` was double-counting and gave a 331 × 676 km box at dpr 1 against
143 × 265 at dpr 3.

**The station name shown is now the owner's, not the geocoder's.** For
openwindmap.org — the largest network in that area — winds.mobi's `name` is a
municipality and `short` is what the site is actually called. "Decollo
TRUCETTI" was on screen all along, labelled "Valgioie". `normalise()` swaps
them and keeps the municipality as `place`, shown first in the subtitle: it is
still the word a pilot who does *not* know the area can place on a map, so it
earns its space, just not the headline.

**`BOX FULL`.** The API truncates at 500 with no documented ordering. A
Piedmont box holds 161 but a Swiss one 309–356, so a wide scale over the dense
Alps can hit it. `meta.capped` is reported and the status line says so
whatever `badge` is set to — a map that is missing stations it never heard
about is exactly the class of thing that must announce itself.

**Left alone, deliberately:** `is-highest-duplicates-rating=true` (all 30 of
its drops in the sample were either 0–30 m co-locations or a twin hours out of
date) and the `stale × 4` server-side age filter.

## Phase 3h — the configurator was an inventory, not a configurator (2026-08-11)

Nineteen flat rows, in SPEC order, with the two that decide whether the overlay
works at all buried among fetch margins and pixel-density overrides.

**Two rows up front: `Map scale` and `Show station altitude`.** Everything else
went behind one collapsed `<details>`, grouped by heading:

| Group | Rows |
|---|---|
| Which stations | `peaks` `max` `pad` |
| How old is too old | `warn` `stale` `poll` |
| Scale bar | `bar` `barY` |
| Status line | `badge` `debug` |
| Tapping and zoom | `popup` `hours` `zbtn` `zpos` `zrow` `ztap` |
| Text and colour | `size` `theme` |
| Calibration — you should not need these | `dpr` `cal` |

Driven from SPEC by a new `grp` field, so this is still one renderer and still
cannot drift. **A row with no `grp` is on the front page** — the default is
that way round on purpose, so a new parameter has to argue for the front rather
than be noticed and demoted later. `tools/test-core.js` asserts the ungrouped
set is exactly `scale,alt`; adding a parameter without a group fails the suite.

Groups are headings, not nested accordions. The second click buys nothing once
the first has been paid, and a phone's find-in-page cannot see inside a closed
`<details>`. Empty groups are dropped, which is what lets `app.html` reuse the
same renderer with `skipWidgetOnly` and get four groups instead of seven
without a heading left dangling.

`adv:true` → **`hidden:true`**. It never meant "show under Advanced" — it means
no control anywhere while the parameter keeps working in URLs — and with a real
Advanced section on the page, the old name was a trap. Only `step` uses it.

Found on the way: the enum `<select>` was a fixed 92 px, which clipped
`bottom-right` to `bottom-` — a different setting, as far as a reader is
concerned. Now `width:auto` with a floor and a 45% cap.

`index.html#advanced` opens the accordion, so a note or a bug report can point
straight at a setting.

## Phase 3i — the scale list stops where the data does (2026-08-11)

Follow-on from 3h, owner's review: the *Map scale* description was a
paragraph, it carried a `≈ z11.0` badge that means nothing to a pilot, and the
select offered scales up to 1000 km.

**The list now stops at 30 km.** Not for rendering cost — for correctness.
winds.mobi caps a query at 500 stations and the fetch box grows with the
square of the scale, so past about 40 km a wider scale does not show *more*,
it shows an arbitrary thinner sample spread over half a continent. Measured
over Interlaken, the densest area we serve:

| scale | fetch box | returned | payload |
|---|---|---|---|
| 8km | 65 × 94 km | 98 | 24.0 KB |
| 15km | 90 × 148 km | 183 | 44.6 KB |
| 30km | 139 × 256 km | 351 | 85.7 KB |
| 40km | 180 × 346 km | **503** | 123.2 KB |
| 50km | 238 × 473 km | **389** | 95.8 KB |
| 100km | 437 × 906 km | **265** | 66.1 KB |
| 800km | 2284 × 4939 km | 478 | 121.3 KB |

Fewer stations from a bigger box, from 50 km up. 39 options became 24.

`scale` itself is unchanged — a URL may still ask for 200 km, and the widget
already says `BOX FULL` when the answer came back truncated. A value outside
the offered list gets an extra option labelled *(from the URL)* so the select
still shows it; without that it would render **empty**, which is the exact bug
that shipped once before and was caught by a screenshot rather than a test.

**The `≈ z` badge is gone.** It was the last place the configurator still spoke
in ladder steps, and the number was approximate by construction — the launcher
cannot know the pilot's pixel density. Nothing depended on it.

**Every `help` string rewritten.** They were written for whoever was building
the thing: "Cap AFTER the view cull", "resolves your scale into the right step
on YOUR screen", "provider-supplied fact, not a guess". One or two short
sentences each now, read one-handed on a phone. The reasoning did not go away
— it moved into comments beside each SPEC entry, into HTML comments beside the
page prose, and into this file. The `index.html` notes were cut the same way;
the safety warning keeps its force but lost a clause.

**FOUND while screenshotting it: the safety warning's bold text was
unreadable in light theme.** `.warn b` was hardcoded `#F6D9A8`, a dark-theme
tint, on a `#FDF3E0` panel — so the *emphasised* words in the one box that
says "these colours are not a safety verdict" had the least contrast in it.
Now `--amber-str`, defined per theme like everything else. Checked in both.

## Phase 3j — the launcher, rewritten for a pilot (2026-08-11)

Third pass on the same page, owner's review. The settings were fixed in 3h/3i;
this is the prose and the shape around them.

**The setup is now three numbered steps** — choose a scale, get the link onto
your phone, set it up in XCTrack — instead of a configurator followed by
undifferentiated notes. Step 3 prints the scale the pilot actually chose
(`#stepScale`, refreshed with the URL), so nobody has to remember a number
while scrolling, and the XCTrack settings are nested under the widget they
belong to rather than listed flat.

**Two top buttons became one.** The old pair offered *XCTrack overlay →*
pointing straight at `widget.html`, which in an ordinary browser is a
transparent page of arrows floating on nothing. It looks broken and it is not
how anyone should obtain the overlay — the URL box and the QR code are. The
list stayed, and moved up: it works anywhere, needs no setup, and is the only
thing that shows a stranger what this is in one tap. It is now the page's one
primary action.

**The intro said what is wrong with other tools before saying what this one
does.** A pilot who has just arrived does not yet care.

**`grp:"Tapping and zoom"` → `grp:"Interactive mode"`.** All six parameters
were already in one group; the group was simply not called what the guide
calls it, so the guide could not point at it. Now it can, and does.

**Tools moved to `tools.html`.** Six diagnostic pages at the bottom of the
launcher were six things to scroll past for a pilot who will never open any of
them. The new page groups them by what they answer — registration against
XCTrack, the marker itself, what a device can do — with a sentence each saying
when you would want it, and the launcher links to it from the footer. `sw.js`
`CACHE` bumped to `v3` for the new file.

## Phase 3k — the list page, brought up to the same standard (2026-08-11)

`app.html` had had none of 3f–3j applied to it. Its header read

    src=url  44.88000,7.33000
    scale 8km ≙ z9.0  ·  1.8 KB · 15 ms  ·  5 s ago  ·  7 stations

which is four facts a pilot cannot act on and one they can.

**One plain sentence instead.** *"96 stations near you, closest first. 9 are too
old to trust."* Everything else moved behind `?debug=1` — the same switch the
overlay uses, so a bug report from either page shows the same fields. That
required dropping `only:"widget"` from `debug` and giving it its own group,
**Troubleshooting**, at the end of the list; its label is now *Show technical
details* rather than *Debug in the status line*.

The sentence also carries the two things that are not visible by looking:
every-reading-stale, and `capped` — *"There are more stations around you than
can be downloaded at once"*. The provider truncates at 500 with no documented
ordering, and `app.html` had been reporting that as `TRUNCATED at 503` inside a
diagnostic string that is now hidden.

**Refresh and "Setup & widget" are gone from the top.** The bar cost a full row
of a screen whose entire purpose is showing readings.

- **Refresh became the age.** A pill in the header reads `↻ just now` /
  `↻ 12 min ago`, and tapping it refetches. A button labelled "Refresh" said
  nothing about what was being refreshed or whether it needed to be; this says
  both. It goes amber past two poll intervals — the same threshold the
  overlay's status line uses, so the two pages cannot disagree about when data
  has quietly gone old. It is not load-bearing: `tick()` already refetches on
  the poll timer, so this exists to answer *how old is this* and to let a pilot
  who has just moved force the issue.
- **"Setup & widget" moved into the settings sheet**, where the same link
  already lived, and is now worded *Set up the XCTrack overlay ↗*.

**The PWA question: can a link open outside the installed app?** There is no
API for "open in the default browser". Two levers exist:

1. `target="_blank" rel="noopener"` — hands the navigation to a browser
   surface: a Custom Tab on Android, Safari on iOS, a normal tab on desktop.
2. The manifest `scope`. Navigations outside it leave the app. `scope` is
   `"./"`, and since `index.html` sits beside `app.html` the only way to
   exclude it would be narrowing scope to a single file, which would push every
   future page out too.

Took (1). Recorded because the failure it fixes is not obvious: installed, a
plain same-origin link navigated *inside* the standalone window and stranded
the pilot in a setup guide with no back button.

**Row subtitles reordered by usefulness**, which is also what decides where the
line wraps: distance and direction (which is how the list is sorted), then
altitude, then age, then the municipality and the network. The age still comes
before the attribution — that rule predates this and is why it survived the
reshuffle. `13 min` became `13 min ago`, because the bare number does not say
what it measures.

Also: `footer:empty{display:none}`, since before the first render a lone rule
across an empty page reads as broken layout; and the geolocation failure note
no longer repeats the hint the sentence above it already gives.

**Not done, and worth doing:** the overlay lets you tap a marker for its last
few hours, and the list does not. `fetchHistoric` / `normaliseHistoric` already
exist and are already used by `widget.html`; the missing part is a detail sheet
and a shared trend renderer. *(Done in Phase 3l.)*

## Phase 3l — tap a station in the list for its trend (2026-08-11)

Closing the gap Phase 3k left. The list now expands a row on tap and draws the
same recent-history strip the overlay's popup does.

**The renderer moved into `wg/marker.js`** as `WG.marker.trendHtml(samples,
opts)`, and `widget.html` was rewired onto it. Two copies of "which colour does
22 km/h get" is precisely the drift that file exists to prevent, and the
loading / error / no-history states moved with it — *"This station keeps no
history"* is a fact about the data and both pages must say it identically.
`hhmm` and `esc` came along, since both were local helpers in `widget.html`.

**Expand in place, not a bottom sheet.** A list where tapping a row opens it is
the most conventional pattern on a phone, needs no dismiss gesture to discover,
and keeps the neighbouring stations visible — which is the comparison a pilot
is actually making. The overlay needs a popup because a map has no rows.

**One open at a time.** Two open rows means two histories in flight and a list
that has to be scrolled to compare anything. Tapping the open row closes it.

**The row is a `<button>`, not a div with a click handler** — focusable, keyboard
operable, and announced as a control, for free.

**Open state is driven from `openId` through `render()`, not from the click.** A
re-render happens every 5 s and on every settings change; a panel attached at
click time would survive a station leaving the list and then be repainted into a
row that no longer exists. `syncDetail()` attaches and detaches from the ranked
list, and a station dropping out clears `openId` with it. `dropRows()` also
clears `histCache`, because `hours` may have just changed and a cached 3-hour
strip under a 6-hour heading is a quiet lie.

**`hours` stopped being `only:"widget"`** — the list needs the same setting.
`popup` stays widget-only: an expanded list row has no reason to time out.

**On demand, cached for one poll interval.** A sparkline on every chip would be
one HTTP call per station for data nobody asked to see, which is what
winds.mobi's *"do not overload"* forbids. That is why this is a tap.

#### FOUND: the oldest sample read as a wrong value

Scrolled to the newest sample, the leftmost cell is cut mid-width — and a
clipped time does not look clipped, it looks like data. The first strip drawn
showed **`5:00`** where the value was `15:00`.

Snapping to a cell boundary cannot fix it. The two edges only both align when
the viewport is an exact multiple of the cell pitch, and if one has to be cut it
must be the oldest sample, never the newest. The first attempt used
`Math.ceil(max/pitch)*pitch`, which overshoots and is clamped straight back to
`max` — it did nothing at all.

So `trendScroll()` sets a `cut` class while anything is hidden to the left, and
a left-edge gradient mask makes the partial cell read as *scrolled* rather than
as a number. Only while something IS hidden: a permanent fade would dim a cell
that is fully visible. A `scroll` listener keeps it right as the pilot swipes.

## Phase 3m — the tick loops were doing everything, every time (2026-08-11)

Reported: the list's footer rewrites itself every few seconds. It did — and
finding out why turned up a much larger waste in both pages.

#### Measured, before and after, over the same 40 s

`WG.prepare` is distance, bearing, two rating lookups and a staleness test per
station, then a sort. `localStorage.setItem` is synchronous disk I/O.

| widget.html | before | after |
|---|---|---|
| `WG.prepare` calls | **82** | **2** |
| `localStorage.setItem` calls | **82** | **2** |

| app.html | before | after |
|---|---|---|
| ticks | 10 | 4 |
| full renders | 10 | 3 |
| footer rewrites | **10** | **2** |

82 is 40 s at 2 Hz: the overlay was doing a full prepare-and-sort over every
station, plus a synchronous localStorage write, **twice a second**.

#### The three causes

**1. The guard was on the wrong side of the work.** `widget.html`'s `tick()`
computed `drawKey` — the cheap "has anything moved a whole pixel" test — *after*
calling `WG.prepare()`. Its comment said the loop was "nearly free", which was
true of the canvas repaint and of nothing else. The key is now computed first
and everything expensive sits behind it. `app.html` had no key at all and now
has one, quantised to 0.001° of position (~100 m; rows are sorted by distance
and the printed value is to 0.1 km, so reordering below that is noise), plus the
last fetch, the minute, and which row is expanded.

The minute is what makes this safe: staleness is the only thing that changes
without an input changing, and it changes at minute granularity.

**2. `remember()` wrote to `localStorage` on every call.** `position()` calls it
on every read and `setGeoFix` on every `watchPosition` callback. Now throttled to
once per 30 s, with `now` injectable so the throttle is unit-tested. The stored
value exists so a cold start with no GPS has somewhere to point the map; half a
minute of staleness there is nothing against being absent.

**3. Unconditional DOM writes.** The footer's ~250 characters of unchanging legal
text, rewritten on every render — the reported flicker. Now cached on the network
list, which can only change when a fetch brings different stations. Also
`paintAge`'s `className`, which was assigned every tick even when identical, and
`syncDetail`, which walked every ranked row running a `querySelector` on each —
120 selector queries per render for a panel that can only be attached in one
place. It now tracks where the panel is and touches at most two rows.

#### Cadence, and hidden pages

- `widget.html` 500 ms → **1000 ms**. `getLocation()` is a call across the JS
  bridge into native and XCTrack's GPS is 1 Hz, so the second poll each second
  could only ever return the same answer. Interaction does not wait for the
  tick; the zoom handlers call it directly.
- `app.html` 5 s → **15 s**. Nothing on the page changes faster than once a
  minute, so 5 s was three times the wakeups for the same display.
- **Both pause while `document.hidden`** and tick immediately on becoming
  visible, where `tick()` refetches by itself if the data is past its poll
  interval. An installed PWA left on a home screen was running a full
  prepare-and-render every 5 s behind whatever the pilot was actually looking at.

Also fixed: with no fix, `draw(null, [])` ran every tick — clearing an already
clear canvas is still a full-surface `drawImage` copy. Guarded by a `"nofix"`
sentinel in `drawKey`, which `resize()` still invalidates.

## Phase 3n — the list had a "Map scale" and no map (2026-08-11)

Owner's question: *"in the list app, what is the purpose of Map scale in the
settings if we do not have any map?"* It had one purpose, and it was worse than
a naming mistake.

`scale` on `app.html` did exactly one thing: feed `zoomOf()` and a nominal
448×978 widget to `bboxAround()`. So the fetch — and therefore the whole list —
was **a portrait rectangle about 65 km wide and 94 km tall**, borrowed from a
viewport that page does not have, while the list itself sorts purely by
distance. A station 20 km east was dropped and one 20 km north kept, with
nothing on the page able to explain the difference.

**The list now has `range`, a radius in km, default 40** — an hour of glide at
40 km/h, and close to what the old default reached. `WG.bboxRadius(fix, metres)`
builds the circle's bounding square for the provider, which only takes a
rectangle, and `prepare()`'s `keep` gained a second shape, `{r:metres}`, that
trims the corners back to a real circle. Measured on the Swiss sample: 78
stations come back inside the square, 66 survive the radius.

| | overlay | list |
|---|---|---|
| what to fetch | `scale` + `pad`, a view rectangle | `range`, a circle |
| what to show | the same rectangle, via `keep` | the same circle, via `keep` |

`scale` and `pad` are now `only:"widget"`, so neither appears in the list's
settings. `range` is `only:"app"` and is the list's single front-page row; the
launcher shows all three, ordered overlay-then-list, and `range`'s help says
which page it governs. Step 1's heading became *"choose what you'll see"*, since
it was already covering more than a scale.

`app.html`'s debug line prints `range 40 km  cap 120` in place of the ladder
step and effective zoom, which were only ever meaningful for the overlay.

Also removed: `VIEW_W` / `VIEW_H`, the fictional widget those numbers described.

## Phase 3o — nudge instead of drop (2026-08-11)

Owner, after the Zermatt diagnosis: *"if a marker will be nudged, can we still
paint it below slightly faded? just as an experiment. the reason why in Zermatt
put all those is because some reading can be important given strong valley
winds. the altitude would also be relevant."*

That reframes the problem. ZFC: Landing at 2600 m and Zermatt at 1648 m are
387 m apart on the ground — 16 px at `scale=3000` — so the old rule discarded
the valley floor reading in favour of one nearly a kilometre above it. Under
strong valley winds those are not near-duplicates, they are the question. Same
for Gornergrat over Gornergratsee and ZFC: Schwarzsee over Stafelalp.

**`nudge=1`, on by default.** A marker that would overlap is moved straight
down in `vgap` steps until it clears, up to four tries, and drawn with a leader
line back to its true position ending in a dot.

**Why this does not break "an arrow sits on its own terrain":** a nudged marker
is not claiming to be where it is drawn. The fade says it has been moved, the
line says where from. A silently displaced marker would be a lie; an annotated
one is a fact plus a label. Straight down always, so the direction is learnable.

**Nudged markers always print their altitude**, whatever `alt` says — two
markers stacked on each other are the one case where the pilot cannot tell which
reading is which, and altitude is what separates a valley floor from a ridge
950 m up. `vgap` reserves the line's height whenever nudging is on.

The badge gained `↓N`: `12 stations ↓4` at the Zermatt URL, against `9 of 12
stations` with `nudge=0`.

#### Two things the first version got wrong, both caught by screenshotting

- **The leader line ran straight through the previous marker's speed number.**
  Painting each marker as it was placed meant the next line went on top of it.
  `draw()` is now three passes — lay out, then all leader lines, then all
  markers — so a line that must cross a label is hidden behind it.
- **Fading the whole marker to 0.6 faded the NUMBER**, which is the fallback for
  a colour scale many pilots cannot separate, and it was marginal against dark
  forest. Only the arrow fades now, at `WG.marker.NUDGE_ALPHA` = 0.55; number
  and altitude stay at full strength. The pale glyph is the signal and it costs
  nothing that has to be read.

#### New instrument: `tools/nudge.html`

`leader()` moved into `wg/marker.js` so the tool draws exactly what the widget
draws. **A canvas drawn asynchronously does not survive a headless screenshot**
— that is recorded in AGENTS.md and it means the widget's own markers cannot be
checked that way. This page runs the same `WG.marker` calls synchronously over
bands standing in for snow, rock, forest, a river and an airspace edge, with the
real Zermatt offsets, nudge-on beside nudge-off, and sliders for marker size and
fade. 7 of 7 drawn against 4 of 7.

`sw.js` `CACHE` → `v4`.

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
