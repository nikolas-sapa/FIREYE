# AGENTS.md — operating rules for AI agents

FCC (Fire Command Center) is a single-page proposal and live prototype: an AI-native command console for firefighting drones and first responders, running on a simulated incident. Read this file, then `DESIGN_SYSTEM.md`, before you change anything.

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

Page anchors: `#top` (hero), `#architecture`, `#dashboard` (live ops console), `#system` (design system showcase).

## Directory map

```
DESIGN_SYSTEM.md            canonical design reference (tokens, components, patterns, recipes)
AGENTS.md                   this file
README.md                   project intro
tailwind.config.ts          tokens wired into Tailwind utilities
src/main.tsx                React entry
src/App.tsx                 page composition (Nav, Hero, Architecture, DashboardSection, DesignSystemSection, Footer)
src/index.css               fonts, base layer, .fcc-* utility classes, reduced-motion rule
src/design-system/          the design system, imported as '@ds'
  tokens/                   tokens.css (source of truth) + index.ts (JS mirror: color, role, toneClass, Tone, ...)
  primitives/               Brackets, Frame, Label, Serial, Ruler, Crosshair, RegMark, Hatch, GridBg, Rule, Dot, Datum
  components/               Button, Panel, Metric, Table, Alert, UnitChip, ... (catalog in DESIGN_SYSTEM.md §11)
  icons/                    Icon, iconNames, IconName
  utils.ts                  cn, pad, fmtLat, fmtLon, zulu
src/sim/                    simulation engine; types.ts is the shared contract
src/dashboard/              live ops console panels
src/dashboard/map/          TacticalMap renderer (canvas)
src/sections/               page sections
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
- `MapLayers` / `DEFAULT_LAYERS`: layer toggles for the map.

React usage:

- `useSim()` from `@/sim` owns an engine instance and re-renders on its throttled updates; it exposes the current snapshot and the engine controls. See `src/sim/index.ts` for the exact return shape.
- `TacticalMap` from `@/dashboard/map` renders the snapshot (terrain, contours, fuel, fire, forecast, units, markers, grid) according to `MapLayers`.
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
- [ ] No new dependencies, no external network requests.
