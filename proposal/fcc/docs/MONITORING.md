# Real-data presentation console

`/console.html?mode=monitoring` is an informational, single-machine monitoring prototype. Its camera demos are explicitly simulated. It does not start the legacy incident runtime, generate a fire front, or invent responder counts, rescues, detections, forecasts, agent work or evacuation instructions.

## Run the presentation

```bash
npm run dev
# Or production:
npm run build
npm run preview -- --host localhost
```

Use the local Vite dev or preview server, not a static file server, for current data. The provider middleware rejects non-loopback clients, foreign origins and non-GET methods. No public deployment/authentication system is included.

Plain `/console.html` now opens FIREYE (see `FIREYE.md`). Add `mode=monitoring` to every monitoring link.

| URL suffix on `/console.html` | View |
|---|---|
| `?mode=monitoring` | Current Attica, with optional Greece-region bounding-box overview |
| `?mode=monitoring&view=mati` | Mati, 23 July 2018 |
| `?mode=monitoring&view=attica2024` | Attica / Varnavas, August 2024 |
| `?mode=monitoring&saved=1` | Saved real-data presentation mode |
| `?mode=monitoring&view=attica2024&saved=1&tokens=0&context=0` | Bounded local-only historical presentation |
| `?mode=replay` | Original simulated Mati replay |
| `?scenario=caldor-2021` | Original simulated Caldor replay |

Existing `?scenario=` and `?beat=` links keep the legacy replay. Frozen revisions and the separate opt-in image lab are unchanged.

## Optional configuration

Add these **server-only** settings to the existing gitignored `.env.local`, then restart Vite. Never paste keys into source or prefix them with `VITE_`.

```dotenv
FIRMS_MAP_KEY=your_free_nasa_key
WINDY_API_KEY=your_webcams_api_key
FCC_APP_CONTACT=https://your-public-project-or-contact-page.example
```

- [FIRMS key](https://firms.modaps.eosdis.nasa.gov/api/map_key/): NOAA-20/21 last-day area queries. Without it, the adapter filters the official public global CSV downloads. No paid API.
- [Windy **Webcams** key](https://api.windy.com/keys): additional nearby camera discovery, not the forecast-map API. Curated provider links need no key.
- `FCC_APP_CONTACT`: your actual public project URL or application contact address for MET Norway identification. Forecast retrieval stays disabled without it. No account/key needed.
- Existing public Cesium/Google map credentials remain optional. `?tokens=0` disables these providers; add `&context=1` to explicitly permit current OSM/CARTO cartography. `&context=0` disables streamed context too.

No fal/Gemini/LLM credentials or paid inference calls are used by monitoring.

## Sources and limits

| Source | Meaning |
|---|---|
| NASA FIRMS NOAA-20/21 | Nominal 375 m thermal anomalies, acquisition UTC, confidence and FRP in MW. Not confirmed incidents or exact ignition points. Greece-region rectangular extent includes neighboring border areas. Cloud and overpass gaps matter. |
| MET Norway Locationforecast | Point forecast near Mati, approximately 9 km global model. Model-update, valid and retrieval times remain separate. CC BY 4.0. Not measured fire-site wind. |
| NOAA Aviation Weather METAR | LGAV/LGTG/LGEL airport observations when returned, timestamp, raw METAR and station distance. Knots converted to km/h. Missing gust/humidity/variable direction remain unknown. Airport conditions are not forest conditions. |
| NASA GIBS | Date-selectable, coarse true-color satellite overview. Clouds, smoke and missing swaths can obscure the ground. The date is not a continuous observation time. Historical SNPP and current NOAA-20 products are kept separate. NASA Earthdata attribution stays visible. |
| EOX Sentinel-2 cloudless | Sharp historical basemap: local 4096×3454 Mati 2018 archive, or bundled 3840×4035 Attica 2020 archive. Approximately 10 m source resolution (Attica output approximately 14 m). CC BY-NC-SA 4.0, non-commercial. Not current or incident-date imagery. |
| EFFIS / GWIS | ECMWF Fire Weather Index forecast danger and source legend. Not a detection, incident boundary or observed fire front. Available only in Current view. |
| Mati local pack | SRTM terrain, CLC2018 land cover, current-context OSM, sourced reports, later archive detections, ERA5 reanalysis and the final EFFIS polygon. Reconstructed arrivals/intermediate boundaries are excluded. Original pack is not rewritten. |
| Copernicus EMSR746 | Published **initial DEL** burned-area GeoJSON, 46 features. Sentinel-2 acquisition 12 August 2024 09:05 UTC; publication 19:01 UTC; initial mapped area **8,594.2 ha**. Later monitoring products report different areas. This is not the activation AOI. © 2024 European Union / Copernicus EMS. |

The globe's detailed local terrain remains limited to the Mati pack. The 2024 case and wider Greece view use contextual geography outside it, not fabricated detailed terrain. Raster overlays retain their colors independently of Outline styling. **Sharp archive · Sentinel-2** is the default image product; its fullscreen viewer supports 1–4× zoom, drag-to-pan and Fit. **Daily overview · NASA** preserves the date-selectable observational product. Changing image product never changes the observation dates or incident data.

Six simulated 3D feeds show three UAV views, a ridge PTZ, a fixed trail camera and a fixed roadside camera. By default they render **World3D** (`src/console/world3d/`, three.js loaded on demand): a deterministic low-poly world built from the local SRTM terrain, CORINE 2018 land cover, dated EOX 2018 imagery and OSM roads/building positions, with procedurally placed trees, shrubs, grass, yard props, occasional garbage dumps (some with gas canisters), vehicles and simple fictional people and animals. Time, season and weather follow the selected view. `?world=stats` shows performance; `?world=debug` adds display-only time/weather overrides and a simulated ground-truth capture. `?feeds=legacy` restores the earlier Cesium feed renderer. See `docs/WORLD3D.md`. Placements, flight paths, objects, daylight and telemetry are simulated, not real camera locations, recorded footage, thermal measurements, detections or fuel measurements. **All six remain in the Mati sector in every case**, including Current and Attica 2024. They do not claim detailed terrain coverage elsewhere.

Open any tile for a 960×540 player with Play/Pause and Previous/Next. Thumbnails are 384×216. WebGL enables the 3D views; preparing/unavailable 3D shows an explicitly labeled static archive fallback instead of a blank surface. No camera permissions, provider keys or external tiles are required. Reduced motion starts with a static frame; explicit Play opts into motion. The existing legacy view is not changed by this integration.

### Feed smoothness

The legacy scheduler intentionally refreshed thumbnails roughly every two seconds, including a second warm-up render, and its lens filter could reset after those long gaps. Reading streamed terrain heights could also change ground-camera mounting height during refinement.

Monitoring uses a separate renderer, not patches to the legacy renderer (World3D budgets and measurements are in `docs/WORLD3D.md`):

- Phase-locked frame deadlines, independent continuous camera clocks and per-feed gimbal filters. No replay/store-tick stepping or catch-up bursts.
- Stable native-DEM camera heights. Trail/road mounts do not inherit handheld shake, engine bob or animated sensor noise. The ridge PTZ follows a continuous bounded survey.
- One shared sensor WebGL context. Only visible tiles render; fullscreen pauses the covered wall and globe. Hidden tabs freeze simulation time.
- A 30 fps fullscreen target and load-adaptive wall cadence with hysteresis, rather than changing rates on every render. Hardware load can reduce the wall to 20 or 15 fps; these are targets, not guarantees.
- The static monitoring globe renders on demand instead of repainting continuously. Camera moves, source updates, imagery loads and appearance changes request new frames.
- Legacy procedural canopy/grain calculation runs in one worker. Tests compare its output pixel-for-pixel with the original generator. It remains decorative simulated detail, not measured vegetation. The worker queue is capped at 32 jobs; a 32-tile canvas cache holds approximately 8 MiB of pixel data. Raw archive imagery remains usable if the worker is unavailable.

Source failures show errors or visibly marked last-known/bundled data. Empty observations are a valid result, never an all-clear. Requests are aborted on view changes; late responses are ignored. Current sources refresh every ten minutes, with manual refresh subject to server caching. FIRMS requests cover two UTC dates and then filter a rolling 24-hour window, avoiding false-empty results immediately after midnight. The Current view's **Daily overview** initially shows the previous completed UTC day, explicitly dated; choose a different day as needed.

## Cameras and recording

Seven curated source cards cover Rafina, Nea Makri, Schinias, Marathon, Penteli and wider Athens. Four have verified or explicitly approximate map points; cameras without verified coordinates remain link-only. Windy adds nearby, deduplicated source cards and locations when configured.

Links are the dependable deliverable. No stream extraction, rehosting, video download, archive reconstruction or recording is implemented. Current camera operation and capture time are not guaranteed. All current cameras are marked as distinct from 2018 footage. Two Kathimerini historical CCTV reports are links only, not copied clips.

**Recording-safe is on by default.** It hides all uncleared third-party camera media, not our explicitly simulated 3D cameras and archive fallbacks. Disabling it permits a selected supported Windy preview only, with provider attribution. This does not grant recording, public-display, reuse or inference rights. Obtain permission before using third-party footage in a recorded presentation. No historical camera footage has been cleared. Simulated views retain EOX archive attribution and non-commercial/share-alike terms.

## Saved data and storage

**Save real data** stores successfully retrieved source JSON locally, never webcam media, tokenized camera URLs or credentials. **Saved-data mode** makes no monitoring API requests. It uses local snapshots or the bundled, explicitly dated real FIRMS/METAR/2024 fixtures. MET forecasts need a prior successful local save. Current imagery and external camera players are not available offline.

- Local optional snapshots: at most **4 MiB** total, checked as UTF-16 storage size; may fail earlier if the browser's origin quota is used elsewhere.
- Server response cache: at most **40 MiB**, ten-minute TTL (one hour for historical mapping; MET Norway follows its expiry/cache headers, capped at one hour); at most eight in-flight provider operations, each with a 25-second timeout and 20 MiB response bound.
- No server caching of webcam tokens or configuration. Provider/API traffic is excluded from the PWA cache.
- Bundled historical/small presentation files are regular permitted local assets; optional runtime snapshots are separate from the versioned PWA app cache. New bundled assets, including the sharp archive, total under 5 MiB.

Refresh the small public fixtures explicitly with:

```bash
node scripts/save-monitoring.mjs
# Separately refresh the fixed, non-commercial sharp historical basemap:
node scripts/save-monitoring-detail.mjs
```

This uses only fixed official public endpoints, no credentials, paid requests or webcam media. It never rebuilds/overwrites Mati or downloads video. Every snapshot preserves retrieval/acquisition dates. A failed source returns a nonzero exit status.

## Validation

```bash
npm run build
npm test
npm run test:monitoring
npm run test:pwa
npm run test:image-lab
```

Monitoring tests exercise parsing, UTC and unit conversion, real fixtures, sanitized terrain packs, missing keys, loopback/origin checks, secret-safe errors, response bounds, caching/deduplication, stale/saved fallback, local-storage limits and late-response cancellation. World3D tests (`tests/world3d.ts`) cover generator determinism, vegetation placement, dump/canister rates, seasons, sun, agents and ground truth. Feed tests cover display-rate aliasing, stable adaptive cadence, paused/background clocks, six bounded paths, fixed mount stability and exact legacy/worker detail equivalence. Browser smoke checks should cover all three views, saved mode, all six camera players, pause/resume, reduced motion, visibility, WebGL fallback, recording-safe camera links, light/dark themes, rapid switches and both legacy scenarios.

Final production-browser receipt, 15 November 2026: 6.5-second samples measured approximately 30 fps for four scheduled tiles at 1536 px (95th-percentile gap 52 ms, worst 100 ms), 30 fps fullscreen (95th-percentile gap 38 ms, worst 68 ms), and 30 fps with all six visible at 2880 px (worst 95th-percentile gap 41 ms, worst gap 62 ms). All six terrain frames were ready by approximately 2.2 seconds. Earlier cold runs ranged from 28–30 fps with occasional gaps up to 184 ms. The separate legacy baseline reproduced thumbnail gaps of 2.53 seconds with its 14 surfaces. These are local observations, not frame-rate guarantees or equal-workload speedup claims.

Not integrated: CAMS, AI analysis, automated evacuations/road closures, fire spread predictions, historical weather for the 2024 case or a guaranteed live camera wall. Follow official Greek Civil Protection and 112 instructions.
