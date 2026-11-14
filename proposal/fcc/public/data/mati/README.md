# Mati / NE Attica fire, 23 July 2018 (scenario pack `mati-2018`)

Offline scenario pack for the FCC console (`/console.html?scenario=mati-2018`, the default scenario).
Built by `node scripts/fetch-data.mjs --scenario mati` (code in `scripts/fetch-mati.mjs`, timeline data in
`scripts/mati-timeline.mjs`). Sanity check: `node scripts/check-mati.mjs`.

Scenario built from public data; units, people and events are simulated. The pack contains no victim
identities, no addresses of victims and no casualty details beyond published aggregate figures with their
sources. People in danger in the console storyline are fictional.

## Grid and time

- Bbox lon 23.87 to 24.05, lat 37.98 to 38.10 (Penteli east slopes, Neos Voutzas, Mati, Kokkino Limanaki, Rafina).
- 790 x 666 cells of about 20 x 20 m, row 0 = north, little-endian (`raster.json`).
- Times are epoch ms (UTC). Display zone EEST (UTC+3), `manifest.tzOffsetMin = 180`.
- Replay window `manifest.start` to `manifest.end`: 23 Jul 2018 16:20 to 22:00 EEST.
- Suggested demo start `manifest.recommendedT0`: 16:38 EEST, 3 minutes before the 199 call.
- `manifest.activeEdgeMin = 15`, the active-edge window used by `fireFieldAt`. The run to the sea took about 2 h.

## Files and provenance

| File | Content | Provenance |
|---|---|---|
| `manifest.json` | Bbox, window, places, sources, calibration anchors, notes | Mixed (see fields) |
| `elevation.bin` | Int16 m | Real: AWS Terrain Tiles (Terrarium) z13, bilinear |
| `fuel.bin` | Uint8 FuelClass | Derived from real CORINE 2018 and OSM buildings (mapping below) |
| `clc2018.bin` | Uint16 CORINE Code_18 | Real: CLC2018 vector, rasterized |
| `arrival.bin` | Float32 ms since `manifest.start`, NaN = never burns | **Synthesized** model, constrained to the real EFFIS burnt area and calibrated to documented times |
| `perimeters.json` | `{fireId, perimeters, final}` | Entries with `synthesized: true` are contoured from `arrival.bin`; the last entry and `final` are the **real** EFFIS polygon (`source: "effis"`) |
| `hotspots.json` | `{mode: "firms", hotspots}` | Real NASA FIRMS archive detections (VIIRS S-NPP SP, MODIS SP); none fabricated |
| `weather.json` | Hourly wind, gust, temperature, RH | Real reanalysis: Open-Meteo ERA5 (smoother than the observed gusts; see facts) |
| `osm.json` | Roads, building centroids, water | Real: current OpenStreetMap (not a 2018 snapshot) |
| `checkpoints.json` | Documented fire milestones | Real, sourced (positions approximate) |
| `reports.json` | Timestamped log and report entries, short paraphrases | Real, sourced |
| `facts.json` | Area, toll, warnings, weather facts, each with its source | Real, sourced; conflicting figures listed side by side |
| `imagery.jpg` | Sentinel-2 cloudless 2018, 4096 px | Real (EOX, CC BY-NC-SA 4.0) |
| `gibs-*.jpg/png` | MODIS / VIIRS true colour and VIIRS thermal anomalies, 23 and 24 Jul | Real (NASA GIBS) |

### Fuel mapping (CORINE 2018 to FuelClass)

312 conifer -> TimberLitter (Aleppo pine); 311/313 -> TimberUnderstory; 321/333 -> Grass; 322/323/324/334 -> Shrub;
2xx -> Agriculture; 111/12x/13x -> Urban; 141/142 -> Grass; 331/332 -> Rock; 5xx and the sea mask -> Water.
CLC 112 (discontinuous urban fabric: Mati, Neos Voutzas, Kokkino Limanaki, Rafina) is a WUI mix. A cell with an
OSM building centroid in its 3 x 3 block becomes Urban; the remaining cells become TimberLitter, because the
houses stand under pine. The sea mask is elevation <= 0.5 m connected to the east edge, plus CORINE 523.

### Arrival model (synthesized)

1. Dijkstra travel time from the ignition over the 8-neighbour grid. Spread is allowed only inside the real
   EFFIS burnt-area polygon (feature 15060, 1,362 ha), so cells outside it never burn and the total is 1,362 ha.
2. The rate depends on fuel, slope (1 + 1.5 x slope, clamped 0.6 to 2.5), a fixed wind from 275 deg
   (anisotropy 1 + 2.0 cos, floor 0.15) and light deterministic noise.
3. Model time is mapped to clock time piecewise-linearly through these anchors (`manifest.calibration`):
   ignition 16:41; perimeter 400 m at 16:46; perimeter 3,500 m at 17:21; perimeter 6,000 m at 17:41
   (IAWF perimeter lengths); Neos Voutzas place point at 18:02; first Marathonos Ave crossing at 18:19;
   first coastal cell at 18:45.
4. After the coast anchor, the remaining flank cells burn at 1/1.8 of the last segment rate. The last cell
   burns at about 19:31.
5. Ember spotting, which the sources describe, is not modelled.

The ignition position (Daou Penteli, about 38.040 N 23.952 E) is approximate and was snapped into the EFFIS
polygon. Alternative documented ignition times are listed in `manifest.ignition.alternatives`: prosecutor
16:35, BAMS 1350/1355 UTC, Fire Service press release 16:57.

## Checkpoints (EEST)

| id | Time | Event | Position | +/- min | Source |
|---|---|---|---|---|---|
| `ignition` | 16:41 | Fire reported in Daou Penteli (199 call) | place `ignition` | 6 | IAWF; Kathimerini (prosecutor) |
| `first-house` | 16:46 | Perimeter about 400 m; first house burning | place `ignition` | 5 | IAWF; FIRElinks |
| `two-fingers` | 17:21 | Perimeter over 3,500 m; fingers heading SE and E | none | 10 | IAWF; thetoc |
| `nv-west-edge` | 17:41 | Perimeter at least 6,000 m, west edge of Neos Voutzas | 38.042, 23.975 | 10 | IAWF |
| `neos-voutzas` | 18:02 | Fire burns Neos Voutzas | place `neos-voutzas` | 10 | thetoc (prosecutor) |
| `marathonos` | 18:19 | Front crosses Marathonos Ave | place `marathonos-crossing` | 10 | FIRElinks (18:18); Kathimerini (about 18:20) |
| `analipsi` | 18:44 | Rafina junction at the Analipsi church | none (not in OSM) | 10 | thetoc |
| `coast-mati` | 18:45 | Fire reaches the coastline in Mati | place `mati-coast` | 15 | thetoc; IAWF (under 2 h); cretalive (about 19:00) |

"Fire at Agia Varvara, Rafina, 19:17" is kept as a report (`r-1917-agia-varvara`), not as a checkpoint,
because it is a log time rather than a first-arrival observation. The model burns that church at about
18:21.

## Sanity check (`node scripts/check-mati.mjs`)

```
checkpoint    documented  burned ha  perimeter m  model at point  err min
ignition      16:41            0         63       16:41               0
first-house   16:46            1        408       (perimeter checkpoint)
two-fingers   17:21           81       3518       (perimeter checkpoint)
nv-west-edge  17:41          248       6030       17:50               9
neos-voutzas  18:02          532       9517       18:03               1
marathonos    18:19          752      11118       18:18              -1
coast-mati    18:45         1216      14730       18:48               4
first coastal cell: 18:44 EEST at 38.0359 N, 23.9998 E (Kokkino Limanaki side)
total burned 1362 ha (EFFIS 1362 ha); last cell 19:31 EEST
```

The anchors were fitted on the same checkpoints, so this table checks consistency, not skill.

## Sources and licences

- EFFIS burnt areas (feature 15060): (c) European Union, EFFIS / JRC.
- CORINE Land Cover 2018: (c) European Union, Copernicus Land Monitoring Service, EEA.
- AWS Terrain Tiles (Mapzen Terrarium): see https://github.com/tilezen/joerd/blob/master/docs/attribution.md
- OpenStreetMap via Overpass API: ODbL 1.0, (c) OpenStreetMap contributors.
- Open-Meteo Historical Weather (ERA5): CC BY 4.0, contains modified Copernicus Climate Change Service information.
- NASA FIRMS (VIIRS S-NPP 375 m and MODIS standard processing) and NASA GIBS: NASA open data.
- Sentinel-2 cloudless 2018 by EOX IT Services GmbH: CC BY-NC-SA 4.0, non-commercial use.
- Timeline and facts: IAWF Wildfire Magazine; Xanthopoulos and Mitsopoulos (FIRElinks); Lagouvardos et al. 2019
  (BAMS, doi 10.1175/BAMS-D-18-0231.1); the prosecutor's report as covered by Kathimerini, thetoc.gr and
  cretalive.gr; The Guardian; Wikipedia; ekathimerini; Times of Israel (AP). URLs are in each record.

## Known limitations

- OSM is a current snapshot. Many houses were destroyed in 2018 and have since been rebuilt or demolished.
- ERA5 winds (15 to 37 km/h) are much weaker than the observed winds: Penteli 32 to 56 km/h with gusts of
  50 to 89 km/h, and Rafina gusts occasionally to about 120 km/h.
- FIRMS overpasses (20:40 UTC Terra, 00:05 UTC VIIRS, 00:53 UTC Aqua) come after the run, so they confirm
  the extent but not the timing.
- The EFFIS polygon is MODIS/Sentinel-mapped and can stop short of the shoreline by tens of metres.
