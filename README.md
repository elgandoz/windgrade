# Windgrade

Nearby wind-station readings on a light offline map, for paraglider XC pilots.
An XCTrack web widget plus a standalone page.

Each station is an arrow pointing downwind: **filled** by a six-level rating
from the average wind, **rimmed** by the same scale applied to the gust, with
the `average/gust` pair always printed beside it. Drawn over terrain, so you
can see whether a reading came from a valley floor, a summit, or a gorge —
which is the part a station name can't tell you when you're flying somewhere
new.

**Not a forecast, not a safety verdict.** It shows measured readings and where
they were measured. Nothing is interpolated between stations, and nothing about
turbulence, lee or rotor is inferred.

## Status

Working: the engine, a winds.mobi provider covering 13 station networks, a
launcher with a widget configurator, an installable list page, and an XCTrack
overlay whose registration against XCTrack's own map has been measured and
confirmed on device.

Not built: our own offline PMTiles basemap (Phase 3) and the final polish
(Phase 4). One question still open — whether a tap can reach a background
XCTrack widget — decides whether zoom sync is possible at all.

Start at `docs/next-session.md`. Then `docs/plan.md` for the phases,
`docs/findings.md` for what was measured, `docs/handover.md` for why.

This README is deliberately still thin; rewriting it for pilots is a Phase 4
task.

## Running the probe

Serve the folder over http and open `probe.html`; `file://` will skew the
results.

    python3 -m http.server 8080

For XCTrack you need a real https URL — push to GitHub Pages, or tunnel with
`cloudflared tunnel --url http://localhost:8080`. Add it as a **Web page**
widget with *Allow web page to access XCTrack data* switched on.

Run it in Chrome too. The difference between the two is the finding.

One caveat: `python3 -m http.server` does not support HTTP Range requests, so
the range test reports 200 there. That result is meaningless locally — only
trust it against the real host.

Record results in `docs/findings.md`.

## Layout

    probe.html        Phase 0 capability probe
    AGENTS.md         agent instructions (CLAUDE.md imports this)
    docs/plan.md      phases and open decisions
    docs/handover.md  why every decision was made this way
    docs/findings.md  probe results

## Licence

MIT, with no warranty of fitness for flight preparation. See LICENSE.
