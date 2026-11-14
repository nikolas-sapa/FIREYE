# AGENTS.md — operating rules for AI agents

## REV D integration notes (current work)

These notes supersede Caldor-only and single-theme assumptions below. REV C remains available at git tag `rev-c`; frozen REV A/B files must remain untouched.

- The default scenario is Mati 2018 (`public/data/mati/`). Caldor remains selectable with `?scenario=caldor-2021`. The shared registry and `loadScenario(id?)` live in `src/console/scenario/`.
- The user approved both themes: FCC (orange, Inter Tight/JetBrains Mono) and Team (blue `#006bff`, Geist/Geist Mono). The added Fontsource dependencies are approved. Read theme-sensitive canvas/WebGL values at draw time, not module initialization.
- The Mati arrival raster and intermediate perimeters are reconstructions fitted to historical anchors and constrained to the final EFFIS polygon. Do not describe them as independently observed truth or their fitted agreement as prediction skill. FIRMS observations in this pack are later than the main run.
- Projection code may initialize from observations available at issue time but must not read future arrival times or future perimeters. Separate reconstruction IoU from documented-checkpoint errors and final-perimeter checks.
- Sourced historical context may appear as attributed facts with conflicting totals preserved. No victim identities, locations or depictions. Simulated people remain fictional; no claim that the prototype would have prevented historical deaths.
- Optional pack fields: `checkpoints`, `reports`, `facts`. Optional state: `scenarioId`, `predictions`. New bus member: `prediction.scored`. Mirror changes in `docs/BACKEND_CONTRACT.md`.
- Keep FIRMS credentials script-only (`FIRMS_MAP_KEY`, never a `VITE_` variable). Browser terrain tokens are public client credentials and need provider restrictions. Do not publish `.env.local` or built bundles containing unrestricted local credentials.
- Rebuild: `node scripts/fetch-data.mjs --scenario mati`. Consistency check: `node scripts/check-mati.mjs`. Report it as consistency, not independent validation.
- REV D simulation and stage integration are not complete until both scenarios build, real entry points run, screenshots are reviewed and prediction provenance is checked.

FCC (Fire Command Center) is a proposal site plus a full-screen console: an Orchestrator-first command center for fire departments and first responders. The proposal site runs on a simulated incident; the REV C console replays the 2021 Caldor Fire from public data. Read this file, then `DESIGN_SYSTEM.md`, before you change anything.

## Revisions

- **REV D (current)** — Mati reconstruction by default, Caldor selectable, dual FCC/Team themes, richer simulated views and prototype minimum-travel-time spread with reconstruction/checkpoint checks. All high-risk drafts require a human approval click, even in the Director tour. No real LLM inference or measured time savings.
- **REV C (frozen)** — original Caldor console at `/rev-c/console.html`, proposal at `/rev-c/index.html`, source tag `rev-c`. Built without local credentials. Never edit `public/rev-c/`. The REV C contract below remains the baseline, extended by the REV D notes above.
- **REV B (frozen)** — Orchestrator-first. A calm default console (map, command bar, Orchestrator dock) with progressive disclosure through an icon rail and drawers. Every finding is graded 0–100 and placed by tier (`DESIGN_SYSTEM.md` section 13).
  A built copy lives in `public/rev-b/` (served at `/rev-b/index.html`) and the source is git tag `rev-b`. Never edit `public/rev-b/`.
- **REV A (frozen)** — the original dashboard-first proposal. A built copy lives in `public/rev-a/` (served at `/rev-a/index.html`) and the source is git tag `rev-a`. Never edit `public/rev-a/`; to inspect REV A source use `git show rev-a:<path>` or `git worktree add /tmp/fcc-rev-a rev-a`.
- A new revision gets: a git tag for the previous one, a frozen build under `public/rev-<x>/`, bumped serials (Hero strip, Nav, Footer revision history, `FCC-DS / REV X`), and a note here. Frozen builds (`public/rev-a/`, `public/rev-b/`) are never edited or rebuilt; only the integrator commits and tags.

## Stack

- Vite 5, React 18, TypeScript (strict, `noUnusedLocals`, `noUnusedParameters`), Tailwind CSS 3.4.
- Fonts: Inter Tight Variable and JetBrains Mono Variable, self-hosted via `@fontsource-variable/*`.
- REV C adds `cesium` and `vite-plugin-cesium` (wired in `vite.config.ts`) for the console stage. No other runtime dependencies.
- The proposal site generates its map, terrain and data procedurally in the browser and makes no external requests. The console loads the cached pack from `/data/caldor/`; it streams Cesium ion and Google Photorealistic 3D Tiles only when the optional tokens `VITE_CESIUM_ION_TOKEN` / `VITE_GOOGLE_MAPS_KEY` are set in `.env.local` (see `docs/SETUP.md`). Every path must work without tokens.

## Commands

```bash
npm install          # install deps
npm run dev          # dev server → http://localhost:5173
npm run build        # tsc --noEmit && vite build (must pass before you finish)
npm run typecheck    # tsc --noEmit only
npm run preview      # serve the production build
```

Page anchors: `#top` (01 hero), `#architecture` (02), `#stack` (03 vendors and open questions), `#dashboard` (04 live ops, REV B concept preview + link to the console), `#system` (05 design system showcase). Console: `/console.html`. Archives: `/rev-b/index.html`, `/rev-a/index.html`.

Scenario data: `node scripts/fetch-data.mjs` (optional `FIRMS_MAP_KEY`) rebuilds `public/data/caldor/`.

## Directory map

```
DESIGN_SYSTEM.md            canonical design reference (tokens, components, patterns, recipes)
AGENTS.md                   this file
README.md                   project intro
docs/                       BACKEND_CONTRACT.md, ORCHESTRATOR.md, DATA_SOURCES.md, SETUP.md
console.html                REV C console entry
src/console/                REV C console (see ownership map below)
scripts/fetch-data.mjs      builds the Caldor scenario pack
public/data/caldor/         cached scenario pack (README.md lists sources)
tailwind.config.ts          tokens wired into Tailwind utilities
src/main.tsx                React entry
src/App.tsx                 page composition (Nav, Hero, Architecture, Stack, DashboardSection, DesignSystemSection, Footer)
src/index.css               fonts, base layer, .fcc-* utility classes, reduced-motion rule
src/design-system/          the design system, imported as '@ds'
  tokens/                   tokens.css (source of truth) + index.ts (JS mirror: color, role, toneClass, Tone, ...)
  primitives/               Brackets, Frame, Label, Serial, Ruler, Crosshair, RegMark, Hatch, GridBg, Rule, Dot, Datum
  components/               Button, Panel, Metric, Table, Alert, UnitChip, ... (catalog in DESIGN_SYSTEM.md §11)
  components/orchestrator.tsx  REV B: ScoreMeter, TierBadge, AlertCard, InterruptBanner, Freshness, OrchBubble,
                            PromptChip, Drawer, IconRail, FeedTile, PoolBar, MovementCard, tierOf, alertTone
  icons/                    Icon, iconNames, IconName
  utils.ts                  cn, pad, fmtLat, fmtLon, zulu
src/sim/                    simulation engine; types.ts is the shared contract
src/dashboard/              live ops console panels
src/dashboard/map/          TacticalMap renderer (canvas)
src/sections/               page sections (ds/ = showcase chapters)
public/rev-a/               frozen REV A build — never edit
public/rev-b/               frozen REV B build — never edit
```

Path aliases: `@ds` → `src/design-system/index.ts`, `@ds/*` → `src/design-system/*`, `@/*` → `src/*`.

## Hard rules

1. **Check `DESIGN_SYSTEM.md` first.** If a token, primitive or component already exists, use it.
2. **Import UI from `@ds`.** `import { Panel, Button, Icon, cn } from '@ds';` Do not deep-import component files from feature code.
3. **Never hardcode hex (or rgb) colors in components.** Use Tailwind utilities generated from tokens (`bg-ink-900`, `text-bone`, `border-line`, `stroke-ice`, `fill-ember/10`). For canvas/WebGL or a `Legend` color, use `color` / `role` from `@ds`.
4. **One accent.** `signal` (fire orange) marks the single most important thing: primary action, selection, current index. Keep it under 5% of the screen. Status meaning uses ember, amber, phosphor, ice, violet.
5. **Square corners.** Radius 0–2px (`rounded-none`, `rounded-hair`, `rounded-xs`). `rounded-pill` only for live pulse rings.
6. **Hairlines, not boxes.** 1px `border-line` rules; shared dividers via `gap-px bg-line`. No decorative gradients, no glassmorphism (backdrop blur is allowed only on the sticky nav), no shadows except `shadow-panel|lift|signal|inset`.
7. **Mono micro labels.** Labels, data, units, codes and timestamps use `font-mono`, uppercase, tracked (`.fcc-label`, `.fcc-micro`, `text-nano`, `text-micro`). Headlines and prose use the sans in sentence case. Changing numbers get `fcc-num` / `tabular-nums`.
8. **Mechanical motion.** `ease-servo|snap|settle`, `duration-instant|quick|base|slow|drift`. No bounce. Respect `prefers-reduced-motion`, including in JS/rAF/SMIL animation.
9. **No emoji, no exclamation marks, no new npm dependencies** without explicit approval.
10. **Layout rail:** sections are `mx-auto max-w-[1440px] px-6 lg:px-10`.
11. **Extending the system:** a new component goes in `src/design-system/components/`, is exported from `components/index.ts`, gets a specimen in `src/sections/DesignSystemSection.tsx`, and a catalog entry in `DESIGN_SYSTEM.md`. A new token goes in `tokens.css`, `tokens/index.ts` and `tailwind.config.ts` together.
12. **Do not start long-running processes** (dev servers, watchers) in automated runs; validate with `npm run build`.

## Simulation contract

`src/sim/types.ts` defines everything the engine, map and panels share. Treat it as an API: only add optional fields; never rename or remove.

- World: `GRID_W × GRID_H` (240 × 150) cells of `CELL_M` (40 m). Positions are `Vec` in cell units, +x east, +y south. `ORIGIN` anchors cell (0,0) geographically.
- `Grid`: typed arrays for elevation, fuel (`Fuel` enum), dryness, state (`CellState`), heat, retardant, plus a `version` counter for render caching.
- `SimSnapshot`: `t`, `clock`, `grid`, `wind`, `weather`, `forecast` (`ForecastBand[]` at 60/180/360 min), `units`, `markers`, `ingest` (intel feed), `insights` (AI output), `recommendations`, `metrics`, `history`, `forecastRev`.
- `SimEngine`: `state`, `tick(dt)`, `setPaused`, `setSpeed`, `accept(recId)`, `dismiss(recId)`, `reset()`, `subscribe(fn)` (throttled ~4 Hz).
- `MapLayers` / `DEFAULT_LAYERS`: layer toggles for the map. REV B adds optional `coverage`, `observations`, `movements` (treated as true when absent).

REV B additions (bottom of `types.ts`, additive):

- `SimSnapshotB extends SimSnapshot`: `alerts: OrchAlert[]` (newest first), `observations: Observation[]`, `jobs: AnalysisJob[]`, `pools: AgentPool[]`, `feeds: CameraFeed[]`, `coverage: CoverageCell[]`, `movements: MovementProposal[]`, `orchestrator: OrchestratorState` (status, headline, brief, messages, suggestions).
- `SimEngineB`: `SimEngine` with `state: SimSnapshotB` plus `ask(text)`, `ackAlert(id)`, `approveMovement(id)`, `rejectMovement(id)`.
- Supporting types: `SourceKind`, `AlertClass`, `AlertTier` (0–3), `Audience`, `ObservationKind`. `OrchAlert.tier` must equal `tierOf(score)` from `@ds`; `Observation.freshness` follows `0.5 ^ (age / halfLifeS)` and is 1 while `live`.

React usage:

- `useSim()` from `@/sim` owns an engine instance and re-renders on its throttled updates. REV B shape: `{ engine: SimEngineB, state: SimSnapshotB, version, paused, speed, setPaused, setSpeed, accept, dismiss, reset, ask(text), ackAlert(id), approveMovement(id), rejectMovement(id) }`. `useSimEngine()` returns the `SimEngineB`. See `src/sim/index.ts` for the exact shape.
- `TacticalMap` from `@/dashboard/map` renders the snapshot (terrain, contours, fuel, fire, forecast, units, markers, grid, and in REV B coverage cells, approximate-location observations and movement routes) according to `MapLayers`. Props: `{ layers, selectedId?, onSelect?(id | null), className?, mode?: 'ortho' | 'oblique', focus?: { pos: Vec; zoom?: number; key: string } | null, highlightId? }`. `focus` flies the camera whenever `key` changes (use the alert id). Built-in map controls sit bottom-right; the left edge is reserved for the dashboard `IconRail`.
- `CameraView` from `@/dashboard/map`: `{ feedId, variant?: 'thumb' | 'full', className? }` renders a simulated live camera for a `CameraFeed` and fills its parent. Put it inside a `FeedTile`.
- The grid is mutated in place for performance. Consumers must treat the snapshot as read-only and key caches off `grid.version` and `forecastRev`.

## REV C console contract

`src/console/contracts.ts` is the single source of truth for the console and the future backend (`docs/BACKEND_CONTRACT.md` mirrors it). Additive changes only: add optional fields or new union members; never rename or remove. Consumers ignore unknown fields and event types.

- **Scenario pack** — `ScenarioPack`: `manifest` (bbox, center, start/end, tz, places, sources, disclaimer), `raster` (`RasterMeta`, row 0 = north), `elevation`, `fuel` (`FuelClass`), `arrival` (fire time of arrival, ms since start), `perimeters`, `hotspots`, `weather`, `roads`, `buildings`, `water`, `imagery?`.
- **World** — `Unit`, `Finding` (freshness `0.5 ^ (age / halfLifeS)`, 1 while `live`), `Projection` (bands at 60/180/360 min, `etaToPlaces`), `Feed`.
- **Attention** — `ScoreFactors`, `Zone` + `ZONE_CAPACITY` (Z0 1, Z1 1, Z2 3, Z3 3, Z4 40, Z5 ∞), `GradedItem`, `Directive`. Score and placement rules: `docs/ORCHESTRATOR.md`.
- **Work** — `Action` (+ `Draft`), `AgentPool`, `AgentJob`, `Ledger`, `Message`, `Brief`.
- **Bus** — `BusEvent`: `source.ingested`, `analysis.job`, `analysis.finding`, `projection.updated`, `orchestrator.graded`, `ui.directive`, `action.proposed`, `action.decided`, `brief.updated`, `message`, `ledger.entry`. A real backend publishes the same events over WebSocket (`src/console/bus/adapters.ts`).
- **State** — `ConsoleState` and `ConsoleApi` (store hook).

Module APIs:

- `src/console/scenario/load.ts` → `loadScenario(): Promise<ScenarioPack>`. `src/console/scenario/geo.ts` → `geoToCell`, `cellToGeo`, `elevationAt`, `isBurnedAt`, `fireFieldAt` (0 unburned, 1 active edge, 2 burned), `distanceM`, `bearingDeg`, `destination`, `nearestRoadPath`.
- `src/console/store.tsx` → `ConsoleProvider`, `useConsole()`, `useConsoleSelector(sel)`, `useConsoleApi()`, `bus` (`subscribe`, `publish`, `history`).
- `src/console/stage3d/index.ts` → `<Stage />`, `<FeedSurface feedId variant="thumb" | "full" />`, `getStageCapabilities()`.
- `src/design-system/components/console.tsx` → console components exported from `@ds` (catalog in `DESIGN_SYSTEM.md` §11, console section).

Ownership map (one owner per path; change another owner's files only through the integrator):

| Path | Owner |
|---|---|
| `src/console/contracts.ts` | Integrator (additive changes on request) |
| `src/console/scenario/**`, `scripts/**`, `public/data/**` | DATA |
| `src/console/store.tsx`, `src/console/bus/**`, `src/console/world/**`, `src/console/agents/**`, `src/console/orchestrator/**`, `src/console/director/**` | BRAIN |
| `src/console/stage3d/**` | STAGE |
| `src/console/ConsoleApp.tsx`, `src/console/main.tsx`, `src/console/ui/**`, `src/design-system/components/console.tsx` | UI |
| `docs/**`, `README.md`, `AGENTS.md`, `DESIGN_SYSTEM.md` (console sections), proposal sections `Nav`, `Hero`, `Footer`, `Stack`, `Architecture`, `DashboardSection` | DOCS |
| `public/rev-a/**`, `public/rev-b/**` | Frozen, nobody |

Console rules on top of the hard rules: the 3D stage dominates; at most one Z0 interrupt; one theme-accent focal element per view; the simulation disclaimer is always visible; no gore or fictional casualty claims. Attributed historical facts may retain differing source totals. People in the tour are fictional; rescue completion depends on manual approval. High-risk drafts never execute without a human click, including in Director mode.

## PR checklist

- [ ] `npm run build` passes with zero TypeScript errors.
- [ ] No hardcoded hex/rgb colors in `.tsx` files (search for `#` followed by hex digits).
- [ ] Only tokens and Tailwind utilities from `tailwind.config.ts`; no ad-hoc shadows, radii or fonts.
- [ ] `signal` used for at most one focal element per view.
- [ ] Labels are mono uppercase; numbers are tabular; times are Zulu; coordinates use `fmtLat`/`fmtLon`.
- [ ] Interactive elements are keyboard reachable with visible focus; icon-only buttons have labels.
- [ ] Animations respect `prefers-reduced-motion`.
- [ ] New components are exported from `@ds`, shown in the `#system` showcase, and documented in `DESIGN_SYSTEM.md`.
- [ ] `src/sim/types.ts` changes are additive only.
- [ ] Alerts are placed by tier (`tierOf`), at most one interrupt is visible, and non-live findings fade by freshness.
- [ ] `public/rev-a/` and `public/rev-b/` are untouched.
- [ ] No new dependencies. The proposal site makes no external network requests; the console works with no tokens and no network beyond `/data/caldor/`.
- [ ] `src/console/contracts.ts` changes are additive only and mirrored in `docs/BACKEND_CONTRACT.md`.
