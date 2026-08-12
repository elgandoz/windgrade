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
calibration constant. **Pixel density is settled** — the map works in device
pixels and the correction is computed, see `docs/findings.md`.

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

  **Both tick loops compute a cheap key FIRST and put every expensive thing
  behind it.** `widget.html` keys on position quantised to a device pixel, the
  widget size, the ladder step, the last fetch and the minute; `app.html` on
  position to 0.001°, the last fetch, the minute and which row is expanded. The
  minute is what makes it safe — staleness is the only thing that changes
  without an input changing. Do not move work in front of the key: that was the
  original bug, and `widget.html` was running `WG.prepare()` over every station,
  plus a synchronous `localStorage` write, **twice a second** while claiming in a
  comment to be "nearly free" (measured 82 of each per 40 s, now 2). Compare
  before assigning, including `className`. Both loops pause on
  `document.hidden`. `widget.html` ticks at 1 Hz — `getLocation()` crosses the JS
  bridge and XCTrack's GPS is 1 Hz, so a faster poll cannot return anything new —
  and `app.html` at 15 s. `WG.remember()` is throttled to 30 s for the same
  reason; it exists for a cold start, not as a log.
- **The widget's `<body>` stays unpainted.** XCTrack renders white or absent
  backgrounds as transparent so the widget floats over its map. That is also why
  `widget.html` cannot load `wg/base.css` — so any guard living there has to be
  repeated in the widget's own `<style>`, including the theme tokens: the popup
  honours `?theme=` through a local copy of base.css's `<html data-theme>` block.
  Only the popup is themed; the status line, the prompt and the scale bar sit on
  the map, where they need contrast against terrain rather than against a page. The one that has already bitten:
  `[hidden]{display:none !important}`. The browser applies `hidden` as a
  low-priority `[hidden]{display:none}`, and any author rule setting `display`
  (an ID selector with `display:flex`, say) silently outranks it, leaving a
  supposedly hidden control on screen — mispositioned and inert, because its
  handlers are bound only when the feature is enabled.

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
m/css px = 156543.034 · cos(lat) / 2^z / CAL      CAL = 0.942 · 3 / devicePixelRatio
```

XCTrack's map scale is a *resolution* on an exact power-of-two ladder, but it is
**not** on integer OSM zoom levels — it runs 1.062× coarser, hence the 0.942.
Verified at three ladder steps against airspace edges; `tools/registration.html`
reproduces it.

**XCTrack's map is drawn in DEVICE pixels, not CSS pixels** — measured
2026-08-11 with `tools/ruler.html`, one emulator at two densities: 51.5 and 52.9
m per *device* pixel (2.8% apart) against 135.1 and 105.9 m per *css* pixel (28%
apart). So `0.942`, measured on a phone at dpr 3, has to be scaled by
`3 / devicePixelRatio`. `WG.setDpr()` does it; the pages pass
`window.devicePixelRatio`. **Computed, never configured** — do not add a
per-device setting for this. The `cal` parameter is a residual override only.

Two things that must not be used to compute geometry: the printed km labels
(rounded, and a property of the *screen* — see below), and any bar-matching done
before `setDpr` has been called.

## Running it locally

Pure static files, so any server works. There is nothing to build or watch.

    node tools/test-core.js            # engine: 105 assertions, no network
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

There **is** a service worker now (`sw.js`), so an edit takes two reloads to
appear: stale-while-revalidate serves the cached copy and fetches yours for next
time. Hard-reload, or tick *Bypass for network* under DevTools → Application →
Service workers, and it goes away. Chasing a change that "didn't take" is
otherwise a good way to lose an hour.

**The service worker caches the app shell and NEVER a reading.** The origin guard
in `sw.js` is what enforces it — providers are cross-origin, so their responses
never enter the cache. If a provider is ever added on our own origin, exclude it
explicitly. Terrain may be cached; terrain does not change, and wind does. A
cache that served a stale reading as current would defeat the staleness logic
from behind.

**Scale is chosen as a ground distance, not as a ladder step** — and it is the
OVERLAY's setting only. `scale` is in
metres and `WG.resolveStep()` turns it into a step *on the device*, because the
same step is a different scale at a different pixel density — that is exactly
how the launcher came to offer step 25 as "8km" when a Pixel 9a prints 6km. The
`step` parameter still exists as an explicit override (0 = derive) and is hidden
from the settings UI by `hidden:true`, which — unlike `ui:false` — keeps it in
URLs.

**The configurator shows two rows and hides the other seventeen.** A SPEC entry
with no `grp` is on the front page; everything else lands in one collapsed
`<details>` under its group's heading, rendered by `wg/fields.js` in SPEC order.
Ungrouped are the rows a pilot picks BEFORE a first flight, not ones they tune
afterwards: `scale`, `alt`, `peaks`, `nudge` — with `nudge` last, because it
changes where a marker sits rather than whether it appears. `range` heads the
first group, so it is the first row inside the accordion. **A new parameter has to argue
for the front page, not be demoted off it** — and `tools/test-core.js` asserts
the ungrouped set exactly, so adding one without a group fails the suite rather
than quietly lengthening the page.
Groups are headings, not nested accordions: a second click to reach "Scale bar
height" buys nothing once the first has been paid. Empty groups are dropped, so
`skipWidgetOnly` on `app.html` cannot leave a heading with nothing under it.
`index.html#advanced` opens the accordion, so a note can point at a setting.

**`help` is the pilot's text, not ours.** One or two short sentences, read
one-handed on a phone in gloves. Anything that explains *why* — a measurement,
a trap, a rejected alternative — goes in a comment beside the SPEC entry, an
HTML comment beside the page prose, or `docs/`. Every string was rewritten this
way on 2026-08-11; do not let "Cap AFTER the view cull" creep back in.

**The scale list stops at `WG.SCALE_OFFER_MAX` (30 km), and that is a
correctness bound, not a performance one.** winds.mobi caps a query at 500
stations and the fetch box grows with the square of the scale, so past ~40 km a
wider scale returns *fewer* stations spread over half a continent — measured,
see `scaleOptions()` and `docs/plan.md` Phase 3i. `scale` itself is unbounded
to its SPEC limits: a URL may ask for anything, `BOX FULL` reports truncation,
and a value outside the list gets an extra *(from the URL)* option so the
select never renders empty.

The overlay's furniture is opt-in and mostly off: `alt=1` puts the station
altitude under the speed, `badge=1` shows the station count, `debug=1` adds the
assumed scale, the in-view/fetched counts and forces the line on. Nothing
switches off `no position`, `OFFLINE`, `ALL STALE` or `BOX FULL` — those are
the display admitting it cannot be trusted.

**How many markers get drawn is decided in three places, and two of them used
to be wrong.** `prepare()` culls *before* it applies `max`, because distance
ranking is a circle and a widget is a tall rectangle — without the cull, 17 of
40 slots went to stations off the sides that could never be drawn. `max`
defaults to **120**, not 40: what should limit a map is collision eviction,
which knows about pixels. And `bboxAround`'s `mul` defaults to `getCal()` — the
same resolution the projector draws with — never the raw `CAL`. See
`docs/findings.md` 2026-08-11.

**A station missing from the overlay but present in the list is DECLUTTERING,
not the fetch.** Two stations closer together than a marker is wide cannot both
be drawn in place, and in Zermatt at `scale=3000` four pairs are 390 m to 1450 m
apart — 16 to 59 px. **Zooming in does not always separate them**: both axes must
clear and the vertical requirement is the larger, so in a north-south valley the
overlay declutters hardest along the valley. Full numbers in `docs/findings.md`
2026-08-11.

**`nudge` moves markers aside instead of dropping them**, with a leader line
back to their true position. **OFF by default** — it draws a station somewhere
it was not measured, and annotated or not that is a real cost, so the pilot opts
in. It is on the configurator's front page, not in the accordion. That is allowed to coexist with "an
arrow sits on its own terrain" only because it is ANNOTATED: the leader line
says it has been moved and where from. Never displace a marker silently.

**`WG.marker.layout()` owns the placement.** It is pure arithmetic — no DOM —
so `tools/test-core.js` asserts the rules directly and `tools/nudge.html` draws
exactly what the widget draws. Two phases:

1. **Place everything that fits, nearest first** — byte for byte what `nudge=0`
   draws. Turning nudging on never moves a marker that was already fine.
2. For each one that did not fit: **ring-search a small radius** around its true
   position and take the angle **furthest from the markers already there**; if
   no angle keeps the numbers readable, **stack it below** the marker it
   collided with.

- **A marker is TWO boxes, not one** — the arrow (`x ± box·ARROW_TOL`) and the
  narrow text column under it (`x ± tw`, from `y+box-1`). A single rectangle
  round the whole thing had to be as wide as the label and as tall as
  arrow+label+altitude, so every escape cost ~50 px whichever way it went.
- **A LABEL IS NEVER OVERLAPPED BY ANYTHING** — not by another label, not by an
  arrow — and "label" means the speed line and the altitude line together
  (`t0..t1` spans both). This is what sets how close two markers can get, and it
  should be. **ARROWS may overlap, but only PARTIALLY:** `ARROW_TOL` bounds it
  so neither swallows the other. Both halves were tried the other way round and
  both were wrong — forbidding arrow-on-arrow put markers ~50 px apart, allowing
  it without limit was too cluttered.
- **NOTHING FADES.** Every marker is drawn at full strength, moved or not; the
  leader line is the annotation and it needs no interpreting. Opacity was tried
  twice — tied to displacement, then to real overlap — and both made markers
  paler for reasons a pilot could not read off the screen. Do not reintroduce it.
- **`MAX_ROWS` bounds everything.** No marker may be drawn further than one
  stack row from where it belongs, and **the ring radii are GENERATED up to that
  same bound** — which is what stops the fallback being worse than the search.
  It was: the ring stopped at 58 px while the stack landed at 106–195 px, and
  that was "the stations at the bottom are so far apart". A marker that cannot
  fit inside the bound is DROPPED. At 225 m/px a 104 px displacement is 23 km
  from the real station and no leader line rescues that. Measured at Zermatt
  `scale=30000`: 1 row → 46 px max, 42 of 118 drawn; 2 rows → 104 px, 54 drawn;
  3 rows → 162 px, 62 drawn. Closer and fewer beats further and more.
- **The stack steps down from the marker's OWN position, not its host's.**
  Anchoring to the host and multiplying by depth compounded — one station ended
  up 195 px out because its host sat 85 px below it and the stack added 110 more.
- **The ring scores against markers NOT YET PLACED too**, at their true
  positions. Without that a displaced marker walks into the spot the next one
  needs: measured at Zermatt `scale=12000`, ZFC: Blauherd went 54 px south onto
  Gornergratsee's true position and Gornergratsee then moved 47 px itself.
- **Text width is measured PER MARKER** (`items[i].tw`), label and altitude both.
  `3/7` is barely half of `14/22`: a wide-label pair needs 48 px of clearance,
  a narrow-label pair gets away with 23. That difference is most of what makes
  the result look tight rather than scattered.
- **At most three end up in one pile** — past that they are lost anyway.
- **A DISPLACED MARKER NEVER PUSHES ONE THAT WAS NOT.** Phase 1 finishes before
  anything moves. Do not merge the phases.
- **No altitude or staleness sorting.** Phase 1 is plain nearest-first; the
  earlier "highest on top, stale to the bottom" ordering was dropped at the
  owner's request while this placement is evaluated. If it comes back it belongs
  in phase 1's order, not in the displacement.

**Cost: `draw()` runs when its key changes, not per frame** — about 0.5 Hz in
flight (one device pixel of movement) and once a minute parked. `layout()` is
the only expensive thing in it, measured at **0.71 ms for 118 markers** against
JSON.parse 607 µs (once per poll), `prepare()` 67 µs and `svg()` 0.8 µs. Two
things keep it there and both are easy to undo by accident:

- **The neighbourhood is scanned ONCE PER HIDDEN MARKER, not per candidate.**
  Every candidate sits within `maxMove` of the marker's true position and
  `NEARX`/`NEARY` already include `maxMove`, so one scan is a superset of all
  48. It was per candidate: 3,875 scans over 287,823 entries with 3,875 array
  allocations, against 87 scans over ~7,000 entries into a REUSED buffer now.
- **`conflict()` rejects on `XMAX`/`YMAX` first.** They are the exact reach of
  the four rectangle tests, and they differ per axis — a marker reaches
  `t1 + aw` (~55 px) in y but only `2·maxTw` (~40 px) in x. One radius for both
  scanned a band 1.7× wider than anything could touch.

Together: 4.65 ms → 0.71 ms, with byte-identical output. If you change the
conflict model, re-derive `XMAX`/`YMAX` from it or the reject stops being exact.

Three drawing rules, each of which cost a screenshot to find:

- `draw()` is three passes — lay out, then every leader line, then every marker.
  Painting as you place puts the next leader line straight through the previous
  marker's speed number. Markers paint in REVERSE layout order so the
  undisplaced one ends up on top.
- A nudged marker always prints its altitude, whatever `alt` says — displaced
  markers are the one case where the pilot cannot tell which reading is which,
  and 1648 m vs 2600 m is the whole point in a valley wind.

The badge reads `12 stations ↓4` when markers were moved and `9 of 12 stations`
when any were dropped; a bare count means nothing was hidden. Keep both.
`tools/nudge.html` is how the placement gets judged — **a canvas drawn asynchronously
does not survive a headless screenshot**, so the widget's own markers cannot be
checked that way and that page draws the same calls synchronously.

**The two pages fetch different SHAPES, and that is deliberate.** The overlay
has a viewport, so it uses `scale` + `pad` and a view rectangle. **The list has
no map, so it has no scale** — it uses `range`, a radius in km, via
`WG.bboxRadius()` for the query and `prepare(..., {r:metres})` to trim the
bounding square's corners back to a circle. `scale` used to drive the list too,
which made its catchment a portrait 65 × 94 km rectangle borrowed from a
viewport that page does not have, while it sorted purely by distance: 20 km east
dropped, 20 km north kept, and no way for a reader to tell why. `scale` and
`pad` are `only:"widget"`; `range` is `only:"app"`. Do not reunify them.

**winds.mobi's `name` and `short` are the opposite way round from what they
sound like.** For openwindmap.org, `name` is a geocoded municipality and
`short` is the name the station's owner gave it — "Decollo TRUCETTI 980m" is
filed under "Valgioie". `normalise()` swaps them and keeps the municipality as
`place`. Do not "fix" this back. The API also truncates at `limit=500` with no
documented ordering; that is reported as `meta.capped`, never papered over,
and splitting the box into more calls would breach *"do not overload"*.

Testing without a position: append `?lat=47.05&lng=8.64`. Any parameter in `SPEC`
works the same way, e.g. `?scale=15000&peaks=1&stale=45` for the overlay or
`?range=60&stale=45` for the list — or just use the
configurator on `index.html`, which builds the URL and a QR code for it.

Pages: `index.html` launcher/configurator, `app.html` list, `widget.html`
overlay, `tools.html` the diagnostic index.
Engine: `wg/core.js` (no DOM), `wg/marker.js` (both renderers), `wg/windsmobi.js`
(provider), `wg/fields.js` (SPEC-driven controls), `wg/qr.js` (launcher only).
Tools: `tools/ruler.html` (measures XCTrack's resolution *without* our
calibration — the instrument that settled pixel density, keep it),
`tools/registration.html`, `tools/arrow.html`, `tools/nudge.html`,
`tools/arrow.svg`, `tools/test-core.js`, `probe.html`. **They are linked from `tools.html`, not
from the launcher** — six diagnostic pages were six things a pilot had to
scroll past. Add a new one there and to `sw.js`.

**`app.html` says one sentence and hides the rest behind `?debug=1`.** Its
header used to print `src=url 44.88000,7.33000 / scale 8km ≙ z9.0 · 1.8 KB ·
15 ms`; it now says *"96 stations near you, closest first. 9 are too old to
trust."* `debug` is deliberately NOT `only:"widget"` — both pages hide their
technical line behind the same switch so a bug report from either shows the
same fields. The sentence also carries the two things invisible by looking:
all-stale, and the provider's 500-station truncation.

**Both pages draw the trend strip from `WG.marker.trendHtml`.** Tapping a
station shows its last few hours — the overlay in a popup, the list by expanding
the row in place. One renderer, in `wg/marker.js`, because two copies of "which
colour does 22 km/h get" is the drift that file exists to prevent; its three
empty states (loading / error / *this station keeps no history*) are part of the
contract and are unit-tested. History is fetched **on demand** and cached for
one poll interval — a sparkline on every chip would be one HTTP call per station
for data nobody asked to see, which is what winds.mobi's *"do not overload"*
forbids. `WG.marker.trendScroll` scrolls to the newest sample and sets a `cut`
class while older ones are hidden to the left; the mask that class applies is
not decoration, it is what stops a half-clipped `15:00` reading as `5:00`.

**Refresh is the age.** A pill in the header reads `↻ 12 min ago` and tapping it
refetches; it goes amber past two poll intervals, the same threshold the
overlay's status line uses. Do not add a separate Refresh button back — it cost
a whole row of a screen that exists to show readings, and said nothing about
what was being refreshed or whether it needed to be.

**An installed PWA cannot be told to "open in the default browser" — there is
no such API.** The link out of `app.html` uses `target="_blank" rel="noopener"`,
which hands the navigation to a browser surface (Custom Tab on Android, Safari
on iOS, a tab on desktop). Without it, a plain same-origin link navigates
*inside* the standalone window and strands the pilot in the setup guide with no
back button. The only other lever is the manifest `scope`, and since
`index.html` sits beside `app.html` narrowing it would push every future page
out of scope too. Keep the `_blank`.

**`index.html` is written for a pilot, not for us.** Three numbered steps
(choose a scale → get the link onto your phone → set it up in XCTrack), one
primary action at the top, and the measured reasons behind each XCTrack setting
kept in HTML comments beside the list. Two things not to undo: the page offers
**one** button and it goes to `app.html`, because a link straight to
`widget.html` opens a transparent page of arrows on nothing and reads as
broken; and step 3 prints the pilot's chosen scale live from `#stepScale`, so
the instruction names a number rather than referring back up the page.

A headless browser is available for visual checks, which beats shipping UI blind:

    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
      --virtual-time-budget=9000 --window-size=460,900 --screenshot=/tmp/s.png \
      "http://localhost:8080/app.html?lat=47.05&lng=8.64"

Two caveats, both of which have already caused a wrong conclusion:

- **It does not capture a canvas drawn asynchronously.** The widget's markers come
  out blank even though `getImageData` proves they are there. SVG captures fine, so
  `app.html` and `tools/arrow.html` are the pages to check this way.
- **The capture can be narrower than the page's own viewport**, so content at the
  right edge is cropped rather than overflowing. A bottom-right control read as
  "not rendering" and chip text read as "overflowing" were both just this.
  Screenshot 100–150 px wider than the layout you are checking before believing
  anything about the right-hand edge.

## Conventions

- Plain ES5-compatible JS in shipped pages. Old Android WebViews.
- Build scripts may use whatever is convenient; they run on a laptop.
- Findings from probes go in `docs/findings.md`, dated, raw JSON included.
- **`node tools/test-core.js`** exercises the engine — config clamping, the
  calibration, the XCTrack scale ladder, the rating bands, geo, bbox, staleness,
  ranking and the provider's URL building and normalisation. Add `--live` for one real winds.mobi call. This
  is only possible because `wg/core.js` touches no DOM; keep it that way.
