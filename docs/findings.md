# Findings

Probe results. Paste raw JSON plus a one-line verdict. Newest first.

---

### 2026-08-18: CORS decides the architecture — everything must go through winds.mobi

Measured with a browser `Origin` header from the deployed origin:

| source | status | `access-control-allow-origin` |
|---|---|---|
| `www.ecowitt.net` | 200 | **none at all** |
| `api.meteonetwork.it` | 401 | **none** |
| `winds.mobi` | 200 | **`*`** |

**Windmap is static hosting with no server, so a source without CORS is simply
unreachable from it**, whatever we write. That rules out fetching the club's
Ecowitt stations directly, even though the share-link endpoints work perfectly
from `curl` and need no credentials.

MeteoNetwork is doubly ruled out: no CORS *and* a Bearer token, which a static
page cannot hold without publishing it to every visitor.

Reported rather than worked around, per `AGENTS.md`: *"If a data provider needs a
proxy to satisfy CORS, that is a finding to report, not a licence to add a
backend without discussion."*

**So there is exactly one way for the club's stations to reach Windmap: through
winds.mobi.** That is not a preference any more, it is the only door. Every
"could we just fetch it ourselves" shortcut considered over the last two days
dies here, and the upstream-provider strategy stops being the tidy choice and
becomes the only one.

Three ways in, cheapest first, all needing winds.mobi to act:

1. **Weather Underground**, *if* that provider is alive. Club enables WU upload
   (someone on the station's LAN), we register the WU stations, Yann adds two
   ids. **No new code anywhere.**
2. **MeteoNetwork registration**, needs a `meteonetwork` provider written. The
   route is proven: pmn503 is an `ECOWITT WS3900`.
3. **A new `ecowitt` provider** reading share links. Fully reverse-engineered
   already (endpoints, the unit cookies, the traps) and it is **the only route
   needing nothing from the station owners** — no LAN visit, no account changes.

---

### 2026-08-18: MeteoNetwork publishes real siting metadata, and a filter is writable

Three Piemonte stations pulled with an ordinary account (`GET /v3/stations/{code}`,
**not** a bulk method, so no `BULK` token was needed):

| code | place | alt | `tipology` | `soil_height` | `buildings_distance` | hardware |
|---|---|---|---|---|---|---|
| pmn150 | Villar Perosa, Via Cavour 10 | 530 | `E` extra-urban | 300 | **0** | Davis Vantage Pro 2 Plus |
| pmn503 | Vigone | 260 | `U` urban | 400 | 18 | **ECOWITT WS3900** |
| pmn117 | Rivalta di Torino | 297 | `S` semi-urban | 200 | 6 | Davis Vantage Pro2 |

**The fields are populated and they discriminate.** Nobody is claiming to be
perfectly sited; the values vary and they are specific. That was the open
question and the answer is yes, so **a siting filter is writable in principle**.

Four things the sample settles, three of them traps:

- **`tipology` is self-declared and demonstrably unreliable.** pmn150 calls
  itself **extra-urban** while reporting **0 m to the nearest building**, and its
  own name is a street address. **`buildings_distance` is the harder number**;
  filter on it, not on the letter.
- **`shielding` and `shielding_type` are irrelevant here.** The enum is about
  *radiation shields* (`X` none, `C` meteorological, `P` naturally ventilated,
  `W` forced) which is a **temperature** concern. It says nothing about wind
  exposure. Do not filter a wind source on it.
- **`soil_height` is documented in metres and is plainly not.** The schema says
  "Height of weather station sensors from soil (m)" with example `220`, and these
  report 200, 300, 400. As metres that is absurd; as centimetres it is 2, 3 and
  4 m, which is exactly a mast. **Same family as the Ecowitt unit trap: the
  declared unit is wrong and only the magnitude reveals it.**
- **The standard token is far tighter than documented.** The spec says 1
  request/second; **HTTP 429 arrived after about four calls spaced 1.1 s apart**,
  with *"Too many attempts. Please limit your requests"*. The probe scripts now
  wait 15 s. Two of the five codes never returned because of this.

**The test is only half done.** All three are valley or plain stations, 260 m to
530 m. **No ridge or summit station was sampled**, so we still cannot say whether
the metadata separates good siting from bad, only that it separates *these three
kinds of bad*. Re-run with three or four mountain stations to finish it.

**Incidental but useful: pmn503 is an `ECOWITT WS3900`.** Ecowitt hardware does
reach MeteoNetwork in practice, which is the route proposed in section 6 for the
owner's club stations, now observed rather than assumed.

---

### 2026-08-18: ARPA Piemonte has the best-sited wind stations available, and publishes them four hours late

Measured against <https://utility.arpa.piemonte.it/api_realtime/> (FastAPI, spec
at `/openapi.json`, **no authentication of any kind**).

**The registry is excellent.** `GET /pie_anag?page_size=2000` returns **374
stations** with `name`, `lat`, `lng`, **`quote` (altitude)**, `municipality`,
`province` and a `station_type` letter code. Letter **`V`** is *vento*:

| letter | stations | |
|---|---|---|
| P | 286 | pluviometro |
| T | 277 | temperatura |
| H | 143 | idrometro |
| **V** | **90** | **anemometro** |
| N | 79 | neve |

**46 of the 90 fall in the Piemonte box this repo has used throughout**, against
winds.mobi's **32 stations there of which none is Italian**. And the siting is
what no amateur network can match:

| altitude | name | |
|---|---|---|
| 4560 m | CAPANNA MARGHERITA | |
| 3320 m | MONVISO | |
| 3272 m | GRAN VAUDALA | |
| 2745 m | RIFUGIO VACCARONE | |
| 2700 m | MONTE FRAITEVE | |

32 anemometers sit above 1500 m and 21 above 2000 m. Median 729 m.

**The readings carry everything needed.** `GET /data_pie?station_code=…` returns
`wind`, `wind_direction`, `gust_of_wind`, `gust_direction` and a proper ISO
timestamp with offset (`2026-08-18T07:00:00+02:00`).

**And here is why it fails anyway.** Checked across the highest stations, all
agreeing:

- **the cadence is hourly**, not 10 or 15 minutes;
- **the newest sample was 251 minutes old**, on every station, at 11:11 local.

Four hours late is not "realtime" for deciding whether to fly, and it breaks
this project's own rule that stale data must announce itself: 90 new markers
that are *always* four hours old would render permanently stale. That is worse
than not having them, because it fills the map with things a pilot must learn to
ignore.

**No fresher feed exists, checked properly.** The map at
`/rischi_naturali/snippets_arpa_graphs/map_sensori/` reads exactly five
properties from `vels.geojson`: `name`, `quote`, `sensor`, `station_type`,
`creation_date`. **It never renders a measurement.** It is a map of *where the
anemometers are*, not of what they are reading. `velv.geojson` and
`dirv.geojson` are the same shape. So the only source of values is `/data_pie`.

**"Realtime" here almost certainly means UNVALIDATED, not low-latency.** That is
the standard meteorological usage: the provisional feed as opposed to the
quality-controlled archive published later. ItaliaMeteo says the same of its
own real-time data, that it "lacks validation" and is "for informational
purposes". Do not read the endpoint's name as a latency promise.

**Confirmed on a second pass**, six stations from 4560 m to 74 m: newest sample
`07:00` on every one, all 79 gaps exactly 60 minutes, no missing hours, and the
age grew from 251 to 257 minutes across two checks six minutes apart. So the
series is complete and simply late, rather than patchy.

**Still unverified: whether four hours is normal or today was late.** This is one
day, sampled across ten minutes. Re-run the same probe in the afternoon: if the
newest sample tracks exactly four hours behind the clock it is systematic; if it
has caught up, today's pipeline was merely slow and the objection is much
weaker.

**Licence: CC-BY 4.0**, per the `NOTICE` of the sibling `paragliding-kubernetes`
project: *"any use must cite Arpa Piemonte"*. Not confirmed from ARPA directly.

**Verdict: the best siting on offer and unusable as it stands.** The one
question worth asking ARPA is whether a lower-latency feed exists or could. They
are a public authority publishing open data, so it is a fair thing to ask, and
the answer decides whether 46 well-sited alpine anemometers become available to
every winds.mobi client or none of them do.

---

### 2026-08-18: MeteoNetwork's Piemonte stations are sited in valley-bottom courtyards

Owner's own inspection of the live map, and it is the criterion no API spec
could answer: **many are amateur installations in town courtyards at the bottom
of valleys.**

This is the risk `data-sources.md` flagged as acceptance criterion 5 and it has
now materialised. It does not make MeteoNetwork worthless, but it removes the
assumption that station *count* is the thing to optimise. A hundred valley-floor
readings do not help a pilot at 2000 m, and by this project's rules they are
noise drawn on terrain where they mean something quite different.

Together with the ARPA entry above, the two candidates now trade off cleanly and
neither wins outright:

| | siting | freshness | access |
|---|---|---|---|
| **ARPA Piemonte** | **excellent**, 21 above 2000 m | **hourly, 4 h late** | open, CC-BY |
| **MeteoNetwork** | **poor**, valley courtyards | good | bulk gated to institutions |

---

### 2026-08-18: the Ecowitt unit trap, found independently by another project

`paragliding-kubernetes`, a sibling app by a pilot in the same club, documents
the identical hazard in its `docs/CONFIGURATION.md`, reached without any contact
between the two investigations:

> Unit gotcha: the field keys are `windspeedmph`/`windgustmph` regardless of the
> actual unit, two stations on the *same* account can declare
> `units: ["km/h","km/h"]` and mph respectively. `sources/ecowittParse.ts`
> converts from the declared `units`, never from the key name. Do not
> "simplify" that.

Two independent discoveries of the same trap, with the same conclusion, is about
as much corroboration as a finding like this can get. Whoever writes the
winds.mobi provider should treat it as settled.

That project also names two keyless feeds worth knowing:

- **meteocloud** (`https://www.meteocloud.it/rete/api.php?action=stations`), 302
  stations, coordinates and live wind, **no name and no altitude**. Measured
  2026-08-18: only **9** fall in the Piemonte box this repo uses, so it is *not*
  an answer to the coverage gap, against winds.mobi's 32 there.
- **Holfuy's public marker feed** (`https://holfuy.com/puget/mkrs.php`), ~1170
  stations. winds.mobi already carries Holfuy, so this adds nothing here.

---

### 2026-08-18: Ecowitt share links expose live wind with no key, and the field name lies about the unit

Probed two stations the owner shared as public links (Monte Cucetto and Punta
Ceresa, both summit sites in the Piemonte gap). **The `authorize` codes and
`device_id`s are deliberately not recorded here**, since committing them to a
public repo would publish them far more permanently than a shared link implies.
They are reproducible from the share URLs the owner supplies.

Two undocumented endpoints answer with nothing but the share link's own
parameters, no account, no API key:

    GET https://www.ecowitt.net/index/get_device_info?device_id=…&authorize=…
    GET https://www.ecowitt.net/index/home?device_id=…&authorize=…

`get_device_info` returns name, latitude, longitude, model and timezone.
`index/home` returns grouped live readings; the `wind` group carries
`windspeedmph`, `windgustmph`, `winddir`, plus daily maxima.

**This overturns what `data-sources.md` said**, that Ecowitt is per-account only
and so cannot be fetched network-wide. A curated list of `(device_id,
authorize)` pairs works exactly like `windy.py` and `wunderground.py` upstream.

**THE TRAP, and it is a wrong-reading one.** Both stations belong to the same
account (`uid` 74223) and are the same model (WH2650). Same field name, verbatim
from the two responses on 2026-08-18 at 09:29 local:

| station | key | value | `unit` |
|---|---|---|---|
| Cucetto | `windspeedmph` | `0.9` | `mph` |
| Ceresa | `windspeedmph` | `0.0` | `km/h` |
| Cucetto | `windgustmph` | `5.8` | `mph` |
| Ceresa | `windgustmph` | `1.8` | `km/h` |

**The key is always `…mph`; the unit is a per-device display preference.** Read
the sibling `unit` field, never the key name. Anyone assuming mph from the key
would publish Ceresa 1.61× too fast, which for a wind display read by pilots is
the serious kind of wrong. The station owner can flip it at any time from their
account, so this is not a one-off quirk to hard-code around.

Three smaller problems, each real:

- **No altitude anywhere**, in either endpoint. Windmap prints station altitude,
  and nudged markers always print it. It would have to come from a DEM lookup or
  from the owner.
- **The timestamp is display text**, `"Today 09:29"`, with a separate
  `UTC_offset` in seconds. There is no ISO timestamp. Staleness is the one rule
  that protects a pilot from an old reading, so parsing prose for it is a poor
  foundation.
- **Both endpoints are internal to their web app**, not a published API. They
  can change without notice, and their terms have not been checked. The
  documented route is `api.ecowitt.net/api/v3` with an application key and an
  API key, which the owner can generate; both stations sharing one `uid` means
  **one key pair would cover both**.

Verdict: **it works, and it should still not be the first choice.** It proves a
fallback exists rather than settling the route.

**Altitudes, supplied by the owner 2026-08-18**, since neither endpoint carries
one: **Punta Ceresa 1267 m**, **Monte Cucetto 1700 m**. Both are summit sites,
which is what makes them worth drawing at all.

**The coordinates disagree slightly with the owner's**, and Windmap's whole
premise is that where a reading was taken is what it means, so it is worth
saying which to trust:

| station | owner | `get_device_info` | apart |
|---|---|---|---|
| Monte Cucetto | 44.977974, 7.239856 | 44.9765610, 7.2396800 | ~158 m |
| Punta Ceresa | 44.963284, 7.170651 | 44.9646320, 7.1711940 | ~156 m |

**The owner's are the accurate ones**, taken from Google Maps at the mast
itself; the device's were entered roughly and are the ~150 m out. Not the same
direction in each case, so imprecision rather than a datum offset.

~150 m is under a pixel at most scales Windmap draws, so nothing renders wrong
today. **Correct it in Ecowitt anyway**, because every route considered here
reads the device's own coordinates and never ours, so the good figures are
currently sitting in the one place nothing reads.

**Both stations are mast-mounted beside a paragliding take-off.** That is the
best case this tool has: not a garden, not a rooftop, but the exact spot a pilot
is about to launch from. It is also why the owner's own figures are worth having
in the device record rather than a rough pin.

**Re-probed 2026-08-18, after the owner set the units to km/h: Cucetto still
returned `mph`.** Ceresa was already km/h and stayed there. Whether that is
propagation delay, the wrong device, or a share-view setting held separately
from the account, the lesson is the same and it is now demonstrated rather than
predicted: **the unit cannot be assumed from the key, from the account setting,
or from a sibling station.** Read the `unit` field on every reading.

### Same day, later: the unit is a request cookie, so a caller can pin it

The owner noticed that changing units on the share page adds
`&units=1,3,7,12,16,24,28` to the URL. That parameter is **not** forwarded to
the API. Reading the share page's chunk (`c2.js`), it is fanned out into
cookies:

    document.cookie = "ousaite_unit_cookie_" + _[r] + "=" + n[r] + ";path=/"

and the data call itself is only `indexHome({device_id, authorize})`. The server
reads the cookies. So **the unit is chosen by the caller, not by the device**,
and the earlier entry's "you are stuck with whatever the owner set" is wrong.

Confirmed against Cucetto, the station stuck on mph, holding the other six
cookies at `1,3,7,12,16,24,28` and varying the third:

| `ousaite_unit_cookie_3` | unit returned | value |
|---|---|---|
| 6 | `m/s` | 0.1 |
| **7** | **`km/h`** | **0.4** |
| 8 | `knots` | 0.2 |
| 9 | `mph` | 0.2 |
| 5 | `mmHg` | 0.0 |

The four wind values agree to rounding (0.1 m/s = 0.36 km/h = 0.19 kt = 0.22
mph), so the server is converting properly rather than relabelling.

**Two traps remain, and the second is nastier than the first.**

- **The full set must be sent.** Setting `ousaite_unit_cookie_3` alone had no
  effect at all: the response stayed on the device's own default. Send all
  seven or the request is silently ignored.
- **The id space is shared across categories and is not validated.** `5` is a
  *pressure* id, and asking for it in the wind slot returned `mmHg` rather than
  an error. So a wrong id does not fail, it returns a plausible-looking number
  in a unit from another quantity entirely.

**Recipe, for whoever writes this:** send all seven cookies with the wind slot
pinned to `7`, then **assert the returned `unit` is exactly `km/h` and drop the
reading if it is not.** Pinning alone is not enough, precisely because a wrong
id fails silently.

This lowers the severity of the previous entry but does not retire it: reading
the `unit` field is still mandatory, now as the check on the pin rather than as
the only defence. It also deepens the "not a published API" caveat, since the
mechanism is now undocumented *cookie names* rather than merely undocumented
endpoints.

---

### 2026-08-12: winds.mobi has no generation cycle to sync to, and no cache validator

Asked whether the 10 minute poll could be aligned to winds.mobi's own update
cycle. **There is no such cycle.** Timestamps across 310 stations, 14 networks,
one fetch:

| network | n | reports at |
|---|---|---|
| slf.ch | 101 | **:00**, 100 of 101 on the hour |
| meteoswiss.ch | 65 | :20 and :30, split |
| holfuy.com | 57 | :22–:24 |
| openwindmap.org | 40 | :17–:22, scattered per station |
| aviationweather.gov | 12 | :50, hourly METAR |

Every response is a *mixture of ages*. Whenever you ask, slf is up to 60 min old
and openwindmap is minutes old; no instant makes the whole answer fresh. The
10 minute figure is not enforced by them either, it is rule 3 of their terms
("do not overload… minimise your number of calls") plus the data not moving
faster.

**And there is no cache validator.** Response headers are `date` and
`server: uvicorn`, nothing else, no `Cache-Control`, no `ETag`, no
`Last-Modified`, no `Age`. Two calls 3 s apart returned byte-identical payloads,
but discovering that costs the full 118 KB.

So the largest saving available is upstream: **`ETag` + `If-None-Match` would
turn most polls into a 304**. Add it to the email to Yann already pending over
the `User-Agent` term, see `docs/todo.md`.

Rejected: aligning our poll to wall-clock (:00, :10, :20) so it lands just after
MeteoSwiss and Holfuy publish. It would also make every Windmap instance hit
them on the same second, which is the opposite of "do not overload".

---

### 2026-08-12: OPEN: a reported Pixel 9a "missing scales" list that no ladder can produce

Reported as absent from XCTrack's map scale setting on a Pixel 9a at default
density: **250m, 500m, 1km, 1500m, 2km, 4km, 8km, 12km, 15km, 25km, 30km,
50km**. Separately confirmed as *present* on the same device: **400m, 800m,
3km, 6km**, and the device has the full 23 steps.

Unresolved. Recording the analysis so it is not redone.

#### Eight of the twelve are expected, and would be on any device

There are 23 ladder steps, each √2 = 1.414× apart in resolution. The nice-number
ladder's own ratios are all **smaller** than that:

```
1 → 1.2 → 1.5 → 2 → 2.5 → 3 → 4 → 5 → 6 → 8 → 10
  1.20  1.25  1.33 1.25 1.20 1.33 1.25 1.20 1.33 1.25
```

So consecutive steps always skip at least one nice number, and only about 13 of
the ~23 nice numbers in the 150 m–60 km band can appear on a given device. A
"missing" list is structural, not a defect. The model already predicts 250m,
500m, 1km, 2km, 4km, 8km, 15km and 30km as absent.

#### The other four are not a mis-tuned constant

`1500m, 12km, 25km, 50km` sit at steps 29, 23, 21, 19 and are nowhere near a
boundary. Each occupies 81–85% of its bar span and would need the bar ~20%
shorter to drop to the next nice number:

| step | bar spans | picks | next down needs |
|---|---|---|---|
| 29 | 1849 m | 1500m | bar ×0.80 |
| 23 | 14791 m | 12km | ×0.83 |
| 21 | 29582 m | 25km | ×0.80 |
| 19 | 59164 m | 50km | ×0.80 |

Swept bar width **60–400 dp** against dpr **1.50–4.00**, scoring all 16
constraints (4 present + 12 absent). **Best fit still violates 3**, it always
prints 1500m, 15km and 30km. `BAR_MAX_DP = 150` violates 4. No setting of the
existing model satisfies the report.

#### And the report is internally inconsistent with a √2 ladder

A step sits between its neighbours, √2 either side, so only the nice numbers in
that gap are available to it:

| step | between | candidates | not on the missing list |
|---|---|---|---|
| 29 | 1200m … 2500m | 1500m, 2km | **none** |
| 23 | 10km … 20km | 12km, 15km | **none** |
| 21 | 20km … 40km | 25km, 30km | **none** |
| 19 | 40km … 80km | 50km, 60km | 60km |

Three of the four steps have **no label that would satisfy the report**. Either
the neighbours (1200m, 2500m, 10km, 20km, 40km) are also not what the model
says. A larger error than a constant, or the list is not exactly what
XCTrack's scale setting offers on that device.

#### What would settle it

The **full ordered list** of scale values XCTrack offers on the Pixel 9a, all 23
of them, read straight off the setting. Same method that settled pixel density:
one device, one measurement, no model of ours in the way. Until then
`BAR_MAX_DP = 150` stands, because it reproduces both recorded label lists 46/46
and nothing better has been demonstrated.

**No live defect either way.** The launcher offers a *union* across densities on
purpose. A scale that a pilot's own screen shows but the list omits is a hard
failure, an offered scale their screen cannot reach is not, and the overlay
resolves to the nearest step it can and prints what that really is. This is
about the accuracy of the label model, not about anything a pilot cannot do.

---

### 2026-08-11: "missing" stations in Zermatt: decluttering, not the fetch

Reported: `widget.html?scale=3000&alt=1&lat=46.0207&lng=7.7491` appears to omit
*ZFC: Schwarzsee*, *Gornergrat*, *Zermatt* and *Platthorn*, all of which the
list page shows at the same position. **Nothing is wrong with the fetch.** All
twelve stations arrive, all twelve are inside the view, and the overlay evicts
some of them on purpose.

#### The stations, and the view they have to fit in

```
  0.64 km  brg   4   ZFC: Landing        2600 m
  0.99 km  brg  15   Zermatt             1648 m
  2.56 km  brg  96   ZFC: Blauherd       2500 m
  2.92 km  brg 325   Triftchumme         2752 m
  3.28 km  brg 183   ZFC: Riffelberg     1620 m
  3.80 km  brg 345   Platthorn           3345 m
  3.91 km  brg  90   ZFC: Rothorn South  3040 m
  4.41 km  brg 235   Stafelalp           2408 m
  4.43 km  brg 221   ZFC: Schwarzsee     2576 m
  4.59 km  brg 144   Gornergratsee       2953 m
  5.01 km  brg 145   Gornergrat          3139 m
  9.82 km  brg 188   ZFC: Kl. Matterhorn 3800 m
```

`scale=3000` resolves to step 27–28 depending on density, so **~20–25 m per css
pixel**. A 411 × 846 widget is then about 10 × 21 km of ground, every one of
those twelve is on screen.

#### What actually drops them

`draw()` evicts a whole marker when it would overlap one already placed,
nearest first. The exclusion zone is **29 px horizontally and 49 px
vertically** (`box*1.5` and `box*1.9 + altSize`), against a drawn footprint of
roughly 39 px across and 61 px tall with the altitude line on, so the zone is
if anything *smaller* than the marker. The colliding pairs:

| kept | dropped | apart | at 25 m/px |
|---|---|---|---|
| ZFC: Landing (0.64 km) | **Zermatt** (0.99 km) | 387 m | 16 px |
| Gornergratsee (4.59 km) | **Gornergrat** (5.01 km) | 434 m | 18 px |
| Stafelalp (4.41 km) | **ZFC: Schwarzsee** (4.43 km) | 1041 m | 42 px |
| Triftchumme (2.92 km) | **Platthorn** (3.80 km) | 1452 m | 59 px |

Every one is closer than a single marker is wide. Which of the four disappear
depends on pixel density and widget size. Measured 10 of 12 drawn at dpr 3 on
448 × 978, 9 of 12 at dpr 2.625 on 411 × 846, 9 of 13 at dpr 2 on 540 × 1097.

**Zooming in does not always separate them.** Both axes must clear, and the
vertical requirement is the larger one at 49 px. Zermatt and ZFC: Landing are
387 m apart on a bearing that is mostly north, so on a north-up screen their
separation is mostly vertical: they still collide at `scale=1500` (dy 26) and at
`scale=1000` (dy 37), and only separate below about `scale=700`. **In a valley
running north–south, the overlay declutters hardest along the valley**, which
is the axis the stations are strung out on. Worth knowing before reading a gap
as an absence.

#### The real defect was the count

`is-highest-duplicates-rating` is not involved: these are 400 m to 1.5 km apart,
not co-located. `max` is not involved either, 12 is far under 120.

The badge said **"9 stations"**, which claims the map is showing everything it
has. It is not. It now says **"9 of 12 stations"** whenever decluttering dropped
anything, and a bare count means nothing was hidden. That is the difference
between "zoom in" and "the data is broken", and the second reading is what sent
the owner looking for a fetch bug.

The list page has no geometry and therefore never hides anything for overlap,
which is exactly why a station absent from the overlay appears there. That
asymmetry is by design and is now visible on screen rather than discovered.

**Not changed, deliberately:** the eviction rule itself. Keeping both markers by
nudging one would break the only thing the overlay is for, an arrow sitting on
the terrain it was measured at. Choosing a "more useful" winner instead of the
nearest would be an inference about which reading matters, which this tool does
not make.

---

### 2026-08-11: the widget was drawing half the stations it had, and hiding the names pilots know

Reported from the air over Piedmont, an area the owner knows well:

    widget.html?scale=25000&lat=44.88&lng=7.33&debug=1
    → "30km N↑  15 stations (5 stale)"

with sites the owner knows to exist, *Decollo TRUCETTI*, *Décollo Liretta
Paradeltaclub Cuneo*, apparently absent. Four separate causes, all confirmed
against the live API.

#### The fetch was never the problem

The box for that view is 143 × 265 km. Probing `within-pt1/pt2` directly:

```
limit=500  last-measure=7200  is-highest-duplicates-rating=true → 125
limit=500  last-measure=7200                                    → 152
limit=500                     is-highest-duplicates-rating=true → 131
limit=500                                                       → 161
limit=1000 / 2000 / 5000                                        → 161   (true total)
no limit at all                                                 →  13   (small default)
```

So 125 stations arrived and **15 were drawn**. Both named stations were in the
response. `is-highest-duplicates-rating` drops 30, and inspecting every one of
them, 29 are genuine co-locations 0–30 m apart; the seven that are 1.7–8.9 km
apart are all cases where the discarded twin was 1 800–38 700 minutes old.
It is doing its job: leave it on.

#### Cause 1: the cap was radial, the screen is a rectangle

`prepare()` sorted by distance and cut at `c.max` = 40. A tall widget covers
103 × 225 km, so **17 of those 40 slots went to stations off the left and
right edges** that could never be drawn, and paid for them by dropping
drawable ones. Measured over the same 125 records:

| widget (dpr) | in view | drawn before | drawn after |
|---|---|---|---|
| 448 × 978 (3)   | 52 | 17 | **30** |
| 411 × 846 (2.625) | 26 | 13 | **18** |
| 540 × 1097 (2)  | 79 | 20 | **41** |
| 360 × 640 (3)   | 19 | 13 | **14** |

Fix: `prepare(list, fix, c, now, keep)` takes an optional lat/lon rectangle
applied **before** the cap. The widget passes its own view (`bboxAround` with
`padKm` 0 and a marker's slack); `app.html` passes nothing, because a list
wants nearest-regardless. Kept as a rectangle rather than a callback so
`core.js` stays DOM-free and the rule stays unit-testable.

#### Cause 2: `max` 40 was too small once the cull was right

Even culled, 40 still cost 7–18 markers at wide scales. Default is now **120**
(ceiling 400). Collision eviction, not the cap, should be what limits a map.

#### Cause 3: `bboxAround` ignored pixel density

It divided by the raw `CAL`, the dpr-3 constant, while `projector` used
`getCal()`. On a screen denser than dpr 3 the view covers more ground than the
box, so the edges were **never fetched**. `mul` now defaults to `getCal()`.

Worth recording because the first instinct was that this would destabilise
`app.html`, whose box is a nominal widget rather than a real view. The
opposite is true. `zoomOf()` already compensates for density, so the raw
`CAL` was double-counting:

```
                        mul = getCal()   mul = CAL (old)
dpr 1     step 18         137 x 252 km     331 x 676 km
dpr 2     step 20         137 x 252 km     186 x 358 km
dpr 2.625 step 21         130 x 237 km     143 x 265 km
dpr 3     step 21         143 x 265 km     143 x 265 km
```

The new default is the one that holds the ground area roughly constant.

#### Cause 4: winds.mobi's `name` and `short` are the opposite way round

This is why the two named stations "were missing", they were on screen the
whole time, under names the owner had no way to recognise:

```json
{ "_id": "pioupiou-1363", "name": "Valgioie",
  "short": "Decollo TRUCETTI 980m",  "pv-name": "openwindmap.org" }
{ "_id": "pioupiou-1407", "name": "Ciciu del Villar",
  "short": "Décollo Liretta Paradeltaclub Cuneo ", "pv-name": "openwindmap.org" }
```

For **openwindmap.org. 63 of the 161 stations here, the largest single
network in the area. `name` is a geocoded municipality and `short` is the
name the station's owner gave it.** For `ffvl.fr`, `holfuy.com`, `slf.ch` and
`meteoswiss.ch` the two fields are identical. `aviationweather.gov` differs
but both forms are real names ("Cuneo International Airport" / "Cuneo/Levaldigi
Arpt").

So `normalise()` now sets `name` to the **owner's** name and carries the
geocoded place as `place` when it differs, shown as the first item of the
subtitle in both the popup and the list. Several records also carry trailing
spaces and non-breaking spaces (`"Baouroux 1600m "`), squeezed on the way
in so the two fields can be compared at all.

#### The 500 cap is real and was silent

`limit` is documented `max=500` and is a hard truncation with no documented
ordering. Piedmont holds 161, but a 190 × 267 km Swiss box holds 309–356, so a
wide scale over the densest Alps can reach it. Splitting the box into several
calls would trade a silent failure for a breach of *"do not overload"*, so
instead the provider reports `meta.capped` and the widget appends **BOX FULL**
to the status line, not suppressible, like the other admissions of doubt.

#### Still filtered, deliberately

`last-measure = stale × 4` (2 h by default) drops 9 of 161 server-side. Those
instruments exist but have not reported in hours; they are not shown at all
rather than shown red. That is a choice, not an oversight, recorded here so
it is not rediscovered as a bug.

---

### 2026-08-11: SETTLED: XCTrack's map works in DEVICE pixels, not CSS pixels

**The question the last three findings kept circling is now measured, and the
answer is yes, it was pixel density all along.** The correction is computed
from `devicePixelRatio` and needs nothing from the pilot.

#### Method: the point is that it does not use our calibration

Every earlier attempt routed through `CAL`, which is circular for this exact
question: nudging our bar until airspace aligns just inherits whatever `CAL`
already is. `tools/ruler.html` draws a ruler in **CSS pixels** over XCTrack's
map. XCTrack's own scale bar is labelled with a ground distance, so

    metres per css pixel  =  the bar's label  /  the bar's length

with no model of ours anywhere in it. **One device at two densities**, a Pixel
9a emulator, stock and `adb shell wm density 320`, changing nothing else.

#### Raw

```
run A   dpr 2.625   widget 411 x 846 css px   device px 1079 x 2221
        XCTrack bar "15km"   spans css x 13.8 .. 124.8   length 111.0 px
run B   dpr 2.000   widget 540 x 1097 css px  device px 1080 x 2194
        XCTrack bar "15km"   spans css x 18.1 .. 159.8   length 141.7 px
```

| run | dpr | m per **css** px | m per **device** px |
|---|---|---|---|
| A | 2.625 | 135.1 | 51.5 |
| B | 2.000 | 105.9 | 52.9 |

#### Verdict

| model | predicts res_A/res_B | measured 1.277 | error |
|---|---|---|---|
| resolution fixed in **css** px | 1.000 | | **28%, falsified** |
| resolution fixed in **device** px | 1.312 | | **2.7%, holds** |

In device pixels the two runs agree to **2.8%**. The identical screen (~1080 px
wide in both runs) shows the same ground width at both densities, which is what
"the map is drawn in device pixels" means, and it is visible directly in the two
screenshots without any arithmetic.

#### The fix

`CAL = 0.942` was measured on a phone at **dpr 3**. Since resolution is fixed in
device pixels, metres-per-css-pixel scales with dpr, so:

    effective CAL  =  0.942 x 3 / devicePixelRatio

Reproduces both runs at step 22, 46.3°N: predicted 138.7 vs measured 135.1
(2.7%), and 105.7 vs 105.9 (**0.1%**). At dpr 3 it is exactly 0.942, so the
owner's phone. Where the airspace-edge registration was verified, does not
move at all. In `wg/core.js` as `WG.setDpr()`, called by `widget.html` and
`app.html` from `window.devicePixelRatio`. **Computed, never configured**: every
future device is right without the pilot doing anything.

The `cal` URL parameter survives only as a manual override for a residual, and
its help text now says so.

#### What this explains, retrospectively

- **The Pixel 9a's different label list**: but not for the reason first
  proposed. See the next section: it is density, not width.
- **The ~8% crop mismatch** measured earlier from the screenshot: at dpr 2.625
  the uncorrected model was 158.6 against a true 135.1, and the residual after
  the density correction is 2.7%.
- **Why the alternating-ladder hypothesis fit one device and nothing else.** It
  was absorbing a density effect into the ladder. The √2 ladder is intact.

#### Consequence: the scale bar is a constant ~150 dp, not a fraction of the width

The label model had been fitted with `CAL` held fixed, so once `mppXct` started
scaling with dpr the two label lists stopped both falling out of it (23/23 and
11/23). That is a genuine disagreement between two measurements, and worth
following rather than patching.

The resolution of it: label lists constrain only the **product** of bar width
and resolution, which is exactly why they could not choose between the candidate
bar rules on their own. Now that the ruler has pinned the resolution
independently, they can. Swept against both devices with the density law applied:

| bar-width rule | labels reproduced |
|---|---|
| **constant max length in dp** | **46 / 46** |
| fraction of widget width (the old 0.325) | 42 / 46 |
| constant in device pixels | 35 / 46 |

Everything in **147.1 – 154.3 dp** scores 46/46; `BAR_MAX_DP = 150` is the
middle. A fixed max length in dp is also simply how an Android widget gets
written, so this is the mundane answer rather than a clever one.

Consequences: `scaleMetres`/`scaleLabel` no longer take a width, a label
depends on **latitude and density**, not on how wide the widget is. The `wpx`
parameter therefore had no consumer left and is replaced by `dpr` (0 = use this
device's own). And the `step` field no longer tells pilots to pair by label: the
launcher shows the dpr-3 list, says so, and asks them to match **bar length**.

#### Consequence: the configurator had to stop shipping ladder steps

Confirmed on device once the density correction landed: the two scale bars now
line up. What remained wrong was the *launcher*, `step=25` is 8km on a Pixel 8
Pro and 6km on a Pixel 9a, so a configurator running on a laptop was picking a
step for a screen it had never seen.

A ladder step is not a scale. So the pilot now picks a **ground scale in metres**,
device-independent, and `WG.resolveStep()` turns it into a step on the device,
at the real density and the real latitude, nearest in log space because the
ladder is multiplicative.

Not every scale exists on every screen: a Pixel 9a's ladder runs 6km, 10km with
no 8km at all, so asking for 8km lands on 10km (10/8 is a smaller factor than
8/6) and the overlay's own bar says so. The invariant that is tested: **whenever
a device can print the requested scale, it is what the pilot gets** , 
checked across both devices' full label lists.

Then the same bug's other half: resolving on the device is no use if the pilot
cannot *express* the scale. Built from the reference phone's ladder the list had
no **6km** at all. Which a Pixel 9a prints, so that pilot could not choose what
their own screen was showing. The two failure modes are not symmetric: an option
this phone cannot reach costs nothing, because nobody picks a number their screen
never shows, but a scale that IS on their screen and missing from the list cannot
be asked for at all. So the list is now the **union over the densities a phone
plausibly has** (`WG.scaleOptions`), 38 entries, generated from the ladder rather
than hand-written so it cannot drift from it. Tested: nothing either measured
device prints is missing.

`step` survives as an explicit override, hidden from the UI by a new marker ,
`adv:true` at the time, renamed `hidden:true` on 2026-08-11 when a genuine
Advanced accordion arrived and the two senses of "advanced" collided.
`ui:false` would have been wrong either way: it also strips the parameter from
every URL the launcher builds.

**Setting `scale` clears `step`.** The step row is hidden, so a pilot arriving
from an old `?step=NN` link could pick a new scale, watch the select change, and
get a URL carrying both. With the pinned step winning and nothing on screen
explaining why the overlay ignored them. Done in `setConfig1`, not in the UI, so
it holds for any caller. A URL that *only* pins a step still works untouched,
which is the entire reason the parameter still exists.

Two traps worth recording, both from the same round:

- The scale `<select>` originally walked `sp.min..sp.max`, which for a
  metres-valued field is 100..2,000,000, two million iterations producing an
  empty list. It walks the ladder now, via `XCT_STEP_MIN/MAX`. **The headless
  screenshot caught it; every unit test was green.**
- The first version of the fix added its own `STEP_MIN`/`STEP_MAX` beside the
  `XCT_STEP_MIN`/`XCT_STEP_MAX` that already existed and were already exported.
  Removed. Grep before adding a constant that sounds obvious.

#### Kept

`tools/ruler.html` stays in the repo. It is the only instrument that measures
XCTrack independently of our own model, and any future doubt about scale is one
screenshot away from settled.

---

### 2026-08-11: configurator was labelling at the equator; pair by BARS not labels

**A real defect, and it sent the owner to the wrong map scale.** `wg/fields.js`
called `scaleLabel(step, null, wpx)`. The guard was `lat === undefined ? 47 : lat`,
and `null` is not `undefined`, so `null` reached `Math.cos`, which returns 1.
Every label in the configurator was computed at the **equator**, one whole step
off:

| step | offered (bug) | correct at 47°N |
|---|---|---|
| 23 | 20km | 15km |
| **24** | **15km** | **10km** |
| 25 | 10km | 8km |

The owner asked for `15km`, got `step=24`, set their map to 15 km, and the widget
drew step 24, which it correctly calls 10 km. Two different scales. Fixed, with
tests for `null`, `undefined` and `NaN`.

#### The design lesson is bigger than the bug

The label depends on **widget width and latitude**, both of which vary by device,
by layout and by where the pilot is flying. So a label is a poor thing to pair on,
and the launcher no longer asks pilots to:

> Set the map roughly, then **fine-tune until the two scale bars are the same
> length**. Match the bars, not the labels.

The bar lengths are the invariant: that is the whole reason the bar exists.

#### What the same screenshot says about density

Both bars are visible with known labels, so it can be read as a measurement:

```
ours    10 km over 127.4 css px  ->   78.5 m/px   (model predicts 77.73)
theirs  15 km over 112.2 css px  ->  133.7 m/px
```

Against our ladder at that latitude:

| XCTrack step | model A | model B (× dpr ratio) |
|---|---|---|
| 22 | 158.6, 19% off | **138.7, 4% off** |
| 23 | 112.1, 16% off | 98.1, 27% off |

Step 22 under model B is the only close fit. **Suggestive that the owner is right
about density**. But which step the map actually landed on is unknown, because it
was set from a buggy label. Not proof, and not acted on.

#### The controlled experiment is already available

The owner has a **Pixel 8 Pro with the density changed**. That is far better than
comparing two different devices: same screen, same XCTrack, one variable.

1. Pick a map scale and match the two bars with `cal`. Record `cal` and the DPR.
2. Change the device density. Repeat without touching anything else.

If `cal` moves by the DPR ratio, XCTrack works in device pixels and the correction
is `3 ÷ devicePixelRatio`, computable, with no per-device setting ever. If `cal`
does not move, resolution is density-independent and the residual is something
else.

---

### 2026-08-11: the label list belongs to the SCREEN, not to the ladder

**Verdict: the √2 ladder was right all along. A correction made earlier today was
wrong and has been reverted.** The printed scale labels are produced by XCTrack's
scale bar, which shows the largest "nice" number that fits a maximum width of
about **0.325 × the widget width**, so two devices print different lists for
identical resolutions.

#### How the mistake happened, because it is the instructive part

The owner reported our scale bar short at `10km`. Working from their phone's label
list, the ratios between consecutive labels were 1.25 and 1.6 rather than √2, so
the ladder was "corrected" to alternate. That model reproduced the phone's 23
labels. **because it had been fitted to them**, and the three measured
calibration points, which are two steps apart and therefore doubling under either
model.

Then the owner mentioned the screenshot came from a **Pixel 9a emulator**, whose
slider offers a *different* list. The alternating model has no mechanism for a
second list. The bar-width model explains both:

| | owner's phone | Pixel 9a |
|---|---|---|
| widget width | 448 css px | ~411 css px |
| bar max | 145.6 (measured at 8 km) | ~134 |
| step 25 prints | **8km** | **6km** |
| step 25 resolution | 54.96 m/px | 54.96 m/px |

One √2 ladder plus two widths reproduces **46 of 46 labels with no misses**. That
is now a test.

The mistake was fitting a model to the one dataset that could not falsify it. The
label list *looked* like evidence about the ladder and was actually evidence about
the scale bar, downstream of the thing being measured.

#### What this changes

- `zoomForStep` is back to `z = (value − 3) / 2`. `XCT_TRUE_M` is gone.
- **Labels are computed, not tabled.** `WG.scaleLabel(step, lat, widthPx)` returns
  what XCTrack will print, from the widget's own width and the live latitude. The
  overlay uses its real width, so it names the scale the pilot's own device names.
- `wpx` lets the launcher's dropdown match a target device, defaulting to 448.
- `XCTrack` prints km only for whole thousands, `1km`, `2km`, but `1200m` and
  `2500m`. Cosmetic, but a mismatched label sends the pilot hunting for something
  their device never shows.

#### Can it be pixel density? Probably: and the labels can never tell us

Owner's question, and it exposes that the "0.325 × widget width" conclusion above
is **also underdetermined**. Two models fit every label on both devices:

| | resolution across devices | bar max width |
|---|---|---|
| **A** | identical in css px (XCTrack works in dp) | 0.325 × widget width |
| **B** | scales with **devicePixelRatio** (XCTrack works in device px) | constant ~150 css px |

```
phone label list needs bar max   145.6 .. 154.4 css px
pixel under model A              128.7 .. 136.4
pixel under model B              147.0 .. 155.9   <- overlaps the phone's range
```

**The label lists constrain only the PRODUCT**: bar width × resolution, and never
either factor alone. So they cannot distinguish A from B, and the labels come out
right under both. That is why `scaleLabel()` is safe either way.

The **resolution** is not safe either way, and that is what places the markers.

**The scale bar discriminates**, because its length is `label ÷ our resolution`:

| | our bar | XCTrack's | difference |
|---|---|---|---|
| model A | 128.6 px | 128.6 px | **0%** |
| model B | 128.6 px | 147.0 px | **+14.3%** |
| measured off the crop | | | about **+8%** |

Leaning B, i.e. the owner is probably right that it is density, but +8% eyeballed
off a cropped JPEG is exactly the evidence that produced the wrong ladder, so it
settles nothing.

**The decisive measurement**, one run of `tools/registration.html` on the Pixel with
the map at its own step 25 (labelled `6km` there), nudged until the airspace edges
line up:

```
model A  ->  zEff 10.914      model B  ->  zEff 11.106
```

If it lands on B, the correction is `3 / devicePixelRatio` and can be **computed**
rather than configured, no per-device setting at all. Until then `cal` exists as
a manual multiplier, defaulting to 1.

### 2026-08-11: `${lat}` answers before a GPS fix; `getLocation()` does not

**Verdict: every widget URL must carry `?lat=${lat}&lng=${lng}`.** Owner noticed it
across two widgets running side by side: the one with the placeholders drew the
wind layer immediately on the ground, the one without stayed blank until the fix
arrived or the page was re-shown.

The two sources are not equivalent before a lock:

| Source | With no GPS fix |
|---|---|
| `XCTrack.getLocation()` | returns the string `"null"`, nothing usable |
| `${lat}` / `${lng}` | filled with XCTrack's **last known position** |

That is the same position XCTrack's own map is centred on, so an overlay using it
is consistent with what the pilot is looking at. And it is safe by the rule
already recorded: remembering a *position* costs nothing because terrain does not
move, unlike remembering a *reading*.

The chain already preferred the URL when `getLocation()` returned `"null"`, the
gap was that `buildUrl()` never emitted the placeholders, so a URL copied from the
launcher had no fallback at all. Fixed.

**They are appended raw, never percent-encoded.** `%24%7Blat%7D` would leave
XCTrack looking for a literal it can no longer find, and the widget would lose the
fallback silently. An unsubstituted token still parses to `NaN` and is ignored, so
a browser opening the same URL falls through to geolocation rather than rendering
a wrong position. `hx-call` measured that trap and it is covered by tests.

**Not a reload risk at refresh rate 0.** The periodic page reload `hx-call`
documents is the *refresh rate* doing its job; with it set to 0 the substitution
happens once at load, which is all a bootstrap needs. Worth confirming on device
that a placeholder URL at refresh 0 really never reloads, if it did, the canvas
would be discarded periodically.

---

### 2026-08-11: station history exists, is CORS-open, and is tiny

**Verdict: the detail popup is buildable.** winds.mobi exposes per-station history
and it costs almost nothing, so a tap-for-trend feature needs no new provider and
no new permission.

```
GET https://winds.mobi/api/2/stations/{id}/historic/?duration=7200&keys=_id&keys=w-dir&keys=w-avg&keys=w-max
  -> 200, access-control-allow-origin: *
```

| Station | Samples over 2 h | Bytes | Cadence |
|---|---|---|---|
| `meteoswiss-DIS` | 10 | **548** | 600 s, some 1200 s gaps |
| `holfuy-1636` | 17 | **966** | 360–480 s |

Returns a plain array, **newest first**, `normaliseHistoric()` reverses it so
every caller gets oldest-first for a left-to-right trend, rather than each having
to remember.

**Fetched on demand, never prefetched.** One call per popup is a deliberate user
action; prefetching history for every marker would be one call per station for
data nobody asked to see, which is exactly what winds.mobi's "do not overload"
rule forbids.

The trend is purely descriptive: the same measured values, over time, so it
breaks no rule, and it answers the one question a single reading cannot: is this
building or easing? A live example from the first run at Sattel showed
`21/33` at 23:20 falling to `5/11` by 23:40, which no snapshot would reveal.

---

### 2026-08-11: overlay verified on device, and the scale bars agree

**Verdict:** `widget.html` renders correctly in XCTrack. The last unverified piece
of Phase 3b is closed, and the scale bar did the job it was built for on its first
run.

Owner's screenshot, XC map deliberately left empty so the bars stand out:

- **Markers render as designed**: halo, gust rim, average fill, and the
  `avg/gust` pair below each arrow with its white casing. Legible against a black
  map. 12 shown, well spaced by the collision declutter.
- Badge top-left reads `8km N↑ 12`.
- **Our scale bar sits directly above XCTrack's, and the two are the same
  length.** Measured off the screenshot at ~150 and ~145 CSS px for 8 km, which is
  agreement within the error of reading a JPEG.

That last point is the calibration confirming itself passively, with no test run
and no arithmetic by the pilot. It is now a permanent check: if the 0.942 constant
is wrong at another latitude, the bars will simply stop matching.

**Manual zoom works.** The owner placed `−` / `+` buttons outside the widget
rectangle; tapping the widget changed its scale and the buttons still drove the
map, exactly as the overlap-only conflict predicted.

**Two faults visible in the screenshot, both fixed:**

1. A marker was drawn across both scale bars. A marker over the bar removes the
   check the bar exists for, so the bar and the badge are now keep-out
   rectangles that the declutter avoids.
2. Owner: "the target area is unobtrusive but very small." The reset, tapping
   the badge, was a ~110×20 px target. When the scale is offset, resetting *is*
   the task, so the badge now becomes a full-width, thumb-sized amber bar for
   exactly as long as it is relevant, and returns to a compact label afterwards.

---

### 2026-08-11: tap pass-through: NO. Zoom sync is not possible.

**Verdict: Phase 3c is dead.** A tap over the web widget never reaches an
XCTrack widget underneath it, in any mode or layer order. The widget and the
zoom buttons are strictly exclusive, one of them gets the tap, never both, so
there is no way for the overlay to learn that the map zoomed. Built and removed
the same day; `tools/tap.html` is kept as the evidence and as the way to re-test
a future XCTrack build.

Run with `tools/tap.html` over an XC map carrying the owner's usual two
background zoom buttons.

```
windgrade tap probe
mode listen
XCTrack getLocation -> null
viewport 448x978

IN/click = 1        OUT/click = 1
IN/mousedown = 1    OUT/mousedown = 1
IN/pointerdown = 2  OUT/pointerdown = 2
IN/touchend = 2     OUT/touchend = 2
IN/touchstart = 2   OUT/touchstart = 2

00:07:13.947  listen  OUT  click       @295,647
00:07:13.946  listen  OUT  mousedown   @295,647
00:07:13.943  listen  OUT  touchend    @295,647
00:07:13.845  listen  OUT  touchstart  @295,647
00:07:13.842  listen  OUT  pointerdown @295,647
00:07:13.012  listen  IN   click       @366,348
00:07:13.011  listen  IN   mousedown   @366,348
00:07:13.007  listen  IN   touchend    @366,348
00:07:12.901  listen  IN   touchstart  @366,348
00:07:12.900  listen  IN   pointerdown @366,348
00:06:49.551  prevent OUT  touchend    @239,819
00:06:49.467  prevent OUT  touchstart  @239,819
00:06:49.465  prevent OUT  pointerdown @239,819
00:06:43.093  prevent IN   touchend    @340,301
00:06:42.987  prevent IN   touchstart  @340,301
00:06:42.987  prevent IN   pointerdown @340,301
```

| Configuration | Web widget | Map / zoom buttons |
|---|---|---|
| `listen`, tapping ON | full chain: pointerdown, touchstart, touchend, mousedown, click | **no zoom** |
| `prevent`, tapping ON | pointerdown, touchstart, touchend (no mousedown/click. `preventDefault` suppressed the synthetic mouse events, so the control worked) | **no zoom** |
| `pe-none`, tapping ON | **nothing** | **no zoom** |
| tapping OFF, widget foreground | still intercepts; hold-to-reload fires | **no zoom** |
| tapping OFF, widget **background** | nothing | **zoom buttons work** |

Layer order makes **no difference while tapping is on**, the owner moved the
buttons between foreground and background and the widget intercepted either way.

**`pe-none` is the informative failure.** With `pointer-events: none` the web
content is not a hit target, yet XCTrack still received nothing. So the WebView
consumes the Android `MotionEvent` regardless of what the page does with it, and
no CSS or JS trick can decline it on the page's behalf. That closes the last
plausible route.

#### The consequence that matters for the shipped widget

Not the dead feature: this one:

> **With "Allow tapping on the web page when locked" ON, the overlay swallows
> every tap over its area, so the pilot's own zoom buttons stop working there.**

The overlay has nothing to tap. It is a passive layer. So tapping should be
**OFF**, and the pilot keeps the zoom controls they already rely on. The probe
turned up a regression in the recommended setup, which is worth more than the
feature it was built to test.

Open question for the owner, since only one arrangement preserves the zoom
buttons: with the widget in the **background** and tapping off, does XCTrack's XC
map draw over the arrows? That is chmd's stack (web page below, transparent XC
map above), and it works visually, but airspace lines and the track then cross
the markers.

---

### 2026-08-10: provider research: winds.mobi, and the XCTrack widget API

**Verdict:** changes Phase 2's data source and closes open decision 4. Also
answers the `getLocation()` question from the desk, so no second probe run is
needed for it.

#### winds.mobi: one CORS-open API for 13 station networks

Found by following what Windspion actually uses: it is a front end for
**winds.mobi**, not a direct provider integration.

```
GET https://winds.mobi/api/2/stations/?near-lat=46.8&near-lon=8.2&limit=400
  -> 200, access-control-allow-origin: *, application/json
```

OpenAPI spec at `https://winds.mobi/api/2.3/openapi.json` (v2.3; `/api/2/` also
resolves). Endpoints: `/stations/`, `/stations/{id}/`,
`/stations/{id}/historic/`.

400 stations around central Switzerland, by provider:

```
141  slf.ch                 12  fluggruppe-aletsch.ch    2  gxaircom.net
 99  meteoswiss.ch          10  aviationweather.gov      2  pdcs.ch
 85  holfuy.com              5  windball.ch              1  thunerwetter.ch
 35  openwindmap.org         4  windline.ch              1  ffvl.fr
                             3  pgsonda.cz
```

A verbatim record:

```json
{
 "_id": "pioupiou-1510",
 "alt": 1666,
 "loc": {"type": "Point", "coordinates": [8.194709, 46.787928]},
 "name": "Lungern",
 "peak": true,
 "pv-name": "openwindmap.org",
 "short": "Hüttstett",
 "status": "green",
 "tz": "Europe/Zurich",
 "last": {"_id": 1786370955, "w-dir": 292, "w-avg": 11.0, "w-max": 16.0}
}
```

Field semantics, quoted from the OpenAPI schema:

| Field | Spec |
|---|---|
| `w-avg` | Wind speed **[km/h]** |
| `w-max` | Wind speed max **[km/h]** |
| `w-dir` | Wind direction [°] (0–359) |
| `alt` | Altitude [m] |
| `peak` | **"Is the station on a peak"** |
| `status` | green: station ok · orange: data might be inaccurate · red: station isn't … |
| `last._id` | Measure date [unix timestamp] |
| `url` | Provider station URLs per language |
| `pv-code` / `pv-id` / `pv-name` | Provider identity |

Measured: `alt` spans 198–3581 m. `peak` is true for 255 of 400. `status` was
green for 395, orange 4, red 1. Timestamps ranged from live to **18 days old**,
so stale stations *are* returned and must be filtered by us.

**Terms of Use**, quoted from the spec, because one of them is a problem:

1. "Always identify your calls to winds.mobi API by setting a **user-agent HTTP
   header**"
2. "**Do not monetize** your service using winds.mobi data in any way"
3. "**Do not overload** this server by minimizing your number of calls. Get data
   for multiple stations at once."

"Any IP or service that doesn't respect these rules will be blacklisted without
any notice." Contact is Yann, `info@winds.mobi`.

**Rule 1 cannot be satisfied from a browser.** `User-Agent` is a forbidden header
name in the Fetch spec, so `fetch()` silently drops any attempt to set it. Rules
2 and 3 we meet trivially. This needs an email to Yann rather than a workaround ,
the automatic `Origin: https://elgandoz.github.io` header does identify the
deployment, and proposing that is the obvious ask. **Deferred by the owner** until
overall feasibility is established; the API works without it in the meantime.

#### The actual query, measured

Every efficiency lever the owner asked for is a server-side parameter:

| Parameter | Use |
|---|---|
| `within-pt1-lat/lon`, `within-pt2-lat/lon` | **bounding box**, visible area plus margin |
| `near-lat`, `near-lon`, `near-distance` | radius alternative, distance in metres |
| `last-measure` | **staleness filter, server-side.** Seconds, or an absolute datetime |
| `keys` | select returned fields, the default set includes temp/hum/rain/pres we never use |
| `is-highest-duplicates-rating` | **dedupes co-located stations** |
| `is-peak`, `status`, `provider`, `ids`, `search` | further filters |
| `limit` | default 20, **max 500** |

Geometry for a widget at OSM z11: the scale that pairs with XCTrack's "6 km" ,
using the 448×978 CSS px viewport the probe measured, at 47.04°N:

```
z11 resolution              52.09 m/px
viewport 448 x 978 px       23.3 x 50.9 km
+ 20 km margin all round    63.3 x 90.9 km
half-extents                dlat 0.4085°   dlon 0.4175°
```

Verified against the densest part of Switzerland (Lucerne / Gotthard):

```
GET https://winds.mobi/api/2/stations/
   ?within-pt1-lat=46.6362&within-pt1-lon=8.2255
   &within-pt2-lat=47.4532&within-pt2-lon=9.0605
   &limit=500&last-measure=1800&is-highest-duplicates-rating=true
   &keys=name&keys=short&keys=alt&keys=peak&keys=status&keys=pv-name
   &keys=loc&keys=last._id&keys=last.w-dir&keys=last.w-avg&keys=last.w-max
```

| Query | Stations | Bytes |
|---|---|---|
| bbox, default keys | 78 | 23,442 |
| + trimmed `keys` | 78 | 19,377 |
| + `last-measure=1800` | 73 | 18,178 |
| + `is-highest-duplicates-rating` | 72 | **17,934** |

**One call, ~18 KB, 72 stations, six networks**: 27 SLF, 20 MeteoSwiss, 14
Holfuy, 7 OpenWindMap, 3 aviationweather, 1 Windline. 49 of the 72 are
`peak: true`; altitudes span 418–3187 m. Against MeteoSwiss-direct's 190 KB
single-network file that is a tenfold reduction for six times the coverage, and
nowhere near the 500 limit.

A record at that key set:

```json
{"_id":"meteoswiss-DIS","alt":1208,
 "loc":{"type":"Point","coordinates":[8.853427,46.706596]},
 "name":"Disentis","peak":false,"pv-name":"meteoswiss.ch",
 "short":"Disentis","status":"green",
 "last":{"_id":1786371600,"w-dir":192,"w-avg":4.3,"w-max":11.9}}
```

**Gotcha:** `keys` must be **repeated parameters**, not comma-separated, the
comma form returns a validation error. Valid values: `pv-id`, `pv-code`,
`pv-name`, `short`, `name`, `alt`, `peak`, `status`, `tz`, `loc`, `url`, and
`last.` prefixed `_id`, `w-dir`, `w-avg`, `w-max`, `temp`, `hum`, `rain`, `pres`.

**The margin sets the refetch rate, and movement turns out not to drive it.**
20 km of pad at 40 km/h ground speed is **30 minutes of flight** before the pilot
reaches its edge. Readings refresh on a ~10 minute cadence, so the data clock
forces a refetch long before movement does. One call per ~10 minutes serves both
the display and winds.mobi's "do not overload" rule. The margin is a *cache*
radius, not a display radius.

#### XCTrack's documented JS interface: altitude answered from the desk

`https://xctrack.org/JavaScriptInterface.html` documents `getLocation()` as
returning a JSON *string* with:

```
lon, lat, time, altGps, isValid, stdBaroAlt (null if no baro sensor),
pressure (null if no baro sensor), speedGps, speedComputed,
bearingGps, heading, airspeed
```

So the answer to the Phase 0 altitude question is **`altGps`** and
**`stdBaroAlt`**: no second probe run required. It also confirms the probe's
`"null"` result was the documented no-fix return value, and that `getLocation` is
the only method, matching what the probe enumerated.

Requires **"Allow web page to access XCTrack data"** in the widget settings.

Two traps worth writing down:

- **`stdBaroAlt` is standard pressure altitude**, referenced to 1013.25 hPa, not
  height above sea level. Comparing it to a station's `alt` is wrong by the QNH
  deviation, easily 100 m+. `altGps` is ellipsoidal. Moot while relative altitude
  stays withdrawn, but it is the obvious future mistake. (winds.mobi returns
  `pres.qnh`, so a real barometric altitude is computable if ever wanted.)
- **`heading` and `bearingGps` are both exposed**, which is what a track-up
  rotation or a radar orientation would need.

#### Widget URL placeholders, and the zoom gap

XCTrack substitutes **`${lat}`** and **`${lng}`** into a Web page widget's URL.
Zoom is *not* exposed, it must be hardcoded. Two open requests:

| Issue | Title | Opened | State |
|---|---|---|---|
| [#1097](https://gitlab.com/xcontest-public/xctrack-public/-/issues/1097) | Forwart zooming to WebView widget | 2024-04-27 | open, 1 upvote, 0 comments |
| [#1235](https://gitlab.com/xcontest-public/xctrack-public/-/issues/1235) | Pass a zoom level to the web widget | 2025-07-04 | open, 3 upvotes, 3 comments |

Neither has a milestone or a developer commitment; #1097 has not been touched
since the day it was filed. **Do not plan on this API arriving.**

The pattern nevertheless works today with a hardcoded zoom. #1235's author
writes: "I embed spotair in a widget, and I overlay on top of this widget a
transparent XC map in order to visualize my track over spotair", using
`https://www.spotair.mobi/widget/map?lat=${lat}&lng=${lng}&zoom=11&layers=wind,radarmf`.
XCMaps wants the same thing from the other side, "add XCMaps with transparent
Base Map as web widget over the XCTrack map", and is blocked on the same gap.

#### XCTrack's map scale ↔ OSM zoom, and it aligns *exactly*

The comments on #1235 are more useful than the request itself. `chmd`, 2025-07-08
and 2026-06-12, obtained via
`/-/issues/1235/discussions.json` (the REST notes endpoint 401s; the web
discussions JSON is public).

XCTrack stores the XC map scale as an integer, `mapWidget_scale.value`, in the
`.xcfg` layout export. It runs 12 (labelled 600 km) to 34 (300 m).

| `mapWidget_scale.value` | XCTrack scale label | OSM zoom |
|---|---|---|
| 13 | 400 km | 5 |
| 15 | 200 km | 6 |
| 17 | 100 km | 7 |
| 19 | 50 km | 8 |
| 21 | 25 km | 9 |
| 23 | 12 km | 10 |
| **25** | **6 km** | **11** |
| 27 | 3 km | 12 |
| 29 | 1500 m | 13 |
| 31 | 800 m | 14 |
| 33 | 400 m | 15 |

`osm_zoom = floor(mapWidget_scale.value / 2) - 1`

**Better closed form, derived 2026-08-10.** chmd's floor formula only handles the
odd steps, which hides the structure. The exact relation across the whole ladder
is

```
z = (mapWidget_scale.value - 3) / 2
```

which reproduces every one of chmd's odd rows *and* gives the even steps as **half**
zoom levels. Checked against all three of our measured points to within 0.04 m/px:
step 23 → z10 → 109.93 (measured 109.89), step 25 → z11 → 54.96 (54.95), step 27 →
z12 → 27.48 (27.47).

**One ladder step is √2 in scale.** That is why 5 km and 10 km never aligned: they
are steps 26 and 24, exactly half a zoom level off the integers. And because our
projector takes a fractional zoom, half-steps are not a special case, step 24
renders at z 10.5, 77.73 m/px. `WG.zoomForStep`, `WG.stepForZoom` and
`WG.XCT_LADDER` implement this, with tests.

Owner's build, steps 12–34 ascending in resolution:

```
12 600km  13 500km  14 300km  15 250km  16 150km  17 120km  18 80km  19 60km
20 40km   21 30km   22 20km   23 15km   24 10km   25 8km    26 5km   27 4km
28 2500m  29 2km    30 1200m  31 1km    32 600m   33 500m   34 300m
```

The **labels are build-specific**, chmd's XCTrack printed different ones for the
same steps. So the label map is cosmetic and the step numbers plus the formula are
the durable part.

**The labels are build-specific. Chmd's do not exist in the owner's XCTrack.**
Reported 2026-08-10: the zoom slider offers 23 values, none of which are 6 km or
12 km:

```
300m 500m 600m 1km 1200m 2km 2500m 4km 5km 8km 10km 15km
20km 30km 40km 60km 80km 120km 150km 250km 300km 500km 600km
```

Twenty-three is exactly chmd's `mapWidget_scale.value` span of 12–34, and **every
second step doubles** (verified: two-step ratios are 2.00 apart from three rounding
artefacts at 2.08/1.88). So the underlying geometry is the same; only the printed
labels changed. Taking the alternating subset that lines up position-for-position
against chmd's eleven OSM-aligned steps gives a consistent ~1.25× relabel:

| OSM zoom | chmd's label | this build |
|---|---|---|
| z15 | 400 m | **500 m** |
| z14 | 800 m | **1 km** |
| z13 | 1500 m | **2 km** |
| z12 | 3 km | **4 km** |
| **z11** | **6 km** | **8 km** |
| z10 | 12 km | **15 km** |
| z9 | 25 km | **30 km** |
| z8 | 50 km | **60 km** |
| z7 | 100 km | **120 km** |
| z6 | 200 km | **250 km** |
| z5 | 400 km | **500 km** |

**Calibrate with 8 km or 15 km, not 5 km or 10 km.** The other alternating subset
(300 m, 600 m, 1.2 km, 2.5 km, 5 km, 10 km, 20 km, 40 km, 80 km, 150 km, 300 km,
600 km) sits half a zoom level away and cannot land on an integer OSM zoom, however
round those numbers look.

### 2026-08-10: overlay registration MEASURED: XCTrack is not on integer OSM zooms

**Verdict: Phase 3b is viable.** The overlay registers against XCTrack's own map,
but only with a constant scale correction, the scale ladder is *not* on integer
OSM zoom levels, so chmd's table cannot be used as-is.

Measured with `tools/registration.html` stacked on an XCTrack map widget set to
**8 km / North-up**, valid GPS fix, verified against airspace edges. Owner's
verdict: "perfect".

```
z11 ≙ XCT 8km ×0.942 N↑
src=xctrack  47.36100,8.57825  valid=true
altGps=536.8  stdBaroAlt=504.7  hdg=116.2  brgGps=162.4
EFF 54.95 m/px    zEff 10.914
ground 24.62×53.74 km  diag 59.11 km
view 448×978 css  dpr3→2
airspace 359 rings  drawn=20  filter=<1137m
```

**The calibration:**

| | |
|---|---|
| XCTrack scale setting | **8 km** |
| Our nominal zoom | z11 (51.78 m/px at 47.36°N) |
| Multiplier needed | **×0.942** |
| Effective resolution | **54.95 m/px** |
| Fractional OSM zoom | **10.914** |
| Offset from z11 | **−0.086 of a zoom level**, i.e. 1/0.942 = 1.062× coarser |

So XCTrack's ladder sits a constant ~6.2% coarser than the OSM levels it otherwise
resembles. The label is a setting name, not a resolution, and it is **not** a
power-of-two OSM step. My earlier ~1.25×-relabel table got the *pairing* right
(8 km ↔ z11, not z10 or z12) but the *scale* wrong.

No principled derivation was found for 0.942, it is empirical. It is close to
2√2⁄3 = 0.9428, which is almost certainly numerology; do not build on that.

#### Confirmed at three ladder steps: one constant covers everything

Owner re-ran at 15 km and 4 km without touching the multiplier. "They hold
perfectly."

| XCTrack | Our zoom | Predicted m/px | Measured | `zEff` |
|---|---|---|---|---|
| 15 km | z10 | 109.93 | **109.89** | **9.914** |
| 8 km | z11 | 54.96 | **54.95** | **10.914** |
| 4 km | z12 | 27.48 | **27.47** | **11.914** |

`zEff` spacing is **exactly 1.000** between steps. Two conclusions follow, and the
second is the one that matters:

1. **The ladder is exact powers of two, and the printed labels are rounded.**
   15 ÷ 8 = 1.875 and 8 ÷ 4 = 2.0, so if the labels were honest the zoom spacing
   would have been log₂(1.875) = 0.907 between the first pair. It was 1.000. The
   labels are cosmetic; the underlying resolution ladder doubles cleanly.
2. **XCTrack's scale is a *resolution*, not a fit-to-widget ground distance.** A
   fit-to-widget model with those labels would have produced the 0.907 spacing.
   It did not: so the setting means metres per pixel, and the correct zoom does
   **not** depend on widget size. This was the biggest remaining structural risk
   and it is now closed by inference from the spacing alone.

So the whole calibration is one constant:

```
effective m/px  =  156543.034 · cos(lat) / 2^z / 0.942
XCTrack label   ->  4 km = z12, 8 km = z11, 15 km = z10, 30 km = z9, …
```

**Still open, low risk:**

- **Is 0.942 latitude-independent?** It is if XCTrack also scales by cos(lat), as
  any Mercator must. Switzerland spans 45.8–47.8°N, where cos differs by 3.7%, so
  worth one check in Valais or Ticino before trusting it nationwide.
- **Widget-size independence is inferred, not measured.** All three runs used the
  same 448×978 widget. The spacing argument above makes a resolution model near
  certain, but one run at a different widget size would settle it outright.
- **Our airspace altitude filter is more restrictive than XCTrack's.** At
  `altGps 536.8` we drew 20 rings with a 1137 m ceiling, while XCTrack was still
  labelling `1700 m–2300 m` and `2300 m–∞` beside the aircraft. So "floor below
  alt + 600" is not quite the rule. Cosmetic for calibration; matters only if we
  ever want the sets to match exactly.

#### Phase 0's altitude question, finally answered with real values

The same readout closes it. Both fields are present and populated:

```
altGps = 536.8      stdBaroAlt = 504.7      hdg = 116.2      brgGps = 162.4
```

`altGps` and `stdBaroAlt` differ by **32.1 m**, which is the QNH deviation from
the 1013.25 hPa standard, exactly the trap recorded earlier. Confirmation that
`stdBaroAlt` must never be compared against a station's altitude. `heading` and
`bearingGps` are both live, so a track-up rotation or a radar orientation has the
data it would need.

---

Earlier note, superseded by the measurement above: the ~1.25× relabel table was a
hypothesis that `tools/registration.html` was built to test. It carried √2
multipliers in case the other alternating subset was the aligned one; the real
answer turned out to be neither.

**Only the odd values map.** The reason the alignment is exact rather than
coincidental: XCTrack's integer steps the scale by about √2, so two steps double
it, while OSM zoom doubles per level. Every second XCTrack step therefore lands
on an OSM level. The even values are intermediate scales with no OSM equivalent,
which is why the feature request asks XCTrack for an option to skip them.

**And it is verified, not asserted.** chmd's method, which is also *our*
acceptance test:

> 1. Take the url `https://www.spotair.mobi/?lat=${lat}&lng=${lng}&layers=asairspace&zoom=11`
> 2. Overlay a transparent XC map
> 3. Choose zoom level 6km
> 4. Enable/Disable airspaces on the XC map
> 5. Verify that they match perfectly with the airspaces shown by spotair

Airspace boundaries are a shared, hard-edged reference visible in both layers, so
toggling one against the other proves registration to the pixel. Repeating it at
several scales is what produced the table.

Two further details from the same comments:

- **"There is exactly one XC map getting changed when zoom in/zoom out inputs are
  sent (the map at the bottom of the stack)."** So zoom applies to the
  bottom-most map widget.
- **The XC map widget can itself be transparent and stacked above a web widget.**
  chmd puts the web page *below* and a transparent XC map *on top*. Both orders
  are possible, and the choice matters for us: our arrows on top stay legible,
  our arrows underneath get crossed by airspace lines and the track.

Other sites already built for this pattern, useful as prior art:
`spotair.mobi`, `thermik.pumpt.net`, `meteo-parapente.com`, `puretrack.io`.

### 2026-08-10: XCTrack on Android 17 (Build/CP41.260717.006)

**Verdict: the Phase 0 gate is CLEARED, Phase 1 can start.** Every question in
`plan.md`'s feasibility table now has an answer. WebGL is absent, so Canvas is
settled. The 10 MB blob survives a full app restart, so the offline design holds.
Quota is ~10 GB. Service Worker, Cache Storage and IndexedDB are all present.
MeteoSwiss serves CORS headers, so no proxy and no backend. Byte ranges return
206.

What is left is not gating: `persist()` was never tapped (hardening, not a
precondition), `getLocation()`'s payload shape is unknown but was downgraded out
of the critical path, and byte ranges against a real `.pmtiles` cannot be tested
until a pack exists, a Phase 3 risk with a known fallback.

```json
{
 "timestamp": "2026-08-10T10:35:18.743Z",
 "url": "https://elgandoz.github.io/windgrade/probe.html",
 "protocol": "https:",
 "secureContext": true,
 "userAgent": "Mozilla/5.0 (Linux; Android 17; Build/CP41.260717.006; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 ",
 "screen": "448x978 @3",
 "onLine": true,
 "deviceMemoryGB": 8,
 "hardwareConcurrency": 9,
 "XCTrack object": true,
 "XCTrack methods": "getLocation",
 "getLocation() raw": "null",
 "parse": "failed: Cannot convert undefined or null to object",
 "serviceWorker": true,
 "caches": true,
 "indexedDB": true,
 "storageManager": true,
 "localStorage": true,
 "canvas2d": true,
 "webgl": false,
 "OffscreenCanvas": true,
 "webp": true,
 "persisted (already)": false,
 "quota": "10250.1 MB",
 "usage": "10.1 MB",
 "test blob present": true,
 "test blob size": "10.0 MB",
 "test blob written": "2026-08-10T10:34:58.661Z",
 "range status": 206,
 "content-range": "bytes 0-99/4948",
 "CORS Holfuy live (no key)": "BLOCKED (Failed to fetch)",
 "CORS MeteoSwiss gust 10min": "200 · 284ms · 0.2 MB",
 "CORS MeteoSwiss STAC root": "200 · 298ms · 0.0 MB"
}
```

Notes:
- altitude field name: **UNANSWERED**, `getLocation()` returned `"null"`
- blob survived restart: **UNANSWERED**, 20 s elapsed, not a restart
- quota: 10250.1 MB (~10 GB), `persist()` **never requested**
- CORS: MeteoSwiss 200 with no proxy. Holfuy blocked in-WebView.

#### Settled: no WebGL. Canvas is mandatory, not preferred.

`webgl: false` on Android 17 with a current WebView and 8 GB of RAM. This is
not an old-device artifact. WebGL is simply not exposed to XCTrack's WebView.

That removes the conditional from `AGENTS.md` ("unless the probe shows WebGL is
solid") and from `handover.md` ("revisit only if the probe shows WebGL is
solid"). MapLibre is out. `protomaps-leaflet` to Canvas is the only path, which
is what Phase 3 already assumed.

Supporting: `canvas2d: true`, `OffscreenCanvas: true`, `webp: true`. WebP means
the hillshade raster can ship as WebP rather than PNG. OffscreenCanvas means
tile rasterisation can move off the main thread if it ever needs to.

`screen: 448x978 @3`: device pixel ratio 3, i.e. 1344×2934 physical. Rendering
the map at full DPR is ~9× the fill rate of DPR 1 for no legibility gain at
100 m/px. Cap the canvas backing store at DPR 1–2.

#### Settled: MeteoSwiss needs no proxy, confirmed from inside the WebView.

200 in 284 ms for the gust endpoint, 298 ms for STAC. Static hosting holds; no
backend needed. Holfuy is `BLOCKED (Failed to fetch)` from the WebView, matching
the missing `access-control-allow-origin` seen from curl, so Holfuy is two
gates, permission **and** a proxy.

#### Settled: storage is abundant and the pack ceiling is a hosting limit.

`serviceWorker`, `caches`, `indexedDB`, `storageManager`, `localStorage` all
present; `secureContext: true`. Quota ~10 GB against a ~50 MB pack.

So the "~50 MB per pack" rule in `AGENTS.md` is purely a git/GitHub-Pages
constraint, never a device one. If packs move to R2, that ceiling lifts and the
region split can be reconsidered, the device does not care.

#### The 206 result is real but tests the wrong representation.

`range status: 206` from inside the WebView. Byte ranges work.

But `content-range: bytes 0-99/4948`, and `probe.html` is 14348 bytes on disk.
4948 is its **gzipped** length. Verified from the laptop:

```
Range + Accept-Encoding: gzip, deflate, br  -> 206  content-encoding: gzip  bytes 0-99/4948
Range + no Accept-Encoding (curl default)   -> 206  (no encoding)           bytes 0-99/14348
```

**This corrects the earlier laptop entry below, which concluded that Pages
resolves ranges against the identity representation.** It does not. It resolves
them against whichever representation content negotiation selected. Plain
`curl` sends no `Accept-Encoding` and so silently tested identity; a browser
always offers gzip and gets the compressed one.

Why this matters more than the 206: PMTiles computes absolute byte offsets from
its own directory. Offsets into a gzipped stream are meaningless. And a browser
**cannot** opt out. `Accept-Encoding` is a forbidden header name in `fetch()`,
so the identity workaround that works in curl is unavailable in the client.

This origin does compress `application/octet-stream`:

```
/LICENSE     (1408 B)  application/octet-stream  content-encoding: gzip   total 855
/.gitignore  ( 195 B)  application/octet-stream  no encoding              total 195
/.nojekyll   (   0 B)  application/octet-stream  416, content-range */0
```

So compression here tracks a size threshold, not the content type, `.gitignore`
escaped only by being under it. Whether Fastly's on-the-fly gzip has an upper
size cap that a tens-of-MB `.pmtiles` would exceed is **not established**, and
it is now the one remaining PMTiles unknown.

**The test that actually settles it** (needs a real binary on the origin):

```
curl -s -D- -o /dev/null -r 0-99 \
  -H 'Accept-Encoding: gzip, deflate, br' \
  https://freeflight-tools.github.io/xctrack-windmap/packs/<region>.pmtiles \
  | grep -iE '^HTTP|content-type|content-encoding|content-range'
```

Pass = 206, **no** `content-encoding`, and a `content-range` total equal to the
file's real byte size. Anything else and the packs go to R2, which is why
Phase 3's manifest already holds absolute pack URLs.

#### Settled: the 10 MB blob survives a full XCTrack restart.

**Owner-confirmed**: the JSON above was copied out of XCTrack *after* force-
closing and reopening the app, and `test blob present: true` with
`test blob written: 2026-08-10T10:34:58.661Z` is the pre-restart blob being read
back.

This entry originally disputed that, on the grounds that only 20 seconds separate
the write from the page load. That was an inference from a timestamp, and it was
wrong: the restart happened inside that window.

**This is the result Phase 3 depends on.** Offline map packs in Cache Storage are
viable, so the offline design stands as written.

Two things worth drawing out:

- It survived while `persisted` was `false`. Eviction did not touch a 10 MB blob
  across an app restart *without* a persistence grant, which makes
  `navigator.storage.persist()` a hardening step rather than a precondition. The
  handover called eviction "an unsolved problem" quoting the CDMX PWA author;
  on this device, at this size, it did not occur.
- 10 MB is not 50 MB. Nothing here says a full-size pack behaves the same under
  real storage pressure, so check quota and call `persist()` before downloading,
  as Phase 3 already specifies.

#### Still open: nothing that gates Phase 1.

1. **`getLocation()`'s payload shape, no longer a blocker.** It returned the
   string `"null"`, so `JSON.parse` yielded `null` and `Object.keys(null)` threw
   the reported `Cannot convert undefined or null to object`. That is XCTrack
   saying *no GPS fix*, not a broken bridge. Field names for latitude, longitude
   and altitude are all still unknown.

   **Downgraded the same day.** The owner has ruled that relative altitude is
   not important and that the map must render even with no position at all. So
   this no longer gates anything, it is now just an unknown to resolve
   opportunistically on the next run with a fix. `plan.md`'s old "no altitude,
   no feature" is withdrawn.

   Useful anyway: the bridge *does* enumerate, and exposes exactly one
   function, `getLocation`. There is no separate altitude accessor, so if
   altitude exists it is a field in that payload.

2. **`persist()`, not requested, and no longer a gate.** `persisted (already):
   false`, and neither `persist() granted` nor `persist()` appears in the JSON,
   so the button was not tapped (or the JSON was copied before the promise
   resolved). Worth doing, but see the blob result below: eviction did not bite
   even *without* a grant, so `persist()` is hardening rather than a
   prerequisite.

3. **Byte ranges against a real `.pmtiles`.** The one genuinely unresolved
   architectural risk, described above. It cannot be tested until a pack exists,
   so it is a Phase 3 risk with a known fallback (R2), not a Phase 0 blocker.

#### Probe defects that cost this run

Recording these rather than patching, since the probe is frozen until Phase 0
closes.

- **The user-agent is sliced at exactly 110 characters**, which lands precisely
  at the end of `Version/4.0 ` and cuts the `Chrome/xxx.x.x.x Mobile Safari`
  token. The one field that determines which JS and CSS features are safe. The
  slice needs to be ~180.
- **A null fix reports as a type error.** `"Cannot convert undefined or null to
  object"` reads like a probe bug. It should say "no GPS fix, go outside and
  re-run", because that ambiguity is what left question 1 open.
- **The two manual tests can be silently skipped.** `persist()` and the restart
  check need button taps, and a run that omits them looks complete in the JSON
  rather than showing "not run".
- **The range test targets `location.href`**, i.e. gzipped HTML. It proves 206
  but not the representation semantics PMTiles needs. It should target a
  committed binary.

---

### 2026-08-10: laptop / curl (NOT a WebView run)

**Verdict:** settled CORS and the provider payload shape. Its byte-range
conclusion was wrong. See the correction in the WebView entry above.

These are `curl` results from macOS, not `probe.html` output.

#### HTTP 206 / byte ranges: GitHub Pages

Origin: `https://elgandoz.github.io/windgrade/`

> **Superseded 2026-08-13.** The repo moved to the `freeflight-tools` org and
> was renamed, so the automatic `Origin` the API now sees is
> `https://freeflight-tools.github.io`. The measurement above stands, the
> header is still sent and still identifies the deployment, but this is the
> value to quote to winds.mobi, and the one in the question posted to their
> community. The old origin will never appear again.

```
GET /probe.html  Range: bytes=0-99      -> 206, content-range: bytes 0-99/14348, 100 bytes
GET /probe.html  Range: bytes=500-599   -> 206, correct plaintext at that offset
HEAD /probe.html Range: bytes=0-99      -> 200  (Fastly ignores Range on HEAD — not a failure)
```

`accept-ranges: bytes` and `access-control-allow-origin: *` on every response.
The `*` matters for later: packs can be served from another origin without a
client change.

**Test ranges with GET, not HEAD.** `curl -I` reports a misleading 200.

> **Superseded.** This entry originally concluded that Pages resolves ranges
> against the identity representation. That was an artifact of curl sending no
> `Accept-Encoding` at all. See the WebView entry above.

#### CORS: providers

```
200  acao: *      MeteoSwiss gust 10min   (190 KB, content-type binary/octet-stream)
200  acao: *      MeteoSwiss avg 10min    ch.meteoschweiz.messwerte-windgeschwindigkeit-kmh-10min
200  acao: *      MeteoSwiss STAC collection ch.meteoschweiz.ogd-smn
200  no acao      Holfuy live  -> {"errorCode":"no_access"}
```

MeteoSwiss needs **no proxy**. Static hosting holds.

#### MeteoSwiss payload shape: the 2020 gist URLs still resolve

155 features. Confirmed live, so the `handover.md` doubt is settled. Two
endpoints are required, one per colour channel: `boeenspitze` (gust → border)
and `windgeschwindigkeit` (average → fill).

```json
{
 "type": "Feature",
 "geometry": { "type": "Point", "coordinates": [2771036.8, 1184825.9] },
 "id": "ARO",
 "properties": {
  "station_name": "Arosa",
  "value": 20.9,
  "wind_direction": 98,
  "wind_direction_radian": 1.710423,
  "unit": "km/h",
  "reference_ts": "2026-08-10T10:20:00Z",
  "altitude": "1888.00",
  "measurement_height": "10.00 m",
  "description": "<table>…"
 }
}
```

Three things that change Phase 2, all facts, no inference:

- **Coordinates are EPSG:2056 (Swiss LV95), not WGS84.** Top-level
  `crs.properties.name` declares it. A provider module must transform before
  anything can be placed on a map. swisstopo's approximate LV95→WGS84 formula
  is a short pure function, no library.
- **`altitude` ships per station**, as a string in metres above sea level, so no
  DEM lookup is needed to label a station. The DEM is only ever for drawing
  terrain. (This entry originally added that it also powers Δ-altitude ranking;
  that ranking was dropped later the same day. The altitude is still displayed
  as a fact.)
- `unit` is already `km/h`, matching the assumption in `plan.md`. `reference_ts`
  is ISO-8601 with `Z`, which feeds the staleness rule directly.

Also: most of the 190 KB is the per-station `description` HTML table, which we
never render. Relevant to the ~10 min poll on a flight battery.
