# World3D: procedural Mati world for the simulated monitoring feeds

World3D renders the six default simulated feeds on `/console.html?mode=monitoring` (UAV-01/02/03, CAM-01 ridge PTZ, CAM-02 forest trail, CAM-03 roadside). It is a low-poly, deterministic stand-in world built from the local Mati pack. It is **simulated**: no object, plant, person or animal in it is observed. Legacy replay, FIREYE and the main globe do not use it.

Source: `src/console/world3d/`. Engine: three.js (approved dependency), loaded on demand only when monitoring feeds mount. `?feeds=legacy` restores the previous Cesium feed renderer; a WebGL failure shows the labelled archive fallback.

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
  catalog.ts         70 archetypes: geometry per LOD, truth class, material, base flammability, hazard
  env.ts             computeEnv(): sun/moon, season, curing, weather, fog, rain (pure)
  flammability.ts    rate(), rateSurface(): illustrative levels from archetype + env
  frame.ts           LocalFrame (lon/lat ↔ metres), HeightField (DEM, CLC, fuel, water)
  gen/source.ts      buildSource(pack, clc): transferable raster/roads/buildings subset
  gen/sites.ts       curatedSites(): one fictional analysis dump per default feed
  gen/tile.ts        generateTile() for 256 m tiles (near/far detail), generateFar() whole-area terrain
  gen/worker.ts      worker wrapper; transfers buffers
  agents/sim.ts      AgentSim: 10 Hz finite-state people and animals
  agents/render.ts   instanced agent meshes
  truth/capture.ts   decodeTruth(): ID pass → per-pixel classes, flammability, object list
  render/            WorldRenderer (shared WebGL context, atlas → feed canvases), TileStore (64-tile cache,
                     worker queue), WorldView (per-feed tile selection, LOD), materials, atmosphere, post
```

Pure modules (`env`, `flammability`, `frame`, `gen/*`, `agents/sim`, `truth/capture`, `catalog`) have no DOM or three.js dependency and run in Node tests.

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

## Ground truth

`window.__fccWorld.captureTruth(feedId)` (available with `?world=stats` or `?world=debug`) renders one 480×270 ID pass for a feed and returns a `TruthCapture`:

- `classes`: `TruthClass` per pixel (row 0 = top).
- `flammability`: index into `none, low, moderate, high, extreme` per pixel, from archetype, curing, dryness and wetness.
- `objects`: id, archetype, label, class, material, flammability, hazard (`pressurized-gas`, `liquid-fuel`, …), pixel bbox, pixel count, distance and position.
- `classPixels`, `env`, `camera`, and a `note` stating that the labels describe generated stand-ins.

These labels are exact for the simulated scene only. They are suitable for exercising an analysis pipeline, not for validating real-world fuel or hazard detection.

## Content rules

- Trees and shrubs appear only where land cover allows them; no vegetation on roads, buildings or water (tests check this).
- Random garbage dumps are occasional (about 15% of tiles near Mati), mostly near tracks and roads. About a third contain pressurized or liquid-fuel canisters. Each default feed has one curated dump (12–40 items, 2–5 canisters) in front of it or under its orbit. Small canisters may be hidden by terrain, plants or the PTZ sweep at any moment.
- People and animals are fictional, simple and neutral. People go indoors at night and in rain. Agents stay on walkable ground and inside the pack.

## Budgets and measurements

Targets: fullscreen 30 fps, ≤150 draws, ≤1.5 M triangles; wall ≥20 fps, ≤400 k triangles per view; tile generation ≤40 ms off the main thread; no main-thread task >50 ms after warm-up; 64-tile cache. `?world=stats` shows fps, draws, triangles, tiles, generation times and long tasks.

Local measurements, 15 November 2026 (Apple Silicon laptop, Chrome, dev build). These are observations, not guarantees:

- Fullscreen fps/draws/triangles: UAV-01 30/47/268 k, UAV-02 30/78/511 k, UAV-03 30/75/516 k, CAM-01 30/105/786 k, CAM-02 30/129/1.11 M, CAM-03 30/146/810 k.
- Wall, six views at 2560 px: 30 fps, 427 draws, max 330 k triangles per view, 64 tiles, about 32 MB tile cache.
- Long tasks: only during initialization (about 60–90 ms within the first second); none observed after warm-up.
- Generator benchmark (`node scripts/bench-world3d.mjs`, Node, idle machine): near tiles median 11 ms, p90 17 ms, max 24 ms; far tiles median 6 ms; whole-area far terrain about 230 ms once at start in the worker. Results roughly double under heavy machine load.

## Validation

```bash
npm run test:monitoring   # includes tests/world3d.ts
node scripts/bench-world3d.mjs
```

`tests/world3d.ts` checks determinism across contexts, vegetation placement against roads/water/buildings/land cover, dump and canister rates, curated dumps, July vs November curing and grass flammability, sun elevation against `stage3d/sun.ts`, day/night/rain overrides, agent walkability after day/night/rain simulation, catalog truth classes and `decodeTruth` round-trips.

## Limits

- Building shapes, roof types, yards, vehicles and all small objects are generic stand-ins at OSM positions or procedurally placed.
- Vegetation density is inferred from 100 m land cover and 10 m imagery; individual plants, understory and moisture are invented.
- Flammability levels are illustrative, not a fire-danger rating or fuel model.
- The world covers the Mati pack only, in every monitoring view.
- No smoke, fire or burned areas are shown; monitoring mode disables reconstructed fire.
