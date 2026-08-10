# Windgrade

An XCTrack web widget (plus a standalone page) that shows nearby **wind-station
readings on a light offline map**, each rendered as an arrow coloured by a
safety rating. For paraglider XC pilots flying areas they don't know.

**Status: Phase 0.** Nothing is built yet except `probe.html`, a capability
probe that must be run before any architecture is committed to. Read
`docs/plan.md` for the phases and `docs/handover.md` for why every decision
was made the way it was.

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
- **The speed number stays visible at every size.** The green→black rating
  scale is invisible to a significant fraction of male pilots. The number is
  the fallback, not an optional decoration.
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
(`XCTrack.getLocation()` → URL params → browser geolocation), the `SPEC`
config pattern that drives both URL parameters and the settings UI from one
array, distance/bearing ranking, and the guarded `localStorage` wrapper. Copy
it, don't couple to it — two dependency-free static sites shouldn't share a
library at this size.

## Conventions

- Plain ES5-compatible JS in shipped pages. Old Android WebViews.
- Build scripts may use whatever is convenient; they run on a laptop.
- Findings from probes go in `docs/findings.md`, dated, raw JSON included.
