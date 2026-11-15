# Caldor Fire (2021) scenario pack

Built by `node scripts/fetch-data.mjs` (Node 22+, no dependencies; downloads are cached in `$TMPDIR/fcc-caldor-cache`, pass `--fresh` to refetch). Loaded in the browser by `src/console/scenario/load.ts` (`loadScenario()`).

**Disclaimer shown in the console:** Scenario built from public data; units, people and events are simulated.

## Extent and grid

- BBox (lon/lat, WGS84): `[-120.70, 38.52, -120.24, 38.82]`. It covers the Middle Fork Cosumnes origin, Omo Ranch, Grizzly Flats, Sly Park / Jenkinson Lake, Pollock Pines and US-50, and the Aug 14-19 fire extent.
- The grid is equal-angle: 1000 x 833 cells, about 40 x 40 m each (`raster.json`). Row 0 is north and binaries are little-endian.
- Replay window (`manifest.start` / `end`): 2021-08-16 12:00 PDT to 2021-08-17 12:00 PDT. In the arrival raster Grizzly Flats burns from about 19:00 to 01:30 (median 20:00).
- Full data range (`manifest.dataStart` / `dataEnd`): ignition 2021-08-14 18:54 PDT to the last perimeter at 2021-08-19 01:30 PDT. Arrival values below 0 mean the cell burned before the replay start.

## Files

| File | Format | Content |
| --- | --- | --- |
| `manifest.json` | JSON | `ScenarioManifest` plus additive extras: `tzOffsetMin`, `ignition`, `dataStart`, `dataEnd`, `replayNote`, `imagery`, `imageryExtra`, `hotspotMode`, `notes`, `generatedAt`. Places may carry `fictional`, `osm` and `note`. |
| `raster.json` | JSON | `RasterMeta` plus `dxM`, `dyM`, `cellAcres` and file descriptions |
| `elevation.bin` | Int16 m | Terrain elevation |
| `fuel.bin` | Uint8 | `FuelClass` |
| `fbfm40.bin` | Uint8 | Raw LANDFIRE FBFM40 code (0 = no data) |
| `arrival.bin` | Float32 | Fire time of arrival in ms since `manifest.start` (NaN = never burns) |
| `perimeters.json` | JSON | `{ fireId, perimeters: [{t, acres, slot, polygon}], final }` |
| `hotspots.json` | JSON | `{ mode, hotspots: [{t, pos, frp, confidence, satellite}] }` |
| `weather.json` | JSON | `{ point, weather: [{t, windKph, windDirDeg, gustKph, tempC, rh}] }` (hourly) |
| `osm.json` | JSON | `{ roads, buildings, water }` |
| `imagery.jpg` | JPEG 4096x3409 | Pre-fire Sentinel-2 cloudless 2020 mosaic of the bbox (EPSG:4326, linear in lon/lat) |
| `gibs-viirs-truecolor-2021-08-1{6,7,8}.jpg` | JPEG 512 px | NASA GIBS VIIRS S-NPP true color for each day (shows the smoke plume) |
| `gibs-viirs-thermal-2021-08-1{6,7,8}.png` | PNG 1024 px | NASA GIBS VIIRS 375 m thermal anomalies for each day (transparent) |

## Sources (real data)

| Data | Source | URL | Licence / attribution |
| --- | --- | --- | --- |
| Fire perimeters, 12-hourly, Aug 15-19 | NASA FEDS (Fire Event Data Suite) VIIRS-derived perimeters, event F11645 | https://openveda.cloud/api/features/collections/public.eis_fire_lf_perimeter_archive | NASA open data. Cite Chen et al. 2022, *Scientific Data* 9:249 |
| Hotspot positions | NASA FEDS new active-fire pixels (VIIRS 375 m) | https://openveda.cloud/api/features/collections/public.eis_fire_lf_newfirepix_archive | NASA open data |
| Hotspots, when `FIRMS_MAP_KEY` is set | NASA FIRMS archive API (VIIRS S-NPP, NOAA-20, MODIS standard processing) | https://firms.modaps.eosdis.nasa.gov/api/area/ | NASA open data. Acknowledge LANCE/FIRMS |
| Ignition | IRWIN record via NRCS copy of the NIFC final perimeter: discovery 2021-08-15T01:54:24Z, 38.586 / -120.537833 | https://services.arcgis.com/SXbDpmb7xQkk44JV/arcgis/rest/services/fire_2021_caldor_perimeter/FeatureServer | Public (NIFC/IRWIN) |
| Final perimeter, reference only | CAL FIRE / NIFC "Wildfire Daily Fire Perimeter" (221,507 ac, 2021-09-16) | https://services2.arcgis.com/iq8zYa0SRsvIFFKz/arcgis/rest/services/Caldor_Fire_Progression_Polygons/FeatureServer | Public |
| Weather, hourly | Open-Meteo Historical Weather API (ERA5 / ERA5-Land reanalysis) at the bbox centre | https://archive-api.open-meteo.com/v1/archive | CC BY 4.0, Open-Meteo.com. Contains modified Copernicus Climate Change Service information |
| Elevation | AWS Terrain Tiles (Terrarium), zoom 12, bilinear resample | https://registry.opendata.aws/terrain-tiles/ | Mixed open sources (USGS 3DEP public domain in the US). See tilezen/joerd attribution |
| Fuel | LANDFIRE LF2016 Remap FBFM40 (Scott & Burgan 40), ImageServer `exportImage` (raw S16, nearest neighbour) | https://lfps.usgs.gov/arcgis/rest/services/Landfire_LF2016/LF2016_FBFM40_CONUS/ImageServer | Public domain (LANDFIRE, USGS/USFS/DOI) |
| Roads, buildings, water, places | OpenStreetMap via the Overpass API | https://overpass-api.de/api/interpreter | ODbL 1.0, (c) OpenStreetMap contributors |
| Base imagery | Sentinel-2 cloudless 2020 (EOX) WMS | https://s2maps.eu | CC BY-NC-SA 4.0: "Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2020)". Non-commercial; replace it for commercial use |
| Dated satellite overlays | NASA GIBS WMS (VIIRS S-NPP Corrected Reflectance True Color, Thermal Anomalies 375 m) | https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi | NASA open data. Acknowledge NASA EOSDIS GIBS |

Each source and its fetch timestamp is also recorded in `manifest.sources`.

## Derived or synthesized

- **Perimeter times.** FEDS stamps each 12-hour slot as `T00` (night overpass, about 01:30 local) or `T12` (day overpass, about 13:30 local). These are converted to 01:30 and 13:30 PDT on the same date. Acres are FEDS `farea` (km2) x 247.105. VIIRS-derived areas run higher than official IR-mapped acreage; FEDS shows 85k ac on Aug 19 01:30 PDT.
- **Arrival-time raster.** It is synthesized from the real perimeters. Perimeters are rasterized and kept monotone, so each perimeter is unioned with the previous one. A cell inside perimeter k but outside k-1 gets a time between the two overpasses. The time comes from f = T_from_prev / (T_from_prev + T_to_new_edge), where T is a Dijkstra travel time weighted by fuel rate (LANDFIRE class), slope (upslope faster) and wind alignment (Open-Meteo wind at mid-interval). f is then mapped through a diurnal activity warp (peak about 18:00 PDT, scaled by gusts), with light deterministic noise added. Before the first perimeter the fire grows from the IRWIN ignition point at discovery time. Burned acres in the raster match the FEDS acres at every perimeter time to within 0.5%.
- **Hotspots.** Positions and overpass slots are real VIIRS pixels from FEDS. Per-pixel FRP and confidence are synthesized from the slot mean FRP, and times are jittered by +/-3 min around the overpass. `satellite` reads `VIIRS 375 m (FEDS new fire pixels; FRP synthesized)`. With `FIRMS_MAP_KEY` set, the FIRMS archive is used instead and every field is real. If both sources fail, the script synthesizes hotspots along the arrival front at overpass times and labels them `VIIRS (synthesized)`.
- **Fuel.** FBFM40 codes map to `FuelClass` as follows: 91 Urban; 93 Agriculture; 98 Water; 92/99 Rock; GR 101-109 Grass; GS/SH 121-149 Shrub; TU 161-165 TimberUnderstory; TL/SB 181-204 TimberLitter. The pre-fire LF2016 vintage was chosen on purpose, because LF2022 and later already contain the burn scar. If LANDFIRE is unreachable, the script falls back to an elevation/aspect + OSM heuristic.
- **OSM.** This is a current snapshot, not the 2021 state, so structures lost in 2021 may be missing or rebuilt. Roads are simplified with Douglas-Peucker (8 m; tracks 15 m) and junction vertices are preserved so the road graph stays connected. Buildings are reduced to centroids.
- **Places.** Real places come from OSM, with GNIS fallbacks. Two places are **fictional** and are flagged `fictional: true`:
  - "Cosumnes Ridge Trailhead" (38.6115, -120.5075), reached by fire at about 18:50 PDT Aug 16.
  - "Bear Hollow Ranch" (38.642, -120.4885), reached at about 22:50 PDT Aug 16.

  They exist only for the simulated rescue and livestock storylines.
- **Everything else is simulated:** units, people, feeds, findings and actions. No real casualties are represented.
