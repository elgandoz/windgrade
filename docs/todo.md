# TODO: future things

Things deferred on purpose. Each says *why* it is not done, so nobody redoes the
thinking. Not a backlog of everything; `docs/plan.md` holds the phases.

---

## Upstream asks: not our code

### 1. XCTrack: expose the map scale to the web widget

**Why we want it.** The overlay must render at the same resolution as the map it
sits on. Today that is done by configuration, the pilot sets both, and a badge
plus a scale bar make a mismatch visible. If the widget could simply *read* the
map's scale it would follow automatically, and the whole class of mis-pairing
disappears.

**Why the existing issues ask for the wrong thing.**
[#1235](https://gitlab.com/xcontest-public/xctrack-public/-/issues/1235) requests
the zoom as a **URL placeholder**, `${osm_zoom}`.
[#1097](https://gitlab.com/xcontest-public/xctrack-public/-/issues/1097) asks
similarly and has sat untouched since 2024-04-27.

A URL placeholder forces XCTrack to **reload the page on every zoom change**. For a
canvas overlay that discards the canvas, the station cache and any in-flight fetch ,
it is exactly why our setup requires refresh rate 0. So the mechanism they asked for
would be unusable for us even if it shipped.

**The ask to post instead**, on #1235 rather than as a new issue:

> The zoom would be far more useful on the **JS interface** than as a URL
> placeholder. A placeholder means the widget reloads on every zoom change, which
> for anything drawing to a canvas throws away the canvas, its data cache and any
> in-flight request, the same reason these widgets are run with refresh rate 0.
>
> A read-only method polled like `getLocation()` would avoid that entirely:
>
> ```
> XCTrack.getMapScale()   ->  mapWidget_scale.value  (or its OSM zoom equivalent)
> ```
>
> Read is enough. An overlay only ever wants to *follow* the map, never to drive
> it, so this is a smaller change than a setter. Returning the raw
> `mapWidget_scale.value` would be ideal, since the km labels are rounded and
> differ between builds.
>
> For context, the value can already be paired to an OSM zoom exactly:
> `z = (mapWidget_scale.value − 3) / 2`, one ladder step being √2 in scale.
> Measured against airspace edges at three steps.

**Also worth mentioning if it seems welcome:** touch events. A tap on a Web page
widget never reaches a background widget underneath, even with
`pointer-events: none`: so a web widget covering the map area silently removes the
pilot's own zoom buttons. An option to let unhandled touches fall through would fix
that. Measured 2026-08-11; log in `docs/findings.md`.

### 2. winds.mobi: the `User-Agent` term  ✉️ SENT 2026-08-12, awaiting reply

**Do not re-draft this.** The owner emailed Yann at `info@winds.mobi` on
2026-08-12 asking both questions below. Nothing to do until he replies.

**The problem.** Their terms require identifying calls with a `User-Agent`
header. Browsers forbid `fetch()` from setting it, so **we cannot comply as
written**. The automatic `Origin` header does identify the deployment
(`https://elgandoz.github.io`), and the email asks whether that suffices.

Whatever comes back: do not spoof the header and do not quietly ignore the rule,
their terms end "blacklisted without any notice". The API works meanwhile, and
our usage is one bounding-box call per pilot per ~10 min, with history fetched
only on a tap and cached for one poll interval.

**The same email asks for `ETag`.** Measured 2026-08-12: the API sends no
`Cache-Control`, no `ETag`, no `Last-Modified` and no `Age`, just `date` and
`server: uvicorn`. Two calls 3 s apart returned byte-identical payloads, but
finding that out costs the full 118 KB. `ETag` + `If-None-Match` would turn most
polls into a 304, which is bandwidth saved on both sides and squarely in the
spirit of their "do not overload" rule. See `docs/findings.md` 2026-08-12, which
also records why there is no generation cycle to synchronise our poll with.

**Two more things to put in the same thread**, see `docs/data-sources.md`:
whether Italian or Austrian national networks are on the winds.mobi roadmap and
whether a provider PR for them would be welcome, and whether a few Ecowitt
stations can be added. Both are one paragraph in a reply he already owes us, and
both are cheaper than any code.

**Name MeteoNetwork specifically** (`docs/data-sources.md` §7, established
2026-08-17): CC-BY 4.0, free account, a bulk `lat`/`lon`/`range` call carrying
wind speed, gust, direction, coordinates and altitude, and apparently the
Italian regional networks and MET Norway as sub-networks. The useful question is
not "may I write it" but **"is there a reason it has not been written"**, which
is the kind of thing only he knows and which would cost a wasted weekend to
discover by writing it.

**If he says yes to `ETag`:** the provider is the only file that changes. Keep
the last `ETag` per bbox, send `If-None-Match`, and treat 304 as "keep what is
on screen and refresh `lastFetch`", the staleness clock must still advance, or
a 304 would make readings look newer than they are.

---

## Verification debts

Things believed but not measured. Each says how to settle it.

- **`widget.html` in flight.** Narrower again: the owner set the emulator's
  position to Zermatt and reports the overlay looked right there, across several
  scales, and `tools/nudge.html` renders the same calls synchronously so the
  marker work *can* be screenshotted. What has still never happened is a real
  flight. Legibility in sunlight, and whether the battery cost is what the
  profiling says. **Owner flying 2026-08-12 evening and checking visibility.**
- **Latitude independence of the 0.942 calibration.** Confirmed at 47.36°N only;
  Switzerland spans 3.7% of cos variation. The scale bar now makes this passive ,
  fly to Valais or Ticino and see whether the two bars still agree.
- **Widget-size independence.** Inferred from the zoom spacing being exactly 1.000,
  not measured. One run at a different widget size settles it. *Note it is now a
  much weaker claim than it was: the scale bar's max length is a constant in dp
  and the labels no longer depend on widget width at all, so only the projection
  itself is still unverified across sizes.*
- **`Check scale!` sitting in the gap.** Verified numerically (chip centre 731.1
  against a gap centre of 731) but never seen on a phone. `XCT_BAR_Y = 10` came
  from the two ruler runs on one emulator; if XCTrack's own bar sits at a
  different height on another device the prompt will be off-centre, which is
  cosmetic, nothing measures against it.
- **The altitude line over real terrain.** Checked headlessly over synthetic
  snow/grass/rock bands with an airspace line and a river. `#3A4A56` at 78% of
  the speed size is the smallest text this tool draws, so it is where the white
  casing fails first. Worth a look in bright sunlight, which is the condition
  no screenshot reproduces.
- **The Pixel 9a scale list.** A report that twelve scale values are missing from
  XCTrack's map scale setting cannot be reconciled with a 23-step √2 ladder: at
  three of the four disputed steps, *both* candidate labels are on the missing
  list, so no label could satisfy it, and no bar width in 60–400 dp against any
  dpr in 1.50–4.00 fits either. Settle it with the **full ordered list of all 23
  values read straight off the device**, a photo of the setting does it. Until
  then `BAR_MAX_DP = 150` stands; it reproduces both recorded label lists 46/46.
  Full analysis in `docs/findings.md` 2026-08-12. No live defect either way.
- **`.pmtiles` byte ranges.** Cannot be tested until a real pack exists. Pass = 206,
  **no** `content-encoding`, and a `content-range` total equal to the real file
  size. If it fails, packs go to R2, which is why Phase 3 keeps absolute pack URLs.
- **Layer order.** Only "tapping off + widget in the background" preserves the
  pilot's zoom buttons. Does the XC map then draw *over* the arrows? That is chmd's
  stack, which works visually but runs airspace lines across the markers.

---

## Deferred features

- **Own basemap (Phase 3)**: still the durable answer for the standalone page.
- **Zoom sync**: rejected 2026-08-11, see `plan.md` Phase 3c. Becomes buildable
  only if XCTrack ships the read above, or if a future build lets touches fall
  through; `tools/tap.html` re-tests the latter in minutes.
