# AGENTS.md — operating rules for AI agents

FCC (Fire Command Center) is a single-page proposal and live prototype: an Orchestrator-first command console for fire departments and first responders, running on a simulated incident. Read this file, then `DESIGN_SYSTEM.md`, before you change anything.

## Revisions

- **REV B (current)** — Orchestrator-first. A calm default console (map, command bar, Orchestrator dock) with progressive disclosure through an icon rail and drawers. Every finding is graded 0–100 and placed by tier (`DESIGN_SYSTEM.md` section 13).
- **REV A (frozen)** — the original dashboard-first proposal. A built copy lives in `public/rev-a/` (served at `/rev-a/index.html`) and the source is git tag `rev-a`. Never edit `public/rev-a/`; to inspect REV A source use `git show rev-a:<path>` or `git worktree add /tmp/fcc-rev-a rev-a`.
- A new revision gets: a git tag for the previous one, a frozen build under `public/rev-<x>/`, bumped serials (Hero strip, Nav, Footer revision history, `FCC-DS / REV X`), and a note here.

## Stack

- Vite 5, React 18, TypeScript (strict, `noUnusedLocals`, `noUnusedParameters`), Tailwind CSS 3.4.
- Fonts: Inter Tight Variable and JetBrains Mono Variable, self-hosted via `@fontsource-variable/*`.
- No other runtime dependencies. All map, terrain, imagery and data are generated procedurally in the browser. No external APIs, tiles or CDNs.

## Commands

```bash
npm install          # install deps
npm run dev          # dev server → http://localhost:5173
npm run build        # tsc --noEmit && vite build (must pass before you finish)
npm run typecheck    # tsc --noEmit only
npm run preview      # serve the production build
```

Page anchors: `#top` (01 hero), `#architecture` (02), `#stack` (03 vendors and open questions), `#dashboard` (04 live ops console), `#system` (05 design system showcase). REV A archive: `/rev-a/index.html`.

## Directory map

```
DESIGN_SYSTEM.md            canonical design reference (tokens, components, patterns, recipes)
AGENTS.md                   this file
README.md                   project intro
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
- [ ] `public/rev-a/` is untouched.
- [ ] No new dependencies, no external network requests.
