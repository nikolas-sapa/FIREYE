# FCC Data Sources (REV D)

A researched catalog of data, services and models for FCC. Checked 2026-11-14. Terms change; re-check licenses before any commercial or operational use.

Status legend

- **DEMO** — used live by the REV C console when the key or token is present.
- **DEMO (cached)** — fetched once by `scripts/fetch-data.mjs` into `public/data/caldor/`; the console reads the cached files, no network at run time.
- **PLANNED** — part of the P1–P3 backend plan (`docs/BACKEND_CONTRACT.md` section 13).
- **OPTIONAL** — useful alternative or enrichment; not on the critical path.

"Key" means an account, API key or token is required. Licenses are summarized; the provider's terms govern.

The scenario packs and their exact provenance are documented in `public/data/mati/README.md` and `public/data/caldor/README.md`, with source records in each manifest.

## Mati 2018: observed data versus reconstruction

The default pack covers 23 July 2018, 16:20–22:00 EEST, at approximately 20 m resolution (790 × 666 cells). It includes Terrarium elevation, CORINE 2018 land cover, derived fuel classes, current OSM roads/buildings, ERA5 weather, the EFFIS final burned polygon (feature 15060, 1,362 ha), 28 real FIRMS detections, EOX 2018 imagery and dated NASA GIBS images.

The arrival raster and nine intermediate perimeters are **synthesized**, fitted to documented timing anchors and constrained to the final EFFIS polygon. They are not independently observed intermediate fronts. FIRMS passes at 20:40 UTC on 23 July and 00:05/00:53 UTC on 24 July occurred after the principal afternoon run; they cannot validate its minute-by-minute progression.

Checkpoint records retain source links and timing uncertainty. Public reports are short attributed paraphrases. Source-specific fatality totals are preserved rather than silently reconciled; simulated people never represent actual victims. Current OSM and imagery mosaics must not be presented as exact incident-date street or camera footage.

Reconstruction agreement with the fitted area/checkpoints is a consistency test only. A projection comparison against this raster measures agreement with a reconstruction. Checks against documented arrivals or the independently sourced final perimeter must be identified separately, with any shared initialization or calibration disclosed.

EOX imagery is CC BY-NC-SA and needs replacement or suitable permission for commercial use. Consult the pack README for attribution and the terms of every underlying source.

---

## 1. Satellite and fire detection

| Source | What | Status | Key | License / terms | Notes |
|---|---|---|---|---|---|
| NASA FIRMS | MODIS and VIIRS (S-NPP, NOAA-20, NOAA-21) active-fire hotspots; area and country APIs; archive back to 2000 | PLANNED (P1 live); used by `fetch-data.mjs` only when `FIRMS_MAP_KEY` is set | Free MAP_KEY | NASA open data, attribution requested | Rate limit about 5,000 transactions per 10 min per key. Without a key the pack uses NASA FEDS fire pixels (next row). |
| NASA FEDS (Fire Event Data Suite) via VEDA `openveda.cloud` | 12-hourly VIIRS-derived fire perimeters and new active-fire pixels per fire event | DEMO (cached) | None | NASA open data; cite Chen et al. 2022, Sci. Data 9:249 | Caldor event F11645: the pack's `perimeters` (timed to the 01:30 / 13:30 PDT overpasses) and `hotspots` (real pixel positions and slot times; FRP and confidence synthesized). VIIRS areas run higher than official IR-mapped acreage. |
| NASA GIBS | Daily global imagery via WMTS/WMS by date: MODIS/VIIRS true color, fire layers, corrected reflectance | DEMO (cached) | None | NASA open data; acknowledge NASA EOSDIS GIBS | Dated VIIRS S-NPP true color and 375 m thermal anomaly snapshots for Aug 16–18 2021 (smoke plume, hot pixels); no key needed even live. |
| GOES-18 / GOES-19 on AWS | ABI full-disk and CONUS imagery every 5–10 min, Fire/Hot Spot Characterization (FDC) product | PLANNED | None (AWS Open Data, `noaa-goes18`, `noaa-goes19` buckets) | Public domain (NOAA) | Near-real-time fire growth between polar passes; 2 km pixels. During Caldor (2021) GOES-17 was the west satellite. |
| Sentinel-2 L2A via Earth Search (Element 84) | 10–20 m multispectral, STAC API, COGs on AWS | PLANNED | None | Copernicus open license, attribution | Burn scar (dNBR), fuel moisture proxies; revisit about 5 days. |
| Microsoft Planetary Computer | Same Sentinel-2/Landsat collections with STAC + signed URLs | OPTIONAL | None for STAC, token auto-signed | Per collection | Alternative to Earth Search. |
| NAIP | 0.6–1 m US aerial imagery (USDA), on AWS and Planetary Computer | OPTIONAL | None | Public domain | Pre-fire detail for structures and fuels. |
| EOX Sentinel-2 cloudless | Cloud-free global mosaic tiles (WMS) | DEMO (cached) | None | **CC BY-NC-SA 4.0** for the 2018+ mosaics (non-commercial) | The pack's `imagery.jpg`: 2020 pre-fire composite, about 10 m/px. Must be replaced (NAIP, Sentinel-2 L2A, or licensed imagery) for any commercial deployment. |
| Esri World Imagery | Global high-res basemap | OPTIONAL | Esri account / ArcGIS terms | Esri terms of use; attribution required; restrictions on caching and offline use | Only within Esri's terms. |
| Prithvi (NASA/IBM) burn-scar models | Geospatial foundation model fine-tuned for burn scars on HLS imagery (Hugging Face) | PLANNED | None | Apache-2.0 (model) | Run in boxd sandboxes in P2. |
| Google Earth Engine | Planetary analysis catalog (FIRMS, Sentinel, Landsat, MTBS) | OPTIONAL | Account | Free for noncommercial and research; commercial requires a paid plan | Useful for building packs and evaluation sets. |

## 2. Weather

| Source | What | Status | Key | License / terms | Notes |
|---|---|---|---|---|---|
| Open-Meteo | Forecast and historical (archive, ERA5 reanalysis) hourly weather: wind, gusts, temperature, RH | DEMO (cached) | None | Free for non-commercial use: 10,000 calls/day, 5,000/hour, 600/min; data CC BY 4.0; commercial needs a paid plan | Caldor hourly weather Aug 14–19 2021 → `weather.json`. Reanalysis winds are smoother than observed ridge-top gusts. |
| NWS api.weather.gov | Forecasts, gridpoints, observations, alerts (Red Flag Warnings) | PLANNED | None, but a descriptive `User-Agent` with contact is required | US Government, public domain | Live alerts and station observations in P1. |
| HRRR and HRRR-Smoke on AWS | 3 km hourly-updated model with near-surface smoke | PLANNED | None (AWS Open Data `noaa-hrrr-bdp-pds`) | Public domain | Wind fields for the projection ensemble; smoke for air ops. |
| Synoptic Data (RAWS) | Mesonet and RAWS station observations | OPTIONAL | Key | Free trial / open-access tiers only; production use is paid | RAWS are the fire-weather ground truth. |
| Windy Webcams API | Public webcam directory with images and timelapse | OPTIONAL | Key | Free tier with limits; image URLs are tokenized and expire after about 10 min on the free tier | Ridge-cam style views when agency cams are unavailable. |

## 3. 3D globe, terrain and rendering

| Source | What | Status | Key | License / terms | Notes |
|---|---|---|---|---|---|
| CesiumJS | WebGL globe engine (npm `cesium`) | DEMO | None | Apache-2.0 | The REV C stage. |
| Cesium ion Community | World Terrain, Bing/Google imagery assets, tiling | DEMO (with `VITE_CESIUM_ION_TOKEN`) | Token | Free for non-commercial / personal use; about 15 GB/month streaming and 1,000 Google or Bing imagery sessions/month on Community; commercial needs a paid plan | Without a token the stage uses the pack heightmap and cached imagery. |
| Google Photorealistic 3D Tiles | Photogrammetry mesh of cities and terrain (Map Tiles API) | DEMO (with `VITE_GOOGLE_MAPS_KEY`) | Google Cloud key with Map Tiles API, billing account required | Google Maps Platform terms; on-screen attribution (logo and data credits) required; sessions last about 3 h; about 10,000 root tileset requests/day by default; the old $200 monthly credit ended in Feb 2025 and was replaced by per-SKU free usage caps | Optional photoreal layer; may also stream through Cesium ion. No caching beyond the terms. |
| 3DTilesRendererJS (NASA-AMMOS) | three.js renderer for 3D Tiles including Google tiles | OPTIONAL | None | Apache-2.0 | Alternative to Cesium. |
| deck.gl | GPU data-viz layers (Tile3DLayer, terrain) | OPTIONAL | None | MIT | Alternative for 2.5D views. |
| AWS Terrain Tiles (Mapzen Terrarium encoding) | Global DEM tiles (`elevation-tiles-prod`) | DEMO (cached) | None | Mixed open sources, attribution per tilezen/joerd | Zoom 12 tiles resampled to the pack `elevation` grid; this is also the no-token terrain for the Cesium stage. |
| MapLibre GL JS | Open vector map renderer | OPTIONAL | None | BSD-3 | Lightweight 2D/2.5D fallback. |

## 4. Terrain, fuels and features

| Source | What | Status | Key | License / terms | Notes |
|---|---|---|---|---|---|
| LANDFIRE FBFM40 | 30 m Scott & Burgan 40 fire behavior fuel models (ImageServer export) | DEMO (cached) | None | US Government, public domain | LF2016 Remap on purpose: LF2022 and later already contain the Caldor burn scar. Mapped to `FuelClass` (`fuel.bin`); raw codes kept in `fbfm40.bin`. |
| USGS 3DEP | 1/3 arc-second (about 10 m) and 1 m elevation | DEMO (cached, via Terrarium tiles) | None | Public domain | The source of the US part of the AWS Terrarium tiles below. Direct 3DEP is PLANNED for higher resolution. |
| OpenStreetMap via Overpass API | Roads, buildings, water, places | DEMO (cached) | None (public Overpass instances are rate-limited; be polite) | ODbL 1.0, attribution "© OpenStreetMap contributors" | Pack `osm.json` and `places`. A current snapshot, not 2021: some buildings lost in 2021 may be missing or rebuilt. |
| Overture Maps | Buildings, places, transportation (GeoParquet) | OPTIONAL | None | Per theme: ODbL / CDLA-Permissive-2.0 | Richer places and building attributes. |
| Microsoft Building Footprints | ML-derived US building polygons | OPTIONAL | None | ODbL | Fills OSM gaps in rural areas. |

## 5. Fire perimeters and incidents

| Source | What | Status | Key | License / terms | Notes |
|---|---|---|---|---|---|
| NIFC WFIGS / CAL FIRE progression (ArcGIS) | Interagency incident locations, current and historic perimeters, Caldor progression polygons | DEMO (cached, reference) | None | Public (US Government / CAL FIRE open data) | Final Caldor perimeter (218,857 acres) kept as a reference; outside the replay window. Live WFIGS polling is PLANNED. |
| CAL FIRE incidents | JSON/GeoJSON list of CAL FIRE incidents | PLANNED | None | Public | Incident discovery in California. |
| Watch Duty | Community wildfire alerts app | NOT USED | No public API | Terms prohibit using it to power alerting | Mentioned only to be explicit: not a data source. |

## 6. Fire spread models

| Model | What | Status | License | Notes |
|---|---|---|---|---|
| Demo cellular model | Projection from the pack `arrival` raster plus wind and slope perturbation | DEMO | Project code | Fast, deterministic, good enough for the replay. |
| ELMFIRE | Eulerian level-set fire model with ensembles | PLANNED (P2) | Eclipse Public License 2.0 | Linux, Fortran; runs in boxd. |
| ForeFire | Front-tracking simulator (CNRS, Corsica) | OPTIONAL | GPL-3.0 | Coupled atmosphere option. |
| Cell2Fire | Cell-based spread simulator | OPTIONAL | Check repo; research-use terms | Good for ensembles. |
| pyretechnics | Python Rothermel/Albini fire behavior library (Spatial Informatics Group) | OPTIONAL | EPL-2.0 | Fire behavior per cell for drivers text. |
| FlamMap / FARSITE | USFS fire behavior suite | OPTIONAL | Free, Windows only | Reference outputs for validation. |

## 7. Footage, detection and evaluation

| Source | What | Status | License | Notes |
|---|---|---|---|---|
| FLAME, FLAME 2, FLAME 3 | Drone RGB/thermal wildfire datasets (IEEE DataPort) | PLANNED (eval) | Check per dataset (research) | Detection benchmarks for `pool-video`. |
| HPWREN FIgLib | Fire Ignition image library from HPWREN ridge cameras | PLANNED (eval) | Research use, attribution | Smoke onset sequences for ridge-cam analysis. |
| D-Fire | 21k+ images with fire and smoke boxes | PLANNED (eval) | Check repo license | YOLO-format labels. |
| ALERTCalifornia (UC San Diego) | Live ridge-top cameras across California | OPTIONAL | Check terms before use; agency partnership likely needed | The real-world version of FCC ridge cams. |
| Florence-2 (Microsoft) | Vision foundation model: captioning, detection, grounding | PLANNED | MIT | Available on fal and Hugging Face. |
| Grounding DINO / Grounded-SAM-2 | Open-vocabulary detection plus segmentation ("person", "propane tank") | PLANNED | Apache-2.0 | Class prompts per finding kind. |
| YOLO-World | Real-time open-vocabulary detection | OPTIONAL | GPL-3.0 (Ultralytics) | License may not fit a closed product. |
| fal vision and video-understanding | Hosted vision LLMs and `fal-ai/video-understanding` | PLANNED (P2) | fal terms; per-model licenses | The demo simulates their outputs. |
| fal video generation models | Synthetic social-style clips for demos and tests | OPTIONAL | fal terms; per-model licenses | Label synthetic clips clearly; never present as real footage. |

## 8. News, social and radio

| Source | What | Status | Key | License / terms | Notes |
|---|---|---|---|---|---|
| Firecrawl | Search + scrape to markdown | PLANNED (P1) | Key | Firecrawl terms; respect site terms and robots | `pool-web` input. The demo simulates articles. |
| GDELT DOC 2.0 API | Global news search with geography and tone | PLANNED | None | Open, attribution | Article discovery by incident keywords. |
| Bluesky Jetstream | Public firehose as JSON over WebSocket | PLANNED | None | Bluesky terms; public posts | Keyword and geo filters for `pool-social`. |
| Broadcastify + Whisper | Scanner audio streams, transcribed by Whisper | OPTIONAL | Broadcastify account / API | Broadcastify terms restrict redistribution and automated use; check before use. Whisper is MIT | Prefer direct agency audio feeds in P3. |

## 9. Aircraft

| Source | What | Status | Key | License / terms | Notes |
|---|---|---|---|---|---|
| OpenSky Network | ADS-B state vectors | OPTIONAL | OAuth2 client credentials for accounts; anonymous access limited to about 400 API credits/day | Non-commercial research terms | Tankers and helicopters over the incident. |
| ADSB.lol | Community ADS-B aggregator API | OPTIONAL | None | ODbL data | Unfiltered feed including many aerial firefighting aircraft. |

## 10. Life (people and animals)

| Source | What | Status | Key | License / terms | Notes |
|---|---|---|---|---|---|
| WorldPop | 100 m population grids | PLANNED | None | CC BY 4.0 | Exposure estimates for evac zones. |
| iNaturalist | Species observations | OPTIONAL | None for read API | Per-observation CC licenses | Wildlife likely present (animal findings). |
| GBIF | Global biodiversity occurrence data | OPTIONAL | None | Per-dataset CC0 / CC BY / CC BY-NC | Same purpose as iNaturalist. |

## 11. What the REV C demo actually uses

At run time the console makes **no required network calls**. It loads the cached pack from `/data/caldor/` (about 11 MB) and, only if tokens are present in `.env.local`, streams Cesium ion terrain and imagery and Google Photorealistic 3D Tiles.

Replay window: 2021-08-16 12:00 PDT → 2021-08-17 12:00 PDT (the run into Grizzly Flats). Scenario box: 120.70°W–120.24°W, 38.52°N–38.82°N.

| Pack file | Source | Notes |
|---|---|---|
| `manifest.json` | All of the below (`sources[]` with URL, license, fetch time and notes) | Places from OSM plus two fictional ones for the story ("Cosumnes Ridge Trailhead", "Bear Hollow Ranch"). |
| `raster.json`, `elevation.bin` | AWS Terrarium tiles (USGS 3DEP in the US), zoom 12 | 1000 × 833 grid. |
| `fuel.bin`, `fbfm40.bin` | LANDFIRE LF2016 FBFM40 | Pre-fire vintage. |
| `arrival.bin` | Derived from NASA FEDS perimeters and the ignition point | Fire time of arrival per cell. |
| `perimeters.json` | NASA FEDS 12-hourly VIIRS perimeters (event F11645) | |
| `hotspots.json` | NASA FEDS new fire pixels (VIIRS 375 m) | FRP and confidence synthesized; FIRMS used instead when `FIRMS_MAP_KEY` is set. |
| `weather.json` | Open-Meteo archive (ERA5) | Hourly. |
| `osm.json` | OpenStreetMap via Overpass | Roads simplified, buildings as centroids. |
| `imagery.jpg` | EOX Sentinel-2 cloudless 2020 | CC BY-NC-SA 4.0, non-commercial. |
| `gibs-viirs-*.jpg/png` | NASA GIBS VIIRS true color and thermal anomalies, Aug 16–18 2021 | Dated context imagery. |

The pack is built by `node scripts/fetch-data.mjs`. See `public/data/caldor/README.md` for details and fallbacks.

Simulated in the demo (no external source): units and their telemetry, people and animals in danger (fictional; all are rescued), drone, dash-cam, helmet-cam and ridge-cam video (rendered by the 3D stage from camera poses), news articles, social posts, radio traffic, agent jobs and timings, and all drafted documents.

Scenario built from public data; units, people and events are simulated.
