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

The main globe starts in **Outline** mode: `outline.ts` makes a grayscale hillshade from the
actual pack DEM, with separate contour, road and approximate-building image layers. Terrain
uses 1× vertical scale. Relief edges fade to a constant border to avoid regional image
edge-sampling streaks. Contour interval comes from the scenario profile; building squares
are approximate marks, not surveyed footprints.

`MapControls.tsx` switches Outline/Satellite without replacing the viewer. Satellite setup
is lazy and cached; switching back hides its imagery/tiles and restores the local terrain.
`map-settings.ts` validates and persists display preferences in `fcc.map`. Contours, roads,
places, units, findings and fire/perimeter start visible. Building marks, predictions,
action routes and coverage start hidden. Atmosphere/smoke starts enabled for Satellite
only, and Outline remains clean. Hiding a finding never removes it from the decision queue.

The main stage's solar curve also drives the console's Auto light/dark appearance through
`DaylightSync`. Manual Light/Dark changes chrome, not the replay clock. Sensor feeds retain
their independent basemap/effects and dark instrumentation, regardless of main globe mode.

## How the stage consumes state

`useStageSync()` (called by `Stage` and every `FeedSurface`) copies `pack`, `clock.t`, `clock.paused`, `units`, `findings`, `feeds`, `projection`, `items`, `actions`, `coverage`, `stage`, `directives` and `fireRev` into `stageWorld` (reference-compared). `StageEngine` and the shared `FeedRenderer` subscribe to it and apply changes once per frame, diffing every layer by a signature so 5 Hz store updates only touch what changed. Unit positions are interpolated between store updates (`world.ts`).

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
- `fx.ts` — camera models after the atmosphere: `uav-eo` (sharpening, chromatic aberration, H.264 blocks, bloom), `ir-white` / `ir-iron` (microbolometer blur, AGC, fixed-pattern noise, NUC shutter freeze), `dash` (barrel distortion, rolling shutter, windshield veil, dashboard edge), `helmet` (wide barrel, sway), `ridge` (PTZ compression), `phone` (AE pumping, JPEG ringing, shake; posted portrait 9:16), `sat`. Exposure / AGC dynamics, NUC timing and shake live in `FeedRenderer.sensor()`.
- Satellite feeds (`feeds/satellite.ts`) only show real pack imagery: the latest true-colour scene in `manifest.imageryExtra` (or the base mosaic) whose pass is not after the replay time, with the thermal overlay of the same date. The HUD names sensor, date, pass time and source; pass times are nominal (10:30 or 13:30 local solar time) until the pack provides exact overpass timestamps, and are labelled "(NOMINAL)". When no scene exists the frame says "Synthetic render · not imagery".
- Reduced motion: no shimmer, shake, rolling shutter or particles.

## Layers and files

- `viewer.ts` — dark Viewer factory (all widgets off, dark sky atmosphere, fog, no sun/moon), `setupBasemap` (datum calibration of the orthometric pack DEM against streamed ellipsoid terrain) and `applySunLight`.
- `terrain.ts` — `CustomHeightmapTerrainProvider` from `pack.elevation`; the offline relief composite (imagery or fuel colors × baked hillshade × canopy grain + 40 m contours + roads, water, buildings); the close-range procedural detail layer; optional NASA GIBS context.
- `fire.ts` — `FireField` (R burned, G active heat, B scar age, from `pack.arrival`; hotspot clustering) and `FireOverlay` (GroundPrimitive with a custom GLSL material: domain-warped edges, charcoal scar, ember speckle, flickering front, halo). Classification type `BOTH`, so it drapes over terrain and Google 3D tiles.
- `particles.ts` — capped flame (16) and smoke (6) particle systems; smoke drifts downwind.
- `layers.ts` — entity layers listed above. `glyphs.ts` — tinted canvas billboards from the `@ds` icon set.
- `fx.ts` — stage grade post-process and the feed effects: `eo`, `ir-ironbow`, `ir-whitehot`, `night`, `phone`, `sat` (all colors derive from tokens; ironbow is void → violet → ember → signal → amber → bone).
- `feeds/FeedRenderer.ts` — one hidden 960×540 / 384×216 Cesium viewer shared by every surface. The active `full` surface renders at ~24 fps; thumbnails refresh round-robin (each roughly every 2 s, two-pass so tiles are resident); thumbnails showing the full feed ride along at ~4 fps. Back-off grows with measured render cost. Adds 3D stand-ins for findings (people, animals, tanks, vehicles, structures), units and OSM buildings so cameras actually see something; detection boxes come from `finding.bbox` (when `bbox.feedId` matches) or the projected finding position.
- `feeds/poses.ts` — camera poses: uav-nadir (150–400 m, straight down), uav-oblique (orbit the target at the pose pitch), uav-chase, dash-cam (2.2 m, along heading, slight pitch down, vibration), helmet-cam (1.7 m, sway/bob), ridge-cam (fixed mast, 360° pan every 4 min dwelling on the configured heading), satellite (altitude from `rangeM` footprint and `fovDeg`), social (handheld at the pose / finding).
- `feeds/FeedSurfaceView.tsx` — canvas + HUD. Full: REC/LIVE (or "not live · archived clip"), callsign, label, sensor mode, FOV, kind, lat/lon, altitude AGL, heading, Zulu timecode, frame counter, reticle, labelled detection boxes with confidence. Thumb: detection boxes and a REC dot + mode tag only.

## Tokens and fallbacks

The table describes **Satellite mode and sensor feeds**. Outline always uses local data,
even when a provider key is configured. Configured credentials do not prove provider access;
Google 3D over Mati was separately verified on 2026-11-15.

| Configuration | Terrain | Imagery | Notes |
| --- | --- | --- | --- |
| none, or `?tokens=0` | `CustomHeightmapTerrainProvider` from `pack.elevation`, profile vertical exaggeration | Offline relief composite over the bbox (uses `pack.imagery` when present, else fuel colors), procedural detail below ~4 km tiles | No network requests. Outside the bbox the surface eases to the mean height over a dark ink base, so the scenario reads as a lit terrain model. |
| `VITE_CESIUM_ION_TOKEN` (or `?tokens=ion` to skip Google) | Cesium World Terrain (vertex normals, real sun light, profile exaggeration, no ion water mask) | ion Bing aerial (brightness 0.92, contrast 1.1, saturation 0.72) | Overlays clamp to world terrain; the pack DEM is shifted by the measured geoid offset. |
| `VITE_GOOGLE_MAPS_KEY` | Google Photorealistic 3D Tiles (globe hidden per Cesium guidance) | Mesh texture, graded by the stage post-process | Fire overlay, bands, rings and routes classify the mesh. Google attribution is shown in the credits container (mandatory). |

Any failure in a token path logs a warning and falls back to offline. The feed renderer uses the same basemap path. If WebGL is unavailable the stage shows a "3D stage unavailable" card; if the feed renderer cannot get a second context, surfaces show a static "No signal" card.

Optional regional context: `setupBasemap(viewer, pack, sampler, { gibs: true })` adds NASA GIBS VIIRS true color for the replay date (keyless, network).

## Performance

- Main stage renders continuously (fire flicker, particles) with MSAA 4; render loop pauses while a feed covers it. Feed viewer: MSAA 1, manual render loop, disposed 60 s after the last surface unmounts.
- Fire field: one pass over the raster per `fireRev` (about 10 ms at 1000 × 833); texture double-buffered so Cesium re-uploads.
- Particles capped (16 flame + 6 smoke on the stage, 12 + 5 in feeds). Layers diff by signature; freshness alpha is quantized to 1/8 steps to avoid ground-primitive rebuilds.
- `prefers-reduced-motion`: no particles, frozen fire flicker, instant camera moves, static highlight rings, no shimmer or camera shake.
- Earlier measurement, before Outline/daylight/PWA changes (Apple M4, 10-core GPU, Chrome/ANGLE Metal, 1920×1080 at DPR 1, Mati, ion): stage with all eight feed thumbnails 41.8 fps average (p50 16.7 ms, p95 33.4 ms); stage alone 37.8 fps; offline with thumbnails 39.7 fps. Feed render cost about 5 ms per frame. This is not a measurement of the latest default mode.

## Dev harness

`http://localhost:5173/src/console/stage3d/dev/preview.html` renders the stage over the real pack with a mock world (`dev/mock.ts`). Query params: `t=<hours after replay start>`, `speed=<x>`, `feed=<feedId>` (feed mode), `fx=<FeedFx>` (override every feed), `thumbs=1` (thumbnail strip), `dim=1`, `hl=<id,id>`, `focus=<lon,lat,range>`, `pack=<scenario id>`, `tokens=0` (offline basemap), `tokens=ion`, `atmos=0` (disable the stage atmosphere pass, for debugging). In development builds `window.__fccStage` and `window.__fccFeeds` expose the engine and the feed renderer.
