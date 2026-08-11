# TODO — future things

Things deferred on purpose. Each says *why* it is not done, so nobody redoes the
thinking. Not a backlog of everything; `docs/plan.md` holds the phases.

---

## Upstream asks — not our code

### 1. XCTrack: expose the map scale to the web widget

**Why we want it.** The overlay must render at the same resolution as the map it
sits on. Today that is done by configuration — the pilot sets both, and a badge
plus a scale bar make a mismatch visible. If the widget could simply *read* the
map's scale it would follow automatically, and the whole class of mis-pairing
disappears.

**Why the existing issues ask for the wrong thing.**
[#1235](https://gitlab.com/xcontest-public/xctrack-public/-/issues/1235) requests
the zoom as a **URL placeholder**, `${osm_zoom}`.
[#1097](https://gitlab.com/xcontest-public/xctrack-public/-/issues/1097) asks
similarly and has sat untouched since 2024-04-27.

A URL placeholder forces XCTrack to **reload the page on every zoom change**. For a
canvas overlay that discards the canvas, the station cache and any in-flight fetch —
it is exactly why our setup requires refresh rate 0. So the mechanism they asked for
would be unusable for us even if it shipped.

**The ask to post instead**, on #1235 rather than as a new issue:

> The zoom would be far more useful on the **JS interface** than as a URL
> placeholder. A placeholder means the widget reloads on every zoom change, which
> for anything drawing to a canvas throws away the canvas, its data cache and any
> in-flight request — the same reason these widgets are run with refresh rate 0.
>
> A read-only method polled like `getLocation()` would avoid that entirely:
>
> ```
> XCTrack.getMapScale()   ->  mapWidget_scale.value  (or its OSM zoom equivalent)
> ```
>
> Read is enough — an overlay only ever wants to *follow* the map, never to drive
> it — so this is a smaller change than a setter. Returning the raw
> `mapWidget_scale.value` would be ideal, since the km labels are rounded and
> differ between builds.
>
> For context, the value can already be paired to an OSM zoom exactly:
> `z = (mapWidget_scale.value − 3) / 2`, one ladder step being √2 in scale.
> Measured against airspace edges at three steps.

**Also worth mentioning if it seems welcome:** touch events. A tap on a Web page
widget never reaches a background widget underneath, even with
`pointer-events: none` — so a web widget covering the map area silently removes the
pilot's own zoom buttons. An option to let unhandled touches fall through would fix
that. Measured 2026-08-11; log in `docs/findings.md`.

### 2. winds.mobi: the `User-Agent` term

Their terms require identifying calls with a `User-Agent` header. Browsers forbid
`fetch()` from setting it, so **we cannot comply as written**. The automatic
`Origin` header does identify the deployment.

Email Yann, `info@winds.mobi`, and ask whether `Origin` suffices. Do not spoof the
header and do not quietly ignore the rule — their terms end "blacklisted without any
notice". Deferred by the owner pending overall feasibility; the API works meanwhile.

---

## Verification debts

Things believed but not measured. Each says how to settle it.

- **`widget.html` on device.** Marker layout, label placement, decluttering and the
  new scale bar have never been seen on a phone. Headless cannot capture an
  asynchronously drawn canvas, so this can only be checked in XCTrack.
- **Latitude independence of the 0.942 calibration.** Confirmed at 47.36°N only;
  Switzerland spans 3.7% of cos variation. The scale bar now makes this passive —
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
  cosmetic — nothing measures against it.
- **The altitude line over real terrain.** Checked headlessly over synthetic
  snow/grass/rock bands with an airspace line and a river. `#3A4A56` at 78% of
  the speed size is the smallest text this tool draws, so it is where the white
  casing fails first — worth a look in bright sunlight, which is the condition
  no screenshot reproduces.
- **`.pmtiles` byte ranges.** Cannot be tested until a real pack exists. Pass = 206,
  **no** `content-encoding`, and a `content-range` total equal to the real file
  size. If it fails, packs go to R2 — which is why Phase 3 keeps absolute pack URLs.
- **Layer order.** Only "tapping off + widget in the background" preserves the
  pilot's zoom buttons. Does the XC map then draw *over* the arrows? That is chmd's
  stack, which works visually but runs airspace lines across the markers.

---

## Deferred features

- **A history strip** — SeeYou shows 15-minute steps of `avg/gust`, which makes
  "building or easing" readable at a glance. Purely descriptive, so it breaks no
  rule, and `winds.mobi` already exposes `/stations/{id}/historic/`. Out of scope
  until the basics are proven on device.
- **Selected-station highlight** — SeeYou draws a white circle behind the selected
  marker. Cheap, costs no colour. Needs a selection concept first, which needs
  tapping, which currently costs the pilot their zoom buttons.
- **Own basemap (Phase 3)** — still the durable answer for the standalone page.
- **Zoom sync** — rejected 2026-08-11, see `plan.md` Phase 3c. Becomes buildable
  only if XCTrack ships the read above, or if a future build lets touches fall
  through; `tools/tap.html` re-tests the latter in minutes.
