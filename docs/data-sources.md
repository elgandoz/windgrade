# Wind data sources: what we use, what we are missing, and what to do

Written 2026-08-17. Prompted by a comparison against Naviter's **SeeYou
Navigator**, whose live wind map shows more stations in the Western Italian
Alps than Windmap does.

Everything numeric below was measured against the live winds.mobi API on
2026-08-17. Re-measure before trusting it a year from now.

---

## The short version

1. **OpenWindMap is a network, not an aggregator, and we already have it.**
   Swapping to it would cost us most of our stations everywhere.
2. **The gap is national networks, not APIs.** winds.mobi is dense where a
   country's official network feeds it and thin where none does. Piemonte has
   **zero** Italian stations.
3. **The fix belongs upstream.** A winds.mobi provider lights up the Western
   Alps for every winds.mobi client and needs **no change to this repo at all**.
4. **The target is MeteoNetwork, not ARPA Piemonte** (established 2026-08-17,
   section 7). It is CC-BY 4.0, it has a bulk `lat`/`lon`/`range` call returning
   every field we need, and it already aggregates the Italian regional networks
   and MET Norway as sub-networks. One provider instead of twenty.

---

## 1. What SeeYou lists

From SeeYou Navigator's About dialog, verbatim:

> Based on data from the OpenWindMap wind network <https://openwindmap.org>,
> MeteoSwiss, WSL Institute for Snow and Avalanche Research SLF (www.slf.ch),
> MET Norway, Source: Civil Protection of the Friuli Venezia Giulia Region
> (CC-BY 4.0), Lawinenwarndienst Tirol (CC-BY 4.0), GeoSphere Austria (CC-BY
> 4.0), Lawinenwarndienst Salzburg, Meteorology and Climatology Agency
> ItaliaMeteo, PanoCloud, Lawinenwarndienst Bayern

Naviter aggregates these **themselves**. OpenWindMap is one entry on that list,
not the source of the rest.

## 2. OpenWindMap / Pioupiou / Windbird

Same project under three names: Pioupiou was the original sensor, Windbird is
the current one, OpenWindMap is the network they report to.

- **API**: `GET https://api.pioupiou.fr/v1/live/{id}` and
  `/v1/live-with-meta/{id}`. `{id}` may be `all` for a bulk fetch.
- **Auth**: none. **Rate limit**: do not poll faster than 60 s, for one station
  or for all. A push API exists for real-time needs.
- **Fields**: heading, avg/min/max speed in km/h, measurement date, plus
  station name, location, altitude, signal strength and power state.
- **Licence**: attribution to "(c) contributors of the Pioupiou wind network".
- **Scope**: its own stations only. It carries none of the other networks.

**Do not swap to it.** Measured station counts, same boxes, 2026-08-17:

| box | winds.mobi total | of which OpenWindMap |
|---|---|---|
| Piemonte / W Italian Alps (44.6–45.8 N, 6.7–8.0 E) | 32 | 18 |
| Valais, CH (46.0–46.5 N, 7.0–8.1 E) | 106 | 7 |
| Aosta valley (45.5–46.0 N, 6.8–7.9 E) | 26 | 7 |
| French Alps, Annecy/Mont Blanc (45.6–46.2 N, 6.0–6.9 E) | 74 | 29 |
| Tirol, AT (46.9–47.5 N, 10.5–12.0 E) | 40 | 8 |

Valais would go from 106 stations to 7.

**We already have it**: winds.mobi's `pioupiou` provider is OpenWindMap. The
station that started this whole investigation, `Decollo TRUCETTI`, comes back
as `_id: "pioupiou-1363"`, `pv-name: "openwindmap.org"`.

## 3. What winds.mobi actually runs

The 24 provider modules in `winds-mobi/winds-mobi-providers/providers/`:

```
aletsch      borntofly    ffvl         gxaircom     holfuy       iweathar
kachelmannwetter          metar        meteoswiss   myexample    pdcs
pgsonda      pioupiou     pmcjoder     romma        slf          thunerwetter
windball     windline     windspots    windy        wunderground yvbeach
zermatt
```

`myexample` is the template for contributors, not a source.

## 4. Measured coverage, and the shape of the gap

Prefix breakdown by box, 2026-08-17. Note the 500-station API ceiling: the
first row is truncated and is a lower bound.

| box | total | breakdown |
|---|---|---|
| Whole Alps (45.0–48.0 N, 5.5–11.0 E) | 283 | pioupiou 71, holfuy 64, meteoswiss 46, slf 35, ffvl 35, metar 17, aletsch 5, windspots 4, gxaircom 3, windline 1, windball 1, pgsonda 1 |
| Italy east + Austria (43–47 N, 9–14 E) | 198 | slf 60, pioupiou 34, metar 29, holfuy 29, meteoswiss 26, gxaircom 18, ffvl 1, windline 1 |
| Norway (58–61 N, 5–11 E) | 79 | holfuy 71, metar 8 |
| Piemonte (44.6–45.8 N, 6.7–8.0 E) | 32 | pioupiou 18, ffvl 9, metar 4, holfuy 1 |

**The pattern is unambiguous.** winds.mobi is dense where a national network
feeds it and thin where none does:

- **Switzerland**: SLF + MeteoSwiss. Valais alone has 106 stations.
- **France**: FFVL + ROMMA. The French Alps box has 74.
- **Italy**: nothing national. Piemonte's 32 are OpenWindMap, French FFVL
  spilling over the border, four METAR airports and one Holfuy.
- **Austria**: nothing national. Tirol's 40 are 31 private Holfuy units.
- **Norway**: no MET Norway. 71 of 79 are Holfuy.

So the difference against SeeYou is exactly **ItaliaMeteo, the Austrian
avalanche services, GeoSphere Austria, LWD Bayern and MET Norway**, and none of
it is reachable through OpenWindMap.

## 5. Windy and Weather Underground: present, effectively unused

Both providers exist, and **both read a curated list from a database table**
rather than discovering stations:

- `providers/windy.py` selects from `winds_mobi_windy_station`, then calls
  `https://stations.windy.com/pws/stations/{key}` and
  `/pws/station/open/{key}/{id}`. Needs `settings.WINDY_API_KEY`.
- `providers/wunderground.py` selects from `winds_mobi_wunderground_station`.
  Its API key is **hard-coded in the source**, with a comment noting it has not
  changed in years. Fragile.

**No `windy-` or `wunderground-` station appeared in any European box I
sampled** (560 stations across the three boxes above). Absence in a sample is
not proof of zero globally, but the integration is clearly not a meaningful
source of coverage today. Stations must be added by hand on the winds.mobi
side.

## 6. Ecowitt stations

**OpenWindMap: not possible.** It is a closed hardware network. A Windbird unit
plus Sigfox connectivity, free for the first year then about €20/year.

**winds.mobi: possible, two routes.**

- **Shortest route, if a winds.mobi MeteoNetwork provider exists.** Register the
  stations with **MeteoNetwork** (section 7) and they arrive through the same
  provider as everything else, with no per-station step on the winds.mobi side
  at all. Ecowitt into MeteoNetwork is well-trodden: the MeteoNetwork forum has
  a long-running thread on it, and the station owner supplies a station id and
  an API key to the uploader. This is the route to prefer.
- **Short route.** Ecowitt firmware uploads to **Weather Underground
  natively** (a built-in target alongside ecowitt.net and Weathercloud). Windy
  can also import from a Wunderground station. Either way the station then
  needs its id adding to the curated table above, which means asking Yann.
- **Long route.** A native `ecowitt` provider PR. Ecowitt's cloud API is
  per-account (application key + API key), so it does not fit the "fetch a
  whole network in one call" shape the other providers use. Try the short route
  first.

**Siting matters more than plumbing.** A garden station at 300 m tells a
paraglider pilot far less than a ridge station, and this tool's whole premise
is that where a reading was taken is what makes it mean something. Worth saying
to anyone offering a station.

## 7. MeteoNetwork: the target

Established 2026-08-17 from the OpenAPI spec at
<https://api.meteonetwork.it/swagger.yaml> (REV5, 18/05/2023). This is what
step 2 of the plan was for, and it answers it.

**It is an aggregator, not just an amateur network.** Stations carry a
`subnets` array, and the `subnet_exclude` parameter documents its own example
as `"metno,mistral"`. **Mistral** is the Arpae/ItaliaMeteo open-data platform
that MeteoHub is built on, and **metno** is MET Norway. So the two largest
names on the SeeYou list that winds.mobi lacks appear to arrive here as
sub-networks of a single API, alongside MeteoNetwork's own Italian stations.

**The shape fits what we already do.** `GET /v3/data-realtime` is a bulk call
taking `lat`, `lon`, `range` (km), which is our `range` parameter almost
exactly, or `country` / `region` / `subnet`.

Every field Windmap needs is in the `Realtime` schema:

| we need | MeteoNetwork field |
|---|---|
| speed | `wind_speed` |
| gust | `wind_gust` |
| direction | `wind_direction_degree` (added REV3; `wind_direction` is a compass string) |
| position | `latitude`, `longitude` |
| altitude | `altitude` (integer) |
| staleness clock | `observation_time_utc` |
| name / place | `name`, `place`, `region_name` |

`GET /v3/stations` adds the metadata a provider needs once per station, and
some of it is unusually good for siting: `altitude`, `soil_height`,
`tipology`, `shielding`, `buildings_distance`.

**Licence: CC-BY 4.0**, declared in the spec's `info.license` block and in the
collaboration terms. Two caveats, both real:

- It is **opt-in per contributor**, not blanket. The terms bind those who
  accepted them, and MeteoNetwork may sub-licence under CC-BY 4.0 "o una altra
  licenza gratuita e di carattere aperto". So the licence on a given station is
  a per-station fact, not a network-wide one.
- Attribution is described as at the copyright holder's discretion, which is
  looser than CC-BY normally reads. A provider should attribute anyway.

**Access.** A free myMeteoNetwork account (<https://my.meteonetwork.it>),
then `POST /v3/login` for a Bearer token. **The bulk methods need a `BULK`
token, which is granted on request** with "additional information about the
activity you are going to perform". That is a gate, but a soft one, and a
winds.mobi provider is exactly the kind of activity it exists to vet. Rate
limits are 1 request/second and 1 thread.

**This does not reach us directly.** The token makes it a server-side API, so
it cannot be called from `wg/windsmobi.js` in the browser. That is an argument
*for* the upstream route, not against the source.

### And ItaliaMeteo directly, if MeteoNetwork's mistral subnet disappoints

MeteoHub (<https://meteohub.agenziaitaliameteo.it>) is the first-party route to
the same regional data: 4000+ stations from "reti di proprietà regionale",
free registration, CC-BY on the *Osservazioni idro-meteo stazioni al suolo*
dataset, BUFR or JSON.

**Its API shape is worse for us**: it is a batch extraction service, not a
query. `POST /api/data` submits a request, `GET /api/requests` polls its status,
`GET /api/data/{filename}` downloads the result, with a default of **10
requests per hour** and a 15-minute floor on scheduled extractions. Workable
for a scheduled provider at our ~10 minute cadence, awkward, and strictly more
code than MeteoNetwork. Treat it as the fallback.

---

## The plan

Ordered by cost. Each step is useful on its own.

### Step 1: ask, before writing anything

There is an **open email thread with Yann at winds.mobi** (see `todo.md`, the
`User-Agent` and `ETag` questions, sent 2026-08-12). Add to it:

- Are Italian or Austrian national networks on the roadmap?
- Would a PR for a **MeteoNetwork** provider be welcome (CC-BY 4.0, bulk
  `lat`/`lon`/`range` call, and it appears to carry the Italian regional
  networks and MET Norway as sub-networks; see section 7)? Is there a reason it
  was not done already, which would be worth knowing before writing it?
- Can a handful of **Ecowitt** stations be added, and by which route: the
  curated Wunderground table, or MeteoNetwork if that provider lands?

Cheapest possible step and it may make steps 2 and 3 unnecessary or better
aimed.

### Step 2: measure the source before writing the provider

The licence and API questions this step was written for are **answered** in
section 7: CC-BY 4.0 (opt-in per contributor), free account, bulk call, wind
speed, gust, direction, coordinates and altitude all present. What is left is
the thing no spec can tell you: **whether the stations are actually there, and
whether they are worth drawing.**

Get a `BULK` token and count, in the same boxes as section 4:

- how many stations `data-realtime` returns for Piemonte, and how that compares
  to the 32 winds.mobi gives us today;
- how many carry a **non-null `wind_speed`**. A network built around
  temperature and rain may report wind on a minority of stations, and a
  station without wind is not a station as far as this tool is concerned;
- how many are in the `mistral` and `metno` subnets, which is what would
  confirm the aggregation claim rather than inferring it from a parameter's
  example value;
- what the **altitude distribution** looks like. This is the one that decides
  whether it is worth it. Amateur networks skew to gardens in valleys, and per
  the product rules a valley-floor reading drawn on a ridge is not a bonus, it
  is noise. `tipology`, `soil_height` and `buildings_distance` are in the
  `stations` payload for exactly this judgement.

If wind coverage or siting is poor, say so and stop. A thin provider is worse
than no provider, because it makes the map look answered.

### Step 3: write the provider, upstream

`winds-mobi/winds-mobi-providers` is **AGPL v3** and takes pull requests:
"Fork this repository and open a pull request with your new provider code",
with `providers/myexample.py` as the template. Some providers need
`winds-mobi-admin` running locally for station metadata.

**This repo does not change.** A new upstream provider reaches Windmap through
the same single bounding-box call we already make, and reaches every other
winds.mobi client at the same time. That is the whole argument for doing it
there rather than here.

### Step 4 (only if 1–3 fail): a second provider in Windmap

**Resist this.** `wg/windsmobi.js` is one provider behind one bounding-box call
per ~10 minutes, and that discipline is what keeps us inside winds.mobi's "do
not overload" rule and keeps the tick loop cheap. A second source would add:

- a merge-and-dedupe layer, since networks overlap and the same mast can appear
  twice under two ids;
- two staleness clocks with different semantics, against a product rule that
  says stale data must announce itself;
- a second failure mode per poll, and a second set of terms to honour;
- a second `normalise()`, and with it a second chance to disagree about what
  `name` versus `short` means. See the winds.mobi name/short swap in AGENTS.md.

If it ever happens anyway, the provider interface in `wg/windsmobi.js` is the
seam to copy, and `prepare()` must stay the only thing that ranks and culls.

---

## Not verified

- **No station-by-station diff against SeeYou.** The conclusion that the extra
  stations come from those networks is inference from the coverage pattern, not
  a matched comparison. It would be settled by picking one station visible in
  SeeYou and absent from Windmap and identifying its operator.
- **PanoCloud**: could not identify what this is.
- **Every MeteoNetwork number.** Section 7 is read off the OpenAPI spec and the
  licence pages, not off the API: no token was requested and no call was made.
  Station counts, wind coverage and altitude distribution are all unmeasured,
  which is exactly what step 2 is now for. In particular, `metno` and `mistral`
  are **inferred from the `subnet_exclude` parameter's example value**, which is
  suggestive but is not a list of subnets.
- **ARPA Piemonte**: superseded rather than investigated. If MeteoNetwork's
  Italian coverage disappoints, the regional agencies are still there
  (<https://www.arpa.piemonte.it/dato/open-data>) and their licences are
  still unread.
- **Windy/Wunderground global usage**: sampled Europe only.
- **MET Norway, GeoSphere, the Lawinenwarndienst services**: not investigated
  as APIs. Listed here only as the gap, not as a recommendation.

## Sources

- OpenWindMap API: <https://developers.pioupiou.fr/>,
  <https://github.com/OpenWindMap/api-v1-doc>
- winds.mobi providers: <https://github.com/winds-mobi/winds-mobi-providers>
- MeteoNetwork API spec: <https://api.meteonetwork.it/swagger.yaml>, rendered at
  <https://api.meteonetwork.it/documentation.html>; registration at
  <https://my.meteonetwork.it>; licence terms at
  <https://www.meteonetwork.it/informative/termini-di-licenza-e-di-collaborazione/>
- MeteoHub API guide: <https://meteohub.agenziaitaliameteo.it/ui/user-guide>
- ARPA Piemonte open data: <https://www.arpa.piemonte.it/dato/open-data>
- Agenzia ItaliaMeteo: <https://dati.agenziaitaliameteo.it/>
- Windy PWS: <https://stations.windy.com/>
