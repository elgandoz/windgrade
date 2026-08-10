# Windgrade

Nearby wind-station readings on a light offline map, for paraglider XC pilots.
An XCTrack web widget plus a standalone page.

Each station is an arrow: rotated to wind direction, **filled** by a safety
rating from the average wind, **outlined** by the same rating applied to the
gust, with the speed always readable inside it. Drawn over cached terrain, so
you can see whether a reading came from a valley floor, a summit, or a gorge —
which is the part a station name can't tell you when you're flying somewhere
new.

**Not a forecast, not a safety verdict.** It shows measured readings and where
they were measured. Nothing is interpolated between stations, and nothing about
turbulence, lee or rotor is inferred.

## Status

Phase 0. Only `probe.html` exists — a capability probe that has to be run
inside XCTrack before the architecture is settled. See `docs/plan.md`.

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
