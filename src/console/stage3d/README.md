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

## How the stage consumes state

`useStageSync()` (called by `Stage` and every `FeedSurface`) copies `pack`, `clock.t`, `clock.paused`, `units`, `findings`, `feeds`, `projection`, `items`, `actions`, `coverage`, `stage`, `directives` and `fireRev` into `stageWorld` (reference-compared). `StageEngine` and the shared `FeedRenderer` subscribe to it and apply changes once per frame, diffing every layer by a signature so 5 Hz store updates only touch what changed. Unit positions are interpolated between store updates (`world.ts`).

| State | Stage reaction |
| --- | --- |
| `fireRev` / `clock.t` | Fire field recomputed from `pack.arrival` (also when the clock drifts 5 min or jumps back). Hotspot clusters drive flame and smoke particles; smoke bends downwind from `weather`. Latest observed perimeter at `t` drawn as a dashed bone line with acres. |
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

## Layers and files

- `viewer.ts` — dark Viewer factory (all widgets off, dark sky atmosphere, fog, no sun/moon) and `setupBasemap`.
- `terrain.ts` — `CustomHeightmapTerrainProvider` from `pack.elevation`; the offline relief composite (imagery or fuel colors × baked hillshade × canopy grain + 40 m contours + roads, water, buildings); the close-range procedural detail layer; optional NASA GIBS context.
- `fire.ts` — `FireField` (R burned, G active heat, B scar age, from `pack.arrival`; hotspot clustering) and `FireOverlay` (GroundPrimitive with a custom GLSL material: domain-warped edges, charcoal scar, ember speckle, flickering front, halo). Classification type `BOTH`, so it drapes over terrain and Google 3D tiles.
- `particles.ts` — capped flame (16) and smoke (6) particle systems; smoke drifts downwind.
- `layers.ts` — entity layers listed above. `glyphs.ts` — tinted canvas billboards from the `@ds` icon set.
- `fx.ts` — stage grade post-process and the feed effects: `eo`, `ir-ironbow`, `ir-whitehot`, `night`, `phone`, `sat` (all colors derive from tokens; ironbow is void → violet → ember → signal → amber → bone).
- `feeds/FeedRenderer.ts` — one hidden 960×540 / 384×216 Cesium viewer shared by every surface. The active `full` surface renders at ~18 fps; thumbnails refresh round-robin (each roughly every 2 s, two-pass so tiles are resident); thumbnails showing the full feed ride along at ~4 fps. Back-off grows with measured render cost. Adds 3D stand-ins for findings (people, animals, tanks, vehicles, structures), units and OSM buildings so cameras actually see something; detection boxes come from `finding.bbox` (when `bbox.feedId` matches) or the projected finding position.
- `feeds/poses.ts` — camera poses: uav-nadir (150–400 m, straight down), uav-oblique (orbit the target at the pose pitch), uav-chase, dash-cam (2.2 m, along heading, slight pitch down, vibration), helmet-cam (1.7 m, sway/bob), ridge-cam (fixed mast, 360° pan every 4 min dwelling on the configured heading), satellite (altitude from `rangeM` footprint and `fovDeg`), social (handheld at the pose / finding).
- `feeds/FeedSurfaceView.tsx` — canvas + HUD. Full: REC/LIVE (or "not live · archived clip"), callsign, label, sensor mode, FOV, kind, lat/lon, altitude AGL, heading, Zulu timecode, frame counter, reticle, labelled detection boxes with confidence. Thumb: detection boxes and a REC dot + mode tag only.

## Tokens and fallbacks

| Configuration | Terrain | Imagery | Notes |
| --- | --- | --- | --- |
| none (default) | `CustomHeightmapTerrainProvider` from `pack.elevation`, vertical exaggeration 1.3 | Offline relief composite over the bbox (uses `pack.imagery` when present, else fuel colors), procedural detail below ~4 km tiles | No network requests. Outside the bbox the surface eases to the mean height over a dark ink base, so the scenario reads as a lit terrain model. |
| `VITE_CESIUM_ION_TOKEN` | Cesium World Terrain (vertex normals, fixed NW key light) | ion Bing aerial, graded dark (brightness 0.78, saturation 0.45) | Overlays clamp to world terrain. |
| `VITE_GOOGLE_MAPS_KEY` | Google Photorealistic 3D Tiles (globe hidden per Cesium guidance) | Mesh texture, graded by the stage post-process | Fire overlay, bands, rings and routes classify the mesh. Google attribution is shown in the credits container (mandatory). |

Any failure in a token path logs a warning and falls back to offline. The feed renderer uses the same basemap path. If WebGL is unavailable the stage shows a "3D stage unavailable" card; if the feed renderer cannot get a second context, surfaces show a static "No signal" card.

Optional regional context: `setupBasemap(viewer, pack, sampler, { gibs: true })` adds NASA GIBS VIIRS true color for the replay date (keyless, network).

## Performance

- Main stage renders continuously (fire flicker, particles) with MSAA 4; render loop pauses while a feed covers it. Feed viewer: MSAA 1, manual render loop, disposed 60 s after the last surface unmounts.
- Fire field: one pass over the raster per `fireRev` (about 10 ms at 1000 × 833); texture double-buffered so Cesium re-uploads.
- Particles capped (16 flame + 6 smoke on the stage, 12 + 5 in feeds). Layers diff by signature; freshness alpha is quantized to 1/8 steps to avoid ground-primitive rebuilds.
- `prefers-reduced-motion`: no particles, frozen fire flicker, instant camera moves, static highlight rings.

## Dev harness

`http://localhost:5173/src/console/stage3d/dev/preview.html` renders the stage over the real pack with a mock world (`dev/mock.ts`). Query params: `t=<hours after replay start>`, `speed=<x>`, `feed=<feedId>` (feed mode), `fx=<FeedFx>` (override every feed), `thumbs=1` (thumbnail strip), `dim=1`, `hl=<id,id>`, `focus=<lon,lat,range>`.
