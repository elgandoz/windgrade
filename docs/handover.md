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

**Amended 2026-08-10.** The owner has since ruled that *relative* altitude
(pilot − station) is not important, so of that pair only **terrain position**
survives as a requirement. Station altitude is still displayed, as a fact. The
comprehension both scenarios need comes from seeing where the station sits, not
from a computed height difference. See `plan.md` → "Altitude — downgraded".

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

**Six levels, thresholds supplied 2026-08-10.** Modelled on **burnair**'s scale,
deliberately — pilots already read it, and familiarity is worth more than
originality here. Same argument as matching windspion's URL conventions.

Colour is driven by **wind speed only**. All units km/h.

| Colour | Average | Gust |
|---|---|---|
| white / grey | up to 6 | up to 14 |
| green | 7 – 14 | 15 – 24 |
| yellow | 15 – 24 | 25 – 32 |
| orange | 25 – 30 | 33 – 38 |
| red | 31 – 36 | 39 – 44 |
| black | 37 and up | 45 and up |

Fill colour reads the **Average** column; the rim reads the **Gust** column.
**Two different tables, not one applied twice.**

Supersedes two earlier drafts: a five-level green/yellow/orange/red/black with no
numbers, and a four-level version that dropped orange. Orange is back, and
white/grey for calm is new.

#### Boundaries are half-open — the bands as written have gaps

The bands are integers but the data is not: MeteoSwiss returns one decimal
(`"value": 20.9`). Taken literally, "up to 6" and "7 – 14" leave 6.4 km/h with no
colour. So each band's lower integer becomes a strict boundary:

```
average:  < 7   < 15   < 25   < 31   < 37   else black
gust:     < 15  < 25   < 33   < 39   < 45   else black
```

That is an interpretation, not something the owner stated. It changes a displayed
colour near every boundary, so it is worth confirming.

#### Why two tables makes the mismatch readable

The gust bands are the average bands shifted up by a consistent 8–10 km/h. That
calibration is the point:

- **Rim the same colour as the fill** → the gust is running about 8–10 km/h over
  the average, which is ordinary. Nothing to see.
- **Rim hotter than the fill** → the gust factor is above normal. This is the
  calm-average-hiding-violent-gusts case, and it now announces itself as a
  colour *step* rather than requiring the pilot to compare two numbers.

A single shared table could not do this: gusts always exceed the average, so
every marker would show a hotter rim and the signal would carry no information.

#### Reference: SeeYou Navigator (owner screenshot, 2026-08-10)

Naviter's app, showing MeteoSwiss data for Uetliberg. The image is a commercial
UI and is **not committed** — this is the transferable reasoning from it.

**Answers the number-placement question.** The value is drawn as a compact
`average/gust` text pair *beside* the arrow, never inside it — `22/37` in the
detail sheet, `0/2`, `2/11`, `6/12` on the map itself. So the number rides along
at map scale too, which is exactly what `AGENTS.md` demands, and it carries
*both* channels rather than only the average. Adopt this: `avg/gust`, one pair,
outside the shape.

**Confirms the fill/rim assignment already specified.** Reading the seven
timeline samples (`32/36, 29/37, 26/33, 22/31, 21/31, 21/31, 22/37`), fill
tracks the **average** and the outline tracks the **gust** — the same way round
as our spec. Five of the seven fit cleanly; the two largest renderings are too
JPEG-mushed to be sure of, so treat this as a strong reading rather than proof.

**Explains what our new white/grey band will look like.** Several arrows appear
"hollow" — pale interior, coloured outline. That is not a third state; it is
simply a low average landing in a near-white band while the gust outline stays
saturated. So the white/grey level added today will read as an outlined,
unfilled arrow, and that is correct rather than a rendering bug.

**Other things worth copying:**

- Every marker carries a dark outline regardless of fill, which is what holds it
  apart from terrain. Independent support for the near-black stroke.
- The basemap is a pale, desaturated green-grey. The markers are the only
  saturated thing on screen — exactly Phase 3's stated intent.
- The **selected** station gets a white circle drawn behind its arrow. A cheap
  selection affordance that costs no colour.
- Station altitude sits in the header (`1016 m`), beside an explicit
  `Updated: 10:30, 2026-08-10`, with `Source: MeteoSwiss` at the foot. All three
  are things we already owe: the altitude as fact, the timestamp for staleness,
  the attribution for OGD licensing.
- A 15-minute history strip — arrow plus `avg/gust` per step — showing whether
  wind is building or easing. Purely descriptive, so it breaks no rule, and this
  screenshot is a good advert for it: the average eases 32→22 while gusts hold
  31–37, which is precisely the mismatch we are trying to surface. Out of scope
  for now; worth remembering.

**Do not copy their thresholds.** `6/12` renders green there, which would be
white/grey on the burnair scale adopted above. Their bands are their own. Take
the construction, not the numbers.

**Unresolved — which way the arrow points.** Direction is `235°`. The large
map arrow appears to point north-east, i.e. toward 55°, which would mean the
arrow shows where the wind is *going* rather than the meteorological direction it
comes from. The small timeline arrows look inconsistent with that at this
resolution, so it is not settled. Getting this backwards inverts every marker on
the screen, so it needs a clearer reference or a deliberate decision before any
marker code is written.

#### The scale does not remove the need for the number

`AGENTS.md` requires the speed number at every size because the scale is
invisible to a significant fraction of male pilots. Six levels do not fix that.
White and black are separable by lightness, but green / yellow / orange / red
remain a hue-only cluster in the middle — and yellow is *lighter* than green, so
there is not even a clean luminance ramp to fall back on. The number stays
mandatory.

### The marker: two stacked arrows

Owner's spec. Two arrow shapes sharing an origin and a bearing, the gust arrow
behind and roughly 5 px larger on every edge, so the gust colour reads as a rim
around the average colour.

| Layer | Fill | Outline | Size |
|---|---|---|---|
| Back (gust) | gust rating colour | 2 px, almost black | ~5 px larger |
| Front (average) | average rating colour | 1 px, dark grey | base |

The gust is therefore **not a stroke on a single shape** — it is the exposed
margin of a larger shape behind. That keeps both readings as full-saturation
blocks of colour rather than a block plus a thin line, which is what makes the
gust legible at small sizes and through gloves.

Two consequences worth preserving:

- The mismatch is free information. Green front with a red rim means a calm
  average hiding violent gusts — arguably the single most useful thing the
  display can show.
- The two outlines exist to separate the marker from any basemap, dark or light.
  They are not decoration.

**Unresolved — the halo, now needed at both ends of the scale.** This document
requires a white halo on every marker, unconditionally, because "a black arrow
with a black border on a grey basemap over a dark map is a hole in the screen."
The 2 px almost-black outer stroke reintroduces exactly that when the gust rates
black. And the six-level scale adds the mirror-image problem: a **white/grey**
arrow disappears into a light basemap.

Both fail in the same stack, so both are fixed by it:

```
white halo -> near-black 2 px -> gust fill -> dark grey 1 px -> average fill
```

The near-black stroke is what keeps a white fill visible on light terrain; the
white halo is what keeps a black fill visible on dark terrain. Neither is
decoration, and the order matters — the halo has to sit *outside* the near-black
stroke or it does nothing for the black case.

The owner has not confirmed this stack, so it is not settled.

**Also unresolved — where the speed number goes.** `AGENTS.md` requires the
number stay visible at every size, since the green→black scale is invisible to a
significant fraction of male pilots and the number is the fallback. Two stacked
arrows consume the space a number would occupy. Placement is unspecified.

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
  **The six-level rating scale is modelled on theirs**, deliberately; see "The
  rating scale" above.
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
