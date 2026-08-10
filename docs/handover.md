# Handover

Written at the end of the chat session that produced this repo. Everything here
is *why*, so a fresh session doesn't relitigate settled questions or repeat
research. Not loaded automatically — read it when a decision seems arbitrary.

## Where this came from

The owner is a Swiss XC paraglider pilot and backend web developer. The sibling
project `hx-call` (a phone directory for Swiss HX airspaces, same XCTrack
widget pattern) came first; this is the second widget and reuses its engine.

## The problem, precisely

Existing wind-station tools rank stations by **horizontal distance** and label
them by **name**. Both fail the owner's actual case:

- He often flies areas he doesn't know, so a station name carries no meaning —
  he can't tell whether "Interlaken" is a valley floor or a ridge.
- Distance ranking surfaces the nearest airport, which is usually a valley
  station and says nothing about conditions at flying altitude.

Two concrete scenarios he described:

1. Conditions are benign at altitude but a strong valley wind makes landing
   dangerous, or the run home impossible, with rotor below.
2. Approaching a tall mountain without knowing the wind at its summit — whether
   he'd be on the lee side, or whether crossing is possible at all.

Both need **altitude** and **terrain position**, not proximity.

## Decisions and the reasoning behind them

### No inference, only facts

An earlier draft proposed a LEE badge: compare the bearing from station to
pilot against the reported wind direction, flag anything within ~90° of
downwind. The owner rejected it, correctly — Alpine toponymy is far too complex
for a single point measurement plus a bearing to support that claim, and
narrow valley passages produce venturi effects that no simple index captures.

The line that survived: **descriptive is fine, inferential is not.** "This
station sits at 2502 m" is read off a DEM. "You are in its lee" is a
meteorological claim dressed as a fact. Ship the first, never the second.

This is also why there is no interpolation or heat surface between stations.

### Show terrain, don't compute it

If the tool doesn't infer, comprehension has to come from *showing* the pilot
where a station sits. A station in a gorge should look like it's in a gorge.
That is what turned "a map" from scope creep into the core requirement — the
owner asked for it, an earlier draft pushed back, and the pushback was wrong.

### PMTiles, not a hosted tile endpoint

The owner suggested OpenFreeMap (positron). Investigated, and PMTiles fits
better:

- A hosted `z/x/y` endpoint means every pan is a request, and "cache an area"
  becomes intercepting hundreds of individual tiles. That is the machinery the
  offline-vector-tile articles he shared are all working *around*.
- PMTiles is one file, readable over HTTP Range requests from any static host.
  "Cache the area up front" stops being a caching strategy and becomes
  downloading a file.
- Regional extracts pull straight from the remote planet build without
  downloading it:
  `pmtiles extract https://build.protomaps.com/YYYYMMDD.pmtiles alps.pmtiles --bbox=... --maxzoom=11`
- GitHub Pages supports byte-range requests, so no bucket is needed.

The `leaflet-vector-offline` repo he linked is itself built on PMTiles plus
`protomaps-leaflet`, which is the strongest signal.

### Canvas, not WebGL

`protomaps-leaflet` renders vector tiles to Canvas and is documented as being
for *non-interactive* layers. Normally a limitation; here it's the spec — the
widget never pans, it follows GPS. Avoids a WebGL context and ~250 KB of
MapLibre sitting beside XCTrack's own renderer in the same process. Revisit
only if the probe shows WebGL is solid.

### Hillshade in the same container

PMTiles is a general tiled-data format, raster included. So the DEM ships as a
second, raster PMTiles per region, generated from Copernicus GLO-30 (openly
licensed, global, no key). Same download and cache path, no new architecture.

### The rating scale

Owner's design, thresholds owner-supplied: green safe, yellow tricky, orange
hard, red dangerous, black extremely dangerous. **Fill colour from the average,
border colour from the gust.**

Two consequences worth preserving:

- The mismatch is free information. Green fill with a red border means a calm
  average hiding violent gusts — arguably the single most useful thing the
  display can show.
- Black needs a white halo, unconditionally on every marker. A black arrow with
  a black border on a grey basemap over a dark map is a hole in the screen.

### Lesson from the "Empathizing Map" PWA

The owner shared an offline-first PWA (CDMX safety map, MapLibre + PMTiles) as
a reference. The most useful line in it: *"When offline, the basemap drops away
but cached layers still render."* A competent offline-first build, explicitly
for a limited data plan, and the **basemap still wasn't cached** — because it
came from a hosted style. Confirms: own the basemap file.

Its author also lists PWA storage eviction as an unsolved problem. The answer
is `navigator.storage.persist()`, usually granted once installed to the home
screen, paired with `estimate()` to check quota before downloading.

He also chose warm gradients over alarming reds deliberately, because his
underlying number was smoothed *police-report density* — an uncertain estimate
that alarming colour would overclaim. That reasoning does **not** transfer:
a wind speed is a measured instrument reading, and alarm is honest. What does
transfer is the discipline of naming exactly what the colour describes.

### The WebView storage trap

Storage written by the standalone page in Chrome is **not visible** to
XCTrack's WebView — separate partition, effectively a separate browser. So the
"download the region" action must happen inside the WebView itself. This was
missed in an earlier draft and would have invalidated the whole offline design.
It is the reason `probe.html` exists.

## Prior art

- **windspion** (pdcs.ch, Lukas Buchs) — XCTrack widget listing wind stations.
  Proven and widely used. Its URL conventions (`?size=0` for a 0–100 font
  scale, `&mode=dark`, refresh rate 0) are worth matching for familiarity.
  Its weakness is exactly this project's premise: it assumes you know where the
  places are.
- **burnair** — full map app, subscription, aggregates many station networks.
  Heavy, and switching apps mid-flight is the cost. Their aggregation is their
  moat; "lighter than burnair" is easy, "as useful as burnair" is not.
- **bern.pdcs.ch / pgairspace.ch** — live ATIS-derived airspace status. Not
  wind, but relevant patterns: polling once a minute, going **red after 4
  minutes** without a connection, and auto-hiding when out of area. That
  staleness rule is worth copying outright.

## Data sources

**MeteoSwiss OGD** — free, no key, attribution required ("Source: MeteoSwiss").
About 160 SwissMetNet stations delivering wind every ten minutes. There is a
single-file-all-stations JSON behind their measurement-values map,
`data.geo.admin.ch/ch.meteoschweiz.messwerte-wind-*-10min/..._en.json`,
including coordinates. Those URLs come from a 2020 gist and MeteoSwiss has
since restructured onto a STAC API, so **verify they still resolve** — the
probe tests exactly this.

The usual objection is that SMN is all airports and valley floors. Partly
true, but it also includes Säntis, Pilatus, Jungfraujoch, Gütsch, Chasseral,
Titlis, Napf. The data for the summit question already exists and is free;
tools surface the wrong stations from it. Fixing the ranking largely fixes the
complaint without needing Holfuy.

**Holfuy** — the network paraglider pilots actually use, and international.
`api.holfuy.com/live/?s=all&pw=<key>&m=JSON&su=km/h&loc` returns every
accessible station with coordinates in one call. But the APIs are **not open by
default** and `s=all` means "all stations you have access to". That's an email
to Holfuy, not a technical problem — but it is a gate. Not yet approached.

## Open questions for the owner

Listed at the end of `docs/plan.md`. The two that block real work are the
rating thresholds and whether to approach Holfuy.
