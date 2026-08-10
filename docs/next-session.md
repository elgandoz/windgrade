# Next session

Written 2026-08-10, updated 2026-08-11 when the tap probe came back negative and
zoom sync was removed. Read this first, then `docs/findings.md` for measurements and
`docs/handover.md` for why decisions were made the way they were.

Everything in the repo is committed. Nothing is half-finished in the working tree.
`docs/todo.md` holds deferred work and the two upstream asks, one of them drafted
ready to post.

---

## Where it stands

**Working and verified:**

| Piece | State |
|---|---|
| `wg/core.js` | engine, DOM-free. 105 assertions via `node tools/test-core.js` |
| `wg/windsmobi.js` | provider. One bbox call, ~18 KB for 72 stations across 6 networks |
| `wg/marker.js` | marker, canvas + SVG from one geometry source |
| `app.html` | list page, installable PWA, settings sheet, light/dark/auto |
| `index.html` | launcher: configurator, copy-paste URL, QR, tool links |
| `widget.html` | the XCTrack overlay. **Verified on device 2026-08-11** |
| Overlay registration | measured and confirmed against airspace edges |

**Verified on device 2026-08-11.** Markers, labels, declutter and the scale bar all
render correctly in XCTrack, and our bar matched XCTrack's own to within reading
error — the calibration confirming itself passively. Screenshot analysis in
`findings.md`.

Still true that **headless screenshots cannot capture an asynchronously drawn
canvas**, so changes to `widget.html`'s rendering still need a device check; the
laptop can only verify `app.html` and `tools/arrow.html` visually.

---

## The blocking question — ANSWERED 2026-08-11: no

**A tap on a web widget never reaches a background XCTrack widget.** Tested in all
three modes and both layer orders; `pointer-events: none` gave nothing to either
side, so the WebView consumes the event regardless of what the page does. Zoom sync
was removed the same day. Raw log in `docs/findings.md`, verdict written into
`tools/tap.html`, rejection reasoning in `plan.md` under Phase 3c.

**The useful finding was a side effect:** with *Allow tapping* ON the overlay
swallows every tap over its area, killing the pilot's own zoom buttons. It has
nothing to tap, so the setup now says leave tapping **OFF**.

**One thing still to look at on device:** only "tapping off + widget in the
background" preserves the zoom buttons — does the XC map then draw over the arrows?

**Built afterwards** (Phase 3d in `plan.md`): a scale bar drawn above XCTrack's own,
on by default, so the pairing is checked by comparing bar *lengths* rather than
labels; and `ztap=1`, an opt-in manual zoom for pilots willing to move their zoom
buttons outside the widget and re-zoom the map by hand. Neither is verified on
device yet.

<details><summary>How the probe was run, kept for re-testing a future XCTrack</summary>

Run `tools/tap.html`:

1. A page with an XC map widget and the owner's usual two background zoom buttons
   (top half zooms in, bottom half out).
2. `tools/tap.html` on top, same area, **Allow tapping on the web page when locked
   ON**.
3. Tap the top half. Record **both**: did the zone flash and its counter rise, and
   did XCTrack's own scale label change?
4. Cycle `mode` (button behind `≡`, bottom right) through `listen`, `prevent`,
   `pe-none`. Repeat the lot with tapping **OFF**.
5. `copy` puts the tally and the log on the clipboard.

| Outcome | What to do |
|---|---|
| **both** | Phase 3c is buildable. Track a ladder step, ±1 per tap. |
| **page only** | The map will not follow. Silent drift — **do not build**. |
| **map only** | The widget cannot know. Silent drift — **do not build**. |
| **neither** | Tapping is off. Nothing to build. |

</details>

---

## Open items, in the owner's stated order

1. **Check the two fixes from 2026-08-11 on device** — markers now keep off the
   scale bar and badge, and the reset target grows to full width while the scale
   is offset. Also still open: whether a background-layered widget is drawn over
   by the XC map, which is the only arrangement preserving the pilot's zoom
   buttons.
2. **Phase 3** — our own PMTiles basemap, for the standalone page. Still the durable
   answer; 3b was the cheap one that shipped first. Two unresolved risks live here:
   byte ranges against a real `.pmtiles` (see below) and the ~50 MB pack ceiling.
3. **Phase 4 polish** — owner said keep this last. Includes a proper README rewrite,
   `radar orientation`, and any remaining parameters.

**Not blocking, do when convenient:**

- **Email Yann, `info@winds.mobi`.** Their terms require identifying calls with a
  `User-Agent` header, which browsers forbid `fetch()` from setting. The automatic
  `Origin` header does identify the deployment — ask whether that suffices. Deferred
  by the owner pending feasibility, and the API works meanwhile. Do not spoof the
  header, and do not quietly ignore the rule: their terms end "blacklisted without
  any notice."
- **Latitude check on the 0.942 calibration.** Confirmed at 47.36°N only.
  Switzerland spans 45.8–47.8°N, 3.7% of cos variation. One run in Valais or Ticino
  settles whether the constant is latitude-independent, which it should be if
  XCTrack scales by cos(lat) as any Mercator must.
- **Widget-size independence of the calibration** is inferred from the zoom spacing
  being exactly 1.000, not measured. One run at a different widget size would
  settle it.
- **`.pmtiles` byte ranges.** Cannot be tested until a real pack exists. Ranges
  resolve against the *negotiated* representation and this origin gzips even
  `application/octet-stream` above a size threshold. Pass = 206, **no**
  `content-encoding`, and a `content-range` total equal to the real file size. If it
  fails, packs go to R2 — which is why Phase 3's manifest keeps absolute URLs.

---

## Decisions still with the owner

- **The arrow shape.** Owner: "it can work" but wants to refine it. `tools/arrow.svg`
  is the editable master; reshape it and copy the `d` back into `ARROW` in
  `wg/core.js`. Two traps documented in that file: keep the vertical extents
  symmetric about y=0 (or it orbits its own centre when rotated), and remember the
  rim eats inward, so a narrower dart needs a narrower rim.
- **Halo:** owner said "probably stays on". Currently always on. `tools/arrow.html`
  toggles it over five backgrounds if that needs revisiting.
- **Repo name.** `windgrade` is still a placeholder.

---

## Constants that were measured — do not re-derive

```
Overlay calibration    m/px = 156543.034 · cos(lat) / 2^z / 0.942
XCTrack scale ladder   z = (mapWidget_scale.value - 3) / 2     one step = √2
Pairing                4km=z12  8km=z11  15km=z10  30km=z9     (step 27/25/23/21)
```

XCTrack's ladder is a **resolution** on an exact power-of-two ladder, but **not** on
integer OSM zoom levels — it runs 1.062× coarser, hence the 0.942. Verified at three
ladder steps against airspace edges. The printed km labels are **rounded and
build-specific**; never compute geometry from them. `docs/findings.md` has the
numbers and `tools/registration.html` reproduces the whole thing.

`getLocation()` returns `lon, lat, time, altGps, isValid, stdBaroAlt, pressure,
speedGps, speedComputed, bearingGps, heading, airspeed`. `stdBaroAlt` is **pressure
altitude vs 1013.25 hPa**, not height above sea level — never compare it to a
station's altitude.

---

## Environment notes

**Push access.** `git remote` is `https://github.com/elgandoz/windgrade.git`, but
`gh` in this session was authenticated as **`marcogandi`**, which has only READ on
that repo — `git push` returned 403, and SSH also resolved to `marcogandi`. The
owner pushed manually all session. **The owner is switching Claude Code accounts, so
re-check this before assuming a push will work:**

    git push --dry-run origin main

If it 403s again: `gh auth refresh -h github.com -u elgandoz`, or add a personal SSH
key with a `Host github.com-personal` block beside the existing `github.com-work`
one. Local commits are unaffected either way; `git config user.name` is already
`elgandoz`.

**Local testing.**

    node tools/test-core.js            # 105 assertions, no network
    node tools/test-core.js --live     # + one real winds.mobi call
    python3 -m http.server 8080        # then http://localhost:8080/

Three traps, all in `AGENTS.md`: no `file://` (geolocation blocked), a LAN address
is not a secure context either (phone testing needs GitHub Pages or a
`cloudflared` tunnel), and there **is** a service worker now, so an edit takes two
reloads unless you hard-reload.

**Headless screenshots** work via installed Chrome and are the way to check UI
without shipping blind:

    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
      --virtual-time-budget=9000 --window-size=560,900 --screenshot=/tmp/s.png \
      "http://localhost:8080/app.html?lat=47.05&lng=8.64"

Two caveats that each caused a wrong conclusion this session: an asynchronously
drawn **canvas is not captured** (SVG is fine), and the capture can be **narrower
than the page's viewport**, so right-edge content is cropped rather than
overflowing. Screenshot 100–150 px wider than the layout you are checking.

**Live URL:** `https://elgandoz.github.io/windgrade/` — Pages serves from
`main` / root, `status: built`.
