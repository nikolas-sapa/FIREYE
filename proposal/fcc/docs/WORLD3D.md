# World3D: procedural Mati world for the simulated monitoring feeds

World3D renders FIREYE's nonsatellite feeds and the six simulated feeds on `/console.html?mode=monitoring` (UAV-01/02/03, CAM-01 ridge PTZ, CAM-02 forest trail, CAM-03 roadside). It is a low-poly, deterministic stand-in world built from the local Mati pack. It is **simulated**: no object, plant, person or animal in it is observed. Legacy replay and the main globe do not use it.

Source: `src/console/world3d/`. Engine: three.js (approved dependency), loaded on demand when feeds mount. Monitoring's `?feeds=legacy` restores its previous Cesium renderer; a WebGL failure shows the labelled archive fallback. FIREYE uses `?feeds=cesium` or falls back to Cesium on failure.

## What it is built from

| Input | Used for |
|---|---|
| SRTM DEM (pack `elevation`) | Terrain heights, slopes, shore and water mask. 1× vertical scale. |
| CORINE 2018 land cover (`clc2018`) and pack fuel classes | Ground class, vegetation species mix and density (`COVER` table in `gen/tile.ts`). |
| EOX Sentinel-2 cloudless 2018 archive | Ground tint and canopy density modulation. Approximately 10 m; it cannot resolve individual plants. |
| OSM roads and building points (pack) | Road ribbons merged into terrain, building positions (shapes are generic). |
| Manifest ignition note | The 2009 burn scar around the ignition area has more snags and dry shrubs. |

Everything at sub-raster scale (individual trees, shrubs, grass clumps, yard props, garbage, canisters, vehicles, people, animals) is procedurally placed with seeded RNG, so the same tile is identical in every run and in the worker or Node.

## Architecture

```
world3d/
  types.ts           TileData, InstanceGroup, TruthClass (stable codes), Flag, DumpInfo
  catalog.ts         archetype geometry per LOD, truth class, material, base flammability, hazard
  env.ts             computeEnv(): sun/moon, season, curing, weather, fog, rain (pure)
  flammability.ts    rate(), rateSurface(): illustrative levels from archetype + env
  frame.ts           LocalFrame (lon/lat ↔ metres), HeightField (DEM, CLC, fuel, water)
  gen/source.ts      buildSource(pack, clc): transferable raster/roads/buildings subset
  gen/sites.ts       curatedSites(): one fictional analysis dump per default feed
  gen/buildings.ts   shared deterministic building shape, road alignment, tint and slope support
  gen/landscape.ts   continuous stands/clearings and world-anchored agricultural rows
  gen/tile.ts        generateTile() for 256 m tiles (near/far detail), generateFar() whole-area terrain
  gen/worker.ts      worker wrapper; transfers buffers
  agents/sim.ts      AgentSim: 10 Hz finite-state people and animals
  agents/render.ts   instanced agent meshes
  truth/capture.ts   decodeTruth(): ID pass → per-pixel classes, flammability, object list
  render/            WorldRenderer (shared WebGL context, atlas → feed canvases), TileStore (64-tile cache,
                     worker queue), WorldView (per-feed tile selection, LOD), materials, atmosphere, post
```

Pure modules (`env`, `flammability`, `frame`, `gen/*`, `agents/sim`, `truth/capture`, `catalog`) have no DOM or three.js dependency and run in Node tests.

### Coherent detail and bounded work

Selection stages replacement tiles without changing the displayed terrain, object references or background mask. A completed instance rebuild commits all three together. Displayed tiles are pinned; the store evicts only unpinned entries before adding a replacement, never exceeding 64 tiles. Fullscreen gets 32 cache slots, including near/far fallback costs. Wall views divide 60 slots; FIREYE additionally caps each at four.

Camera/detail hysteresis and quantized selection keys avoid redundant selection and buffer uploads. Stale queued work and late worker replies are dropped. Two worker requests, arrival backpressure, a four-millisecond upload slice (one tile is indivisible), and at most one instance rebuild per frame bound preparation. Invisible views release their batches. The wall renders up to eight feed groups per batch, rotating additional groups; batch FPS is not each feed's FPS.

Terrain uses approximately 5.33 m near and 8 m far spacing over the approximately 20 m source DEM, without changing elevations or vertical scale. Both levels and the shared background use the same imagery/palette mixture, avoiding tile-sized color changes. Fullscreen shadows use the four nearest eligible silhouette batches.

### Extending

- **New object**: add a definition to `DEFS` in `catalog.ts` (`id`, `label`, `cls`, `material`, `flam` 0–4, optional `hazard`, `kind`, `maxTier`, `build(lod)`). Place it from `gen/tile.ts`. Use an existing `TruthClass` or add a new code (additive only; never renumber).
- **New land-cover rule**: edit `COVER` in `gen/tile.ts` (keyed by CORINE code).
- **New dump type**: add to `DUMP_ITEMS` and the random weights in `gen/tile.ts`.
- **New agent species**: extend `Species`, `MAX_SLOPE`, `WALK`, `GAIT` in `agents/sim.ts` and add a catalog entry.
- Keep generation deterministic: derive every random value from `Rng` seeded by tile, cell or object ids, never `Math.random()` or time.

## Time, season and weather

The world follows the selected monitoring view:

| View | Clock | Weather |
|---|---|---|
| Current | Live Athens clock (saved snapshots use the fetch time) | MET Norway forecast and/or METAR when available |
| Mati 2018 | 23 July 2018, the view's selected time | ERA5 reanalysis (Open-Meteo) |
| Attica 2024 | 12 August 2024 | None integrated; seasonal defaults |

Missing values fall back to seasonal defaults and are listed in `WorldEnv.assumed`. Sun position uses `stage3d/sun.ts`, so feed lighting matches the stage. Seasonal grass curing and deciduous leaf curves are illustrative Attica norms, not measurements. `?world=debug` adds an override panel (hour, day of year, rain, cloud, wind) and a truth-capture button. Overrides are display-only.

FIREYE instead uses the exact simulation playhead (`advance: false`), including pauses, speed changes and backward seeks. Monitoring keeps its independent advancing/live clock. Reduced motion stops FIREYE feed-camera presentation motion, not changes explicitly made to the simulation playhead.

## Ground truth

`window.__fccWorld.captureTruth(feedId)` (available with `?world=stats` or `?world=debug`) renders one 480×270 ID pass for a feed and returns a `TruthCapture`:

- `classes`: `TruthClass` per pixel (row 0 = top).
- `flammability`: index into `none, low, moderate, high, extreme` per pixel, from archetype, curing, dryness and wetness.
- `objects`: id, archetype, label, class, material, flammability, hazard (`pressurized-gas`, `liquid-fuel`, …), pixel bbox, pixel count, distance and position.
- `classPixels`, `env`, `camera`, and a `note` stating that the labels describe generated stand-ins.

These labels are exact for the simulated scene only. They are suitable for exercising an analysis pipeline, not for validating real-world fuel or hazard detection.

## Content rules

- Trees and shrubs appear only where land cover allows them; no vegetation on roads, buildings or water (tests check this).
- Crowns, shrub clumps and grass coverage vary in spread and height independently. World-space stands, clearings, patchy understory and needle-litter tint connect the pine woodland across tiles. Distant Aleppo-pine silhouettes use irregular crown lobes instead of cylindrical crowns.
- Buildings retain source OSM positions. Detail and context share generic type, footprint, height, road-facing orientation, tint and phase. Simple foundations support sloping sites; roofs remain approximate silhouettes, not surveyed buildings.
- Olive/vine rows use world-anchored lattices restricted to supported land cover. Reeds require inland-marsh classes, rather than appearing along every sea shore. Surface noise adds restrained soil, litter, grass and rock variation and fades with distance.
- Outside detailed tiles, batched aggregate crowns and generic building masses preserve wooded and urban context. Crowns use two camera-facing triangles, not individual measured trees. Context stays inside the pack and is replaced by detailed tiles through the existing mask.
- Random garbage dumps are occasional (about 15% of tiles near Mati), mostly near tracks and roads. About a third contain pressurized or liquid-fuel canisters. Each default feed has one curated dump (12–40 items, 2–5 canisters) in front of it or under its orbit. Small canisters may be hidden by terrain, plants or the PTZ sweep at any moment.
- People and animals are fictional, simple and neutral. People go indoors at night and in rain. Agents stay on walkable ground and inside the pack.

## Budgets and measurements

Targets: fullscreen 30 fps, ≤150 draws, ≤1.5 M triangles; wall ≥20 fps, ≤400 k triangles per view; tile generation ≤40 ms off the main thread; no main-thread task >50 ms after warm-up; 64-tile cache. `?world=stats` shows fps, draws, triangles, tiles, generation times and long tasks.

### Pre-integration reliability/landscape pass

These receipts predate integration with current main's distinct EO/thermal channels. They describe the approved 14-channel source checkout, not the combined 20-channel branch. See `FRONTEND_HANDOFF.md` for fresh integration checks. Generated reports/screenshots below remain local and are not committed.

15 November 2026, this Apple Silicon laptop, headless Chrome, **production `dist`**, 1600×1000, local assets and providers disabled. Each fullscreen source settled before sampling. These are local observations, not hardware-independent guarantees.

| Case | Batch fps | Maximum fullscreen draws / triangles | Worst wall view triangles |
|---|---:|---:|---:|
| FIREYE 16:44, all 14 sources plus three-minute switching rehearsal | 30 | 144 / 937,212 | 287,352 initially |
| FIREYE 18:44, active-fire Mati camera | 30 | 134 / 751,365 | 338,600 |
| FIREYE 20:30, dusk Mati and available drone | 30 | 134 / 743,630 | 289,916 |
| FIREYE 14:00, imagery deliberately unavailable | 30 | 133 / 908,255 | 297,016 |
| Monitoring, six fullscreen sources and offline rendering | 30 | 131 / 756,534 | 361,394 |

- FIREYE produced 34 sample windows, including 18 repeated wall/fullscreen handoffs over three minutes. Its 95th-percentile renderer step cost was at most 2.9 ms. Actual per-feed rolling refresh was 27.5–30 fps including handoff gaps; gap p95 was 33.4 ms and the largest recorded gap was 283.3 ms. Monitoring feeds measured 30 fps, with a maximum recorded gap of 50 ms. The batch rate is not a substitute for these feed measurements.
- Fresh-page first World3D frames appeared in approximately 1.65–3.10 seconds across these cases; worker initialization took 462–1,095 ms. This includes local page/worker startup, not an empty browser disk cache or installation.
- The cache stayed at or below 64 tiles. FIREYE's sampled tile buffers peaked at 38.7 MiB, instance capacity at 5.3 MiB, shared background buffers at 62.3 MiB, and render-target estimates at 64.1 MiB. Monitoring truth capture increased the target estimate to 65.1 MiB. These separate counters are **not total GPU memory**: browser/compositor buffers, driver copies, source imagery, shared archetype geometry and other allocations are excluded. Peak sampled geometry/texture counts were 233/6 for FIREYE; the target sizes stayed fixed.
- Worker tile generation in these successful browser runs peaked at 24.8 ms. A separate earlier monitoring run reached 37.9 ms, still below 40 ms but with little scheduling headroom.
- Every sampled stationary window had zero renderer steps or browser long tasks over 50 ms and zero shader errors. **The stronger whole-transition hitch target is not met:** FIREYE's cumulative renderer long-task count rose from 1 at the initial wall to 9 across the rehearsal, outside those sample windows. Cold/transition preparation must not be described as hitch-free.
- EO/thermal changes, reduced motion, real tab hide/show, missing imagery, offline rendering, monitoring's fire exclusion, a 480×270 truth pass, and a forced WebGL-context-loss handoff to a rendered, labelled monitoring archive passed. Main Cesium globe behavior and the historical reconstruction were not changed by this pass.
- Scripted **pointer** seeks stalled browser automation, both a normal timeline click and the split mouse-down/up path, **also with `?feeds=cesium` and no World3D instance**. In that Cesium-only control, keyboard End/Home/End seeks passed, timeline hover passed, and a bare HTML pointer-capture control passed. Fresh entry points at target times render successfully. This narrows the failure to the application pointer path or its browser interaction, not all large seeks; its cause remains unestablished. Full end-to-end pointer-seek/speed acceptance remains open. Pure replay-clock tests do not replace that browser check.
- A later 65-second instrumented switching rehearsal recorded no renderer step above 40 ms, with the cumulative >50 ms renderer count unchanged at its initial cold-start value of 1. This did not reproduce, and does not resolve, the earlier intermittent transition hitches.

Fresh-process generator benchmark (`node scripts/bench-world3d.mjs`): context 13.1 ms; **first cold near tile 30.7 ms**, measured before background generation; warmed near median 8.7 ms, p90 12.1 ms, maximum 18.1 ms; far median 5.0 ms, maximum 7.9 ms. Whole-area terrain/context took 579.3 ms once: 30 terrain chunks (382,137 fine vertices), 32 context chunks (516,672 vertices). Node uses an explicitly synthetic imagery fixture; the browser checks use the actual local JPEG.

Raw reports: `experiments/world3d-browser-{1644,1844,2030,1400-palette,monitoring}.json`. The `1644` report was overwritten by the later instrumented run and now contains 23 windows and seven rehearsal handoffs, not the original 34-window/18-handoff, three-minute run reported above. Future instrumented runs use a `-profile` suffix. Screenshots include `world3d-after-feed-cctv-mati.png`, `world3d-after-feed-cctv-kokkino-limanaki.png`, `world3d-after-feed-uav-3.png`, and time-labelled active-fire/dusk/palette-only captures. `world3d-before-residential.png` and `world3d-before-drone.png` are earlier development references, **not matched production baselines**; camera/time/layout differ, so no percentage speedup or pixel-aligned visual comparison is claimed.

### Earlier density-pass references

The following predate this implementation (dev build, different profiles/settings). They are retained as historical reference, not validation of that earlier 14-channel profile:

- Monitoring fullscreen fps/draws/triangles: UAV-01 30/43/298 k, UAV-02 30/84/443 k, UAV-03 30/88/504 k, CAM-01 30/115/683 k, CAM-02 29.7/126/871 k, CAM-03 29.7/135/780 k.
- Monitoring wall, all six views at 2560 px: about 30 fps, 307 draws per batch, worst individual view 358,499 triangles, 60 tiles, 33.2 MB tile buffers.
- Before the reconnaissance simplification, FIREYE at approximately 16:02 local, all 13 nonsatellite feeds tested fullscreen: about 30 fps, maximum 143 draws and 1,033,844 triangles. Its former 13-feed wall at 1600 px: 30 fps, 320 draws per batch, worst individual view 363,224 triangles, 48 tiles and 42.9 MB tile buffers. These are historical density-pass measurements, not measurements of the current 14-source profile.
- Historical eight-feed recon profile, 1600×1000: fresh pre-fire wall sampled for six seconds after tile load, 25–30 fps, worst individual view 353,310 triangles, 25 tiles and 17.6 MB tile buffers; worker initialization 387.5 ms and maximum tile generation 15.6 ms. All eight feeds switched fullscreen at 16:44 local: about 30 fps, maximum 127 draws and 1,012,914 triangles. An earlier cold run with another browser still open had a 43.6 ms tile outlier. These are not combined-branch measurements; on-pad drones now render explicit offline states rather than World3D views.
- `maxTotalViewTris` measures the actual worst rendered view including background and shadow work; `trisPerView` is only a batch average. `maxViewTris` counts detailed tile/object geometry alone.
- The former uncapped FIREYE wall selection reached 409,514 triangles per view at new low-altitude recon poses. Its four-slot cap remains; the current fullscreen quota is 32 slots. Context preserves canopy rather than randomly deleting plants.
- Earlier generator benchmark: near median 12.0 ms, p90 16.1 ms, maximum 24.8 ms; far median 6.4 ms, maximum 14.7 ms; whole-area generation 330.5 ms with 435,264 context vertices. It did not measure the first cold near call separately.

## Validation

```bash
npm test
npm run test:monitoring   # includes pure generator and mocked-renderer regressions
node scripts/bench-world3d.mjs
npm run build
npm run test:pwa
WORLD3D_QA_SOAK_MS=180000 node scripts/check-world3d-browser.mjs
WORLD3D_QA_TIME=18:44 node scripts/check-world3d-browser.mjs
WORLD3D_QA_TIME=20:30 node scripts/check-world3d-browser.mjs
WORLD3D_QA_TIME=14:00 WORLD3D_QA_NO_IMAGERY=1 node scripts/check-world3d-browser.mjs
WORLD3D_QA_CASE=monitoring node scripts/check-world3d-browser.mjs
```

The browser script uses an isolated named `agent-browser` session and a finite localhost listener, attempting browser closure and closing the listener in `finally`, before optionally writing reports. `WORLD3D_QA_ARTIFACTS=1` opts into local screenshots/JSON under `experiments/`; default runs write no artifacts. An unresponsive browser required terminating only its owned daemon/process during pointer-stall diagnosis; the final local doctor check reported no active daemons. It serves `dist`, without installing the service worker during graphics timing; PWA behavior is checked separately. With artifacts enabled it preserves partial reports on failure. Optional `WORLD3D_QA_FOCUS=1 WORLD3D_QA_SEEKS=1` and `WORLD3D_QA_CONTROL=1` reproduce unresolved pointer-seek checks; they are not passing acceptance commands. Add `WORLD3D_QA_KEYS=1` or `WORLD3D_QA_HOVER=1` to the control for the passing keyboard or hover checks. `WORLD3D_QA_CASE=pointer-minimal` checks bare HTML pointer capture. These controls now have distinct report names.

`tests/world3d.ts` checks scale/hue variation, matching near/far colors and transforms, shared building descriptors, crop-row/stand continuity, palette consistency, labelled context, placement exclusions, bounds and replay clocks. `tests/world3d-render.ts` checks atomic tile/object/mask commits, pinned cache replacement, stale wishes/replies, renewed demand, worker failure, teardown and unchanged-buffer reuse without requiring WebGL.

## Limits

- Building shapes, roof types, yards, vehicles and all small objects are generic stand-ins at OSM positions or procedurally placed.
- Vegetation density is inferred from 100 m land cover and 10 m imagery; individual plants, understory and moisture are invented.
- Flammability levels are illustrative, not a fire-danger rating or fuel model.
- The world covers the Mati pack only, in every monitoring view.
- Monitoring mode disables reconstructed fire. FIREYE enables reconstructed flames, smoke and burn state at stage time; these are simulation effects, not observed incident footage.
