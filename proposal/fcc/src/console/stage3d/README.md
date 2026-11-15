# stage3d — CesiumJS stage and simulated camera feeds

Owner: STAGE worker. Public API (`src/console/stage3d/index.ts`):

| Export | Purpose |
| --- | --- |
| `<Stage className? onSelect? selectedId? hud? creditsClassName? />` | Main 3D globe. Reads the console store (`useConsoleSelector`) and reacts to `state.stage` and stage directives. |
| `<FeedSurface feedId variant="thumb" \| "full" className? hud? />` | Simulated live camera view of a `Feed`. Fills its parent. |
| `getStageCapabilities()` | `{ cesium, google }` — whether `VITE_CESIUM_ION_TOKEN` / `VITE_GOOGLE_MAPS_KEY` are set. |
| `StageView`, `FeedSurfaceView` | Store-agnostic versions that read the `stageWorld` mirror (used by the dev harness). |
| `stageWorld`, `useStageWorld` | The mirror of the store slices the stage consumes. |

`Stage` props:

- `onSelect(id, kind)` — user clicked a unit / finding / place / action route (`kind` = `'unit' | 'finding' | 'place' | 'action'`), or empty ground (`null`). The stage always flies to the clicked object and calls `api.focus(geo, range)`; use the callback to open details.
- `selectedId` — controlled selection (signal corner brackets on the glyph). When omitted the stage tracks its last click.
- `hud` — camera readout and basemap tag, bottom-right (default on).
- `creditsClassName` — reposition the credits container (bottom-left by default).

## Main globe appearance and layers (2026-11-15)

The main globe starts in quiet **Outline cartography**, with no survey grid. `context-map.ts`
streams current OSM/CARTO vector tiles, using a small bounds-checked MVT reader (`vector-tile.ts`),
without a new dependency. Accurate coastlines, roads, place names and mapped building footprints
continue beyond the local pack. A bounded worker decodes and paints tiles off the UI thread,
using locally hosted brand fonts; browsers without OffscreenCanvas retain a main-thread fallback.
Water uses faint hatching; woodland uses sparse stipple. Roads
have a major/minor hierarchy; mapped buildings appear at zoom 14 and above. Local town labels
remain screen-aligned and selectable, with nearby-only minor landmarks.

`outline.ts` and `cartography.ts` supply a native-resolution offline hillshade/water/fuel field,
restrained contours and offline road batches. The streamed contour material is sampler-free,
leaving every device texture slot available to Cesium's multi-image terrain leaves. Eye-space ENU subtraction avoids large ECEF float
cancellation. Local offline building marks are approximate 9 m squares, generated lazily below
4 m/CSS pixel in one indexed line mesh, not thousands of ground primitives or surveyed footprints.

Terrain uses 1× vertical scale and a main-view sampler independent of feed/provider calibration.
The local provider stops refinement at source-useful sample spacing (level 15 Mati / 14 Caldor).
Its SSE stop sentinel stays positive: zero would make Cesium's imagery log2/int32 calculation
select a world-scale tile at close zoom. Streamed imagery is capped at z16, with one level of
overzoom above source z15 and 2× raster density, to bound leaf-tile texture fan-out.
The cached DEMs have nominal 20 m / 40 m sample spacing, not verified 20 m / 40 m native accuracy.
Whole-metre DEM values and bilinear interpolation do not become new measured detail at tighter zoom.
Local relief fades at the coverage edge; terrain outside eases over 3 km to ellipsoid context.
It is not measured regional terrain. Streamed geography remains continuous across that edge.
The scale bar uses terrain ray intersections; the HUD names context availability and local DEM
sample spacing. Current OSM geography is not historical incident imagery.

`MapControls.tsx` switches Outline/Satellite without replacing the viewer. Satellite setup
is lazy and cached; switching back hides its imagery/tiles and restores the local terrain.
`map-settings.ts` validates and persists display preferences in `fcc.map`. Contours, roads,
places, buildings, units, findings and fire/perimeter start visible. Predictions,
action routes and coverage start hidden. Existing saved preferences are preserved. Atmosphere/smoke starts enabled for Satellite
only, and Outline remains clean. Hiding a finding never removes it from the decision queue.

The main stage's solar curve also drives the console's Auto light/dark appearance through
`DaylightSync`. Outline reads the same smoothed appearance blend and live design tokens as chrome.
Manual Light/Dark overrides change both, not the replay clock. Palette updates change uniforms,
existing label properties and the alphas of cached dark/light raster endpoints, never rebuild terrain.
Streamed labels use separate transparent imagery layers and a contrast-selected label/halo endpoint
through twilight. Brand or layer changes rerasterize cached vector data. Main-map labels use the
active brand's mono font. Sensor feeds retain their independent basemap/effects and dark
instrumentation, regardless of main globe mode; scene colours are never mutated through shared tokens.
Outline uses a cheap unwarped fire-mask pass (no noise/halo/flicker), while Satellite and sensors keep
the cinematic shader. Empty fire masks do not draw a full-region transparent pass.

## How the stage consumes state

`useStageSync()` (called by `Stage` and every `FeedSurface`) copies `pack`, `clock.t`, `clock.paused`, `clock.speed`, `units`, `findings`, `feeds`, `projection`, `items`, `actions`, `coverage`, `stage`, `directives` and `fireRev` into `stageWorld` (reference-compared). The world publishes at 10 Hz, heavier panels at 5 Hz. `StageEngine` and the shared `FeedRenderer` diff their updates. `motion.ts` supplies both with a bounded 250 ms interpolation buffer: shape-preserving cubic position/heading curves, continuous packet-boundary velocity, shortest-angle wrapping, no overshoot and no unbounded extrapolation. Seeks, scenario changes, stale gaps and speed changes reset history rather than flying between unrelated states.

The grouped layer panel filters each unit type (drones, helicopters, tankers, engines, crews, dozers,
medical and law), callsigns, trails, sensor footprints and altitude stems. Findings have separate
people, animals, structures, vehicles, hazards/road blocks, fuel, water and smoke/spot-fire filters,
plus label and uncertainty controls. Fire surfaces and replay perimeters are independent. Air-unit
and basemap-only presets change visibility, never the simulation, feed selection or decision queues.
Preferences persist in `fcc.map`; old hidden-fire preferences also keep the newly separated perimeter hidden.

Aircraft guidance (`world/flight.ts`) uses bounded acceleration, angular acceleration, lateral
acceleration/turn radius and AGL changes, with 0.5 s maximum integration steps. Orbit entry and moving
mission centres steer continuously rather than snapping to a circle. Tankers loiter instead of
hovering; drones and helicopters can decelerate to a hold. These are illustrative envelopes, not
certified performance, collision avoidance, takeoff/landing or surveyed flight paths. Positions still
advance at the selected replay rate; the enlarged feed labels accelerated playback explicitly.

| State | Stage reaction |
| --- | --- |
| `fireRev` / `clock.t` | Fire field recomputed from `pack.arrival` (also when the clock drifts 5 min or jumps back). Hotspot clusters drive flame, smoke and ember particles and the ray-marched smoke plume, which bends downwind from `weather`. Sun position and colour follow the replay time. Latest observed perimeter at `t` drawn as a dashed bone line with acres. |
| `projection` | +1H/+3H/+6H translucent amber ground polygons, dashed outlines, `+1H · 82%` labels at the leading edge; `previous` bands as faint ghost outlines. Rebuilt on `rev` change. |
| `findings` + `items` | Glyph per kind, colored by class (life violet, ember when its item is Z0/Z1; combustible/spot ember; fuel/road-block amber; structure bone; water ice). Non-live findings get a dashed uncertainty ring + faint fill; opacity follows `freshness`. Labels only for items in Z0–Z3 or the selection. |
| `units` | Design-system icons as billboards (chips for ground units, brackets for aircraft), callsign labels, heading chevrons, dashed trails; drones get an altitude stem and sensor-footprint frustum. |
| `coverage` | Faint outlines; assigned cells get ice corner brackets. |
| `actions` | Proposed / approved / executing actions with a route: signal dashed route; `safetyZone` as a phosphor dashed circle with label. |
| `directives` (newest unhandled `focusStage`) | Smooth `flyToBoundingSphere` using the ease-servo curve (instant under reduced motion). Directives that existed before the stage mounted are not replayed. |
| `stage.highlight` | Pulsing signal rings (DOM overlay tracking the world position). |
| `stage.dimmed` | Everything outside a spotlight around the latest `dimOthers.itemId` (or `highlight[0]`) is darkened. |
| `stage.mode === 'feed'` | `stage.feedId` is rendered full-stage with a 420 ms crossfade; the globe render loop pauses while covered. `restoreStage` (mode back to `globe`) fades back. |

Ids accepted for highlight / dim / selection: finding ids, unit ids, place ids, action ids, and graded-item ids that carry `pos`.

## Scenario profile

The stage holds no scenario constants. `profile.ts` derives a `StageProfile` from the pack (centre, span, relief, min/max elevation, water fraction, coastal flag, hotspot bin size, flame and smoke radii, vertical exaggeration, initial view, zoom limits, fog density, label distances). Every pack (Mati 2018 by default, Caldor 2021 via `?scenario=caldor-2021`) is tuned from that profile. Sea pixels (pack water mask, or streamed surface at sea level near the coast) render as water with sky reflection and sun glint.

## Atmosphere and camera models

All smoke/optics/sensor effects are illustrative shaders, not validated physical camera models.
IR is non-radiometric synthetic heat intensity, never a measured temperature. Satellite pixels are
archived real imagery; detections drawn over them are simulated annotations. The console labels these
distinctions and keeps source/date/nominal-pass details above the metric strip.

- `smoke.ts` — `SmokeField`: a 224² CPU plume footprint (column density, plume base and top, settled haze) built from the active clusters and hourly wind with a bent-over Gaussian plume. Rebuilt when sources or wind change; double-buffered and cross-faded.
- `atmosphere.ts` — `AtmospherePass`, the first post-process in both viewers. Reconstructs each pixel's position from the log depth buffer and ray-marches the plume with spectral extinction (brown-grey smoke, reddened and dimmed sun under the plume, plume shadow on the ground), fire light at the base of the column, near-ground haze, distance haze, heat shimmer over the front, water reflection and glint. Looks: `stage` (legibility floor after sunset), `camera` (real sky with sun disc and forward scatter, lower path extinction because feed cameras often sit beside the plume) and `thermal` (temperature image; LWIR sees through most smoke). Sun position from `sun.ts` (real solar ephemeris at the replay time).
- `fx.ts` — camera models after the atmosphere: `uav-eo` (sharpening, chromatic aberration, H.264 blocks, bloom), `ir-white` / `ir-iron` (microbolometer blur, AGC, fixed-pattern noise, NUC shutter freeze), `dash` (barrel distortion, rolling shutter, windshield veil, dashboard edge), `helmet` (wide barrel, sway), `ridge` (PTZ compression), `phone` (JPEG ringing, shake; posted portrait 9:16), `sat`. Stable exponential exposure / AGC, NUC timing and shake live in `FeedRenderer.sensor()`.
- Satellite feeds (`feeds/satellite.ts`) only show real pack imagery: the latest true-colour scene in `manifest.imageryExtra` (or the base mosaic) whose pass is not after the replay time, with the thermal overlay of the same date. The HUD names sensor, date, pass time and source; pass times are nominal (10:30 or 13:30 local solar time) until the pack provides exact overpass timestamps, and are labelled "(NOMINAL)". When no scene exists the frame says "Synthetic render · not imagery".
- Reduced motion: no shimmer, shake, rolling shutter or particles.

## Layers and files

- `viewer.ts` — dark Viewer factory (all widgets off, dark sky atmosphere, fog, no sun/moon), `setupBasemap` (datum calibration of the orthometric pack DEM against streamed ellipsoid terrain) and `applySunLight`.
- `terrain.ts` — `CustomHeightmapTerrainProvider` from `pack.elevation`, with optional source-resolution/coverage bounds used only by Outline; the offline Satellite/feed relief composite; close-range sensor detail; optional NASA GIBS context.
- `outline.ts`, `cartography.ts` — main-view-only material, native data field, vector batches, quiet patterns, terrain-resolution bounds and scale formatting.
- `context-map.ts`, `vector-tile.ts` — streamed OSM/CARTO context, four cached raster endpoints (dark/light geography and transparent labels), collision-filtered names and a 64-tile decoded-data LRU. At most four requests run concurrently, shared between endpoints, with timeouts and teardown cancellation. Provider failure or browser offline state reveals the local fallback; reconnect retries. Attribution stays visible. Provider traffic is never added to the PWA cache.
- `fire.ts` — `FireField` (R burned, G active heat, B scar age, from `pack.arrival`; hotspot clustering) and `FireOverlay` (GroundPrimitive with a custom GLSL material: domain-warped edges, charcoal scar, ember speckle, flickering front, halo). Classification type `BOTH`, so it drapes over terrain and Google 3D tiles.
- `particles.ts` — capped flame (16) and smoke (6) particle systems; smoke drifts downwind.
- `layers.ts` — entity layers listed above. `glyphs.ts` — tinted canvas billboards from the `@ds` icon set.
- `fx.ts` — stage grade post-process and the feed effects: `eo`, `ir-ironbow`, `ir-whitehot`, `night`, `phone`, `sat` (all colors derive from tokens; ironbow is void → violet → ember → signal → amber → bone).
- `feeds/FeedRenderer.ts` — one hidden 960×540 / 384×216 Cesium viewer shared by every surface. The active `full` surface targets phase-locked 30 fps. Thumbnail warming cannot take a full-feed deadline; thumbnails use spare budget, with two-pass warming only when no full feed is active. Same-feed thumbnails ride along at ~4 fps. Pack initialization is serialized, owned scene resources are released, stale satellite draws cannot overwrite newer scenes, and repeated render failures back off to an explicit no-signal state. Camera/effect time stops with paused replay. Synthetic detection boxes are projected through the rendered camera each frame, not reused from stale source-frame boxes.
- `feeds/poses.ts`, `feeds/dynamics.ts` — unit-mounted UAV cameras share the map's interpolated platform position/AGL, without artificial target-orbit translation. Nadir is north-stabilized; oblique gimbals follow the assigned target or airframe heading, not detection ordering. Per-feed shortest-angle lens filters limit servo motion and keep unrelated cameras separate. Ridge PTZ surveys a bounded ±12° sector over 90 s. Dash (2.2 m), helmet (1.7 m), satellite and handheld poses remain distinct. Standalone non-unit orbit poses remain available. Sensor telemetry clears the incident-metric overlay.
- `feeds/FeedSurfaceView.tsx` — canvas + HUD, letterboxed together without cropping to preserve detector alignment on resize. Full: REC/LIVE (or "not live · archived clip"), callsign, label, sensor mode, FOV, kind, lat/lon, altitude AGL, heading, Zulu timecode, frame counter, reticle, labelled detection boxes with confidence. Thumb: detection boxes and a REC dot + mode tag only. Archive fallback remains until terrain is rendered; a moving camera need not empty the global terrain/proxy loading queues to start its feed.

## Local sensor QA

Real production replay entries, fresh browser processes, 1280×633 at DPR 1, a 960×540 EO
surface with the other thumbnails mounted, providers disabled, 60× replay and a moving
18 m/s platform. Six-second samples on the shared development machine:

| Scenario | Frames | Median gap | p95 gap | Longest gap |
| --- | ---: | ---: | ---: | ---: |
| Mati | 165 | 34.7 ms | 49.3 ms | 65.0 ms |
| Caldor | 167 | 34.8 ms | 47.7 ms | 75.6 ms |

This is approximately 28 fps, not a guaranteed 30/60 fps claim. Both entries passed exact
paused-position holds and eight repeated EO/IR switches after checking nadir, dash, helmet,
ridge and satellite models. Entity-level checks covered unit filters, details, independent
fire/perimeter visibility, saved preferences and unchanged feeds/decision queues. Additional
checks exercised 60×→120×→60×, backward seeks, reduced motion and a 1440×900 viewport;
the sensor/detection viewport retained its 16:9 aspect without cropping.

## Tokens and fallbacks

The table describes **Satellite mode and sensor feeds**. Outline streams keyless CARTO v2 vector
context by default, with local offline fallback. `?context=0` disables that context; `?tokens=0`
disables all providers unless `?context=1` explicitly re-enables Outline context. CARTO's current
raster service requires a key; this implementation does not use it. Vector access/terms can change:
see https://docs.carto.com/faqs/carto-basemaps. No signup or paid account is created.
Configured credentials do not prove provider access;
Google 3D over Mati was separately verified on 2026-11-15.

| Configuration | Terrain | Imagery | Notes |
| --- | --- | --- | --- |
| none, or `?tokens=0` | `CustomHeightmapTerrainProvider` from `pack.elevation`, profile vertical exaggeration | Offline relief composite over the bbox (uses `pack.imagery` when present, else fuel colors), procedural detail below ~4 km tiles | No network requests. Outside the bbox this Satellite/feed fallback uses a smoothed edge continuation, not measured terrain. |
| `VITE_CESIUM_ION_TOKEN` (or `?tokens=ion` to skip Google) | Cesium World Terrain (vertex normals, real sun light, profile exaggeration, no ion water mask) | ion Bing aerial (brightness 0.92, contrast 1.1, saturation 0.72) | Overlays clamp to world terrain; the pack DEM is shifted by the measured geoid offset. |
| `VITE_GOOGLE_MAPS_KEY` | Google Photorealistic 3D Tiles (globe hidden per Cesium guidance) | Mesh texture, graded by the stage post-process | Fire overlay, bands, rings and routes classify the mesh. Google attribution is shown in the credits container (mandatory). |

Any failure in a token path logs a warning and falls back to offline. The feed renderer uses the same basemap path. If WebGL is unavailable the stage shows a "3D stage unavailable" card. A feed without a usable context/terrain frame shows a labelled archive animation when pack imagery exists, never labelled live footage; otherwise it shows a static "No signal" card.

Optional regional context: `setupBasemap(viewer, pack, sampler, { gibs: true })` adds NASA GIBS VIIRS true color for the replay date (keyless, network).

## Performance

- Main stage renders continuously; render loop pauses while a feed covers it. Outline uses analytical line antialiasing and MSAA 1; Satellite restores MSAA 4. Main-view backing density follows device DPR up to 2× with a four-megapixel cap, recalculated only on viewport/DPR changes. Feed viewer: unchanged MSAA 1 and fixed-size manual rendering, disposed 60 s after the last surface unmounts.
- Fire field: one pass over the raster per `fireRev` (about 10 ms at 1000 × 833); texture double-buffered so Cesium re-uploads.
- Particles capped (16 flame + 6 smoke on the stage, 12 + 5 in feeds). Layers diff by signature; freshness alpha is quantized to 1/8 steps to avoid ground-primitive rebuilds.
- `prefers-reduced-motion`: no particles, frozen fire flicker, instant camera moves, static highlight rings, no shimmer or camera shake.
- Cartography check (2026-11-15, local Chromium, real `/console.html`, feeds mounted, paused replay,
  1920×1080 CSS viewport, DPR 2, main canvas 2625×1523): five camera flights over seven seconds,
  including first tighter zooms. Mati: 420 frames, p50 16.6 / p95 19.7 / p99 21.3 ms, longest 27.8 ms,
  no long tasks. Caldor: 406 frames, p50 16.6 / p95 19.7 / p99 22.5 ms, longest 267 ms, one 259 ms
  cold-load long task. These runs meet the ~33 ms p95 target, not a hitch-free or cross-device guarantee.
  Constructor-to-ready was 76.4 / 76.6 ms, excluding pack fetching and initial terrain/tile completion.
  Both scenarios also passed production/offline entry checks; provider traffic remained outside the PWA cache.
- Earlier measurement, before Outline/daylight/PWA changes (Apple M4, 10-core GPU, Chrome/ANGLE Metal, 1920×1080 at DPR 1, Mati, ion): stage with all eight feed thumbnails 41.8 fps average (p50 16.7 ms, p95 33.4 ms); stage alone 37.8 fps; offline with thumbnails 39.7 fps. Feed render cost about 5 ms per frame. This is not a measurement of the latest default mode.

## Dev harness

`http://localhost:5173/src/console/stage3d/dev/preview.html` renders the stage over the real pack with a mock world (`dev/mock.ts`). Query params: `t=<hours after replay start>`, `speed=<x>`, `feed=<feedId>` (feed mode), `fx=<FeedFx>` (override every feed), `thumbs=1` (thumbnail strip), `dim=1`, `hl=<id,id>`, `focus=<lon,lat,range>`, `pack=<scenario id>`, `tokens=0` (offline basemap), `tokens=ion`, `atmos=0` (disable the stage atmosphere pass, for debugging). In development builds `window.__fccStage` and `window.__fccFeeds` expose the engine and the feed renderer.
