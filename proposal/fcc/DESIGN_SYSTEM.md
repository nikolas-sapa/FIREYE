# FCC Design System

**FCC-DS / REV C · 2026-11-14 · Fire Command Center**

REV C adds the full-screen console (`/console.html`): console layout and patterns (section 13A) and 10 console components (section 11, "Console components"). REV B added the Orchestrator-first patterns (section 13) and 12 components. REV B is archived at `public/rev-b/` and git tag `rev-b`; REV A at `public/rev-a/` and git tag `rev-a`.

This is the canonical reference for building any FCC surface. Read it before writing UI. If something you need is not here, add it to the system (tokens, primitive or component), then document it here; do not invent one-off styles inside a feature.

Live reference: `src/sections/DesignSystemSection.tsx`, rendered at **http://localhost:5173/#system** (section 05) (`npm run dev`). When this document and the showcase disagree on a visual detail, the code in `src/design-system/` is the source of truth; fix whichever is stale.

---

## Contents

1. [Thesis](#1-thesis)
2. [Principles](#2-principles)
3. [Color](#3-color)
4. [Semantic roles and tones](#4-semantic-roles-and-tones)
5. [Typography](#5-typography)
6. [Spacing and layout](#6-spacing-and-layout)
7. [Radii, elevation, z-index](#7-radii-elevation-z-index)
8. [Motion](#8-motion)
9. [Textures and micrographics](#9-textures-and-micrographics)
10. [Iconography](#10-iconography)
11. [Component catalog](#11-component-catalog)
12. [Domain patterns](#12-domain-patterns)
13. [Orchestrator patterns (REV B)](#13-orchestrator-patterns-rev-b)
13A. [Console patterns (REV C)](#13a-console-patterns-rev-c)
14. [Content and voice](#14-content-and-voice)
15. [Accessibility](#15-accessibility)
16. [File map](#16-file-map)
17. [Recipes](#17-recipes)

---

## 1. Thesis

FCC is an instrument, not a website. The look is **micrographic brutalism**: the restraint of Apple hardware, the operational density of Anduril Lattice, the industrial labeling of Teenage Engineering and Nothing, and the HUD vocabulary of *Ghost in the Shell*.

Three ideas drive everything:

- **Macro calm, micro density.** Large areas are empty, dark and quiet. Detail is concentrated in small, precise places: a tick ruler, a serial tag, a coordinate readout, a corner bracket.
- **One accent.** Fire orange (`signal`) is the only brand color. It marks the single most important thing on screen: the primary action, the active selection, the current index. Status hues (ember, amber, phosphor, ice, violet) carry meaning, never decoration.
- **Hairlines, not boxes.** Structure comes from 1px rules on near-black graphite. No gradients as decoration, no glass, no blobs, no soft bubbly shapes, no emoji.

The reference feel: a spec sheet for a piece of mission hardware that happens to be interactive.

## 2. Principles

1. **Function first, then precision.** Every mark should mean something: a unit, a reading, an index, a boundary. Decoration is allowed only if it reads as instrumentation (rulers, registration marks, serials).
2. **Signal budget under 5%.** On any screen, `signal` pixels should be under 5% of the area. If two things are orange, one of them is wrong.
3. **Square by default.** Corners are 0 to 2px. `rounded-pill` is reserved for live-pulse rings and the `Dot` live animation.
4. **Mono for machines, grotesk for humans.** Labels, data, units, timestamps and codes are mono uppercase. Headlines and prose are Inter Tight in sentence case.
5. **Tabular numbers everywhere data changes.** Readouts must not jitter as values tick.
6. **Mechanical motion.** Things move like servos: fast start, firm stop. No bounce, no overshoot, nothing that loops without meaning.
7. **Dark ops.** The UI must be usable at night in a command vehicle. No large bright fills. Bone text on graphite.
8. **Tokens only.** Never hardcode hex in components. Use Tailwind utilities generated from tokens, or `color`/`role` from `@ds` when you must pass raw values to canvas/WebGL.

---

## 3. Color

All colors are defined once in `src/design-system/tokens/tokens.css` as space-separated RGB channels and exposed as Tailwind colors with alpha support (`bg-signal/20` → `rgb(var(--signal) / 0.2)`). The JS mirror is `color` in `src/design-system/tokens/index.ts`. Keep both in sync.

Contrast ratios are WCAG 2.x, measured against `ink-950` (`#0A0A0B`), the app background.

### 3.1 Surfaces (ink ramp, cool-neutral graphite)

| Token | Hex | CSS var | Tailwind | Role | Usage |
|---|---|---|---|---|---|
| void | `#050506` | `--void` | `bg-void` | Deepest well | Page backdrop behind the app, footer, map letterbox. |
| ink-950 | `#0A0A0B` | `--ink-950` | `bg-ink-950` | App background | Default page and section background. |
| ink-900 | `#0F0F11` | `--ink-900` | `bg-ink-900` | Panel | `Frame`, `Panel`, `Card` default surface. |
| ink-850 | `#141417` | `--ink-850` | `bg-ink-850` | Raised panel | Nested modules inside a panel, popovers, tooltips. |
| ink-800 | `#1A1A1E` | `--ink-800` | `bg-ink-800` | Control fill | Inputs, secondary buttons, segmented tracks. |
| ink-700 | `#242429` | `--ink-700` | `bg-ink-700` | Hover fill | Hover state of controls and rows. |
| ink-600 | `#34343A` | `--ink-600` | `bg-ink-600` / `border-ink-600` | Strong rule | Scrollbar thumb, wireframe meshes, dot grid dots. |
| ink-500 | `#4E4E56` | `--ink-500` | `text-ink-500` | Disabled text | Disabled text, inactive indices, registration marks. 2.4:1, decorative only. |
| ink-400 | `#6E6E76` | `--ink-400` | `text-ink-400` | Tertiary | Tick marks, inactive icons. 3.9:1, not for body text. |
| ink-300 | `#929298` | `--ink-300` | `text-ink-300` | Secondary | Major ruler ticks, secondary glyphs. 6.4:1. |
| ink-200 | `#BEBDBA` | `--ink-200` | `text-ink-200` | Neutral light | Rare. Light neutral strokes on imagery. |
| ink-100 | `#DEDCD7` | `--ink-100` | `text-ink-100` | Neutral lightest | Rare. |

### 3.2 Foreground (warm bone)

| Token | Hex | CSS var | Tailwind | Role | Contrast | Usage |
|---|---|---|---|---|---|---|
| bone | `#E8E6E1` | `--bone` | `text-bone` | Primary text | 15.9:1 | Headlines, primary values, active labels. |
| bone-dim | `#B0AEA8` | `--bone-dim` | `text-bone-dim` | Body secondary | 8.9:1 | Body copy, descriptions, ledes. |
| bone-mute | `#787773` | `--bone-mute` | `text-bone-mute` | Captions | 4.4:1 | Micro labels, captions, units. Fine for 9–11px mono uppercase labels (they are tracked and non-essential), not for paragraphs. |

### 3.3 Hairlines

| Token | Hex | CSS var | Tailwind | Usage |
|---|---|---|---|---|
| line-faint | `#1C1C20` | `--line-faint` | `border-line-faint`, `bg-line-faint` | Background grids (`fcc-linegrid`), inner row dividers on dense tables. |
| line | `#28282D` | `--line` | `border-line`, `bg-line`, `divide-line` | The default 1px rule. Panel borders, section dividers, gap-px grids. |
| line-strong | `#404046` | `--line-strong` | `border-line-strong` | Emphasized rules, control borders, bracket corners, focus frames on non-signal elements. |

### 3.4 Signal (the one accent)

| Token | Hex | CSS var | Tailwind | Contrast | Usage |
|---|---|---|---|---|---|
| signal | `#FF5A1F` | `--signal` | `text-signal`, `bg-signal`, `border-signal` | 6.3:1 | Primary button fill, active nav/tab underline, current index numerals, selected state, focus outline. |
| signal-hot | `#FF8A4C` | `--signal-hot` | `bg-signal-hot` | 8.5:1 | Hover of signal fills, glow cores, ember sparks. |
| signal-deep | `#C23A0C` | `--signal-deep` | `bg-signal-deep` | | Pressed state of signal fills, burn scar outlines. |
| signal-wash | `#2E140C` | `--signal-wash` | `bg-signal-wash` | | Tinted background for a selected row or recommended card. Prefer `bg-signal/10` for overlays. |

**Signal budget.** `signal` is under 5% of pixels on any screen. Text on a signal fill is `text-ink-950` (6.3:1). Use signal for exactly one of: the primary action, the selected item, the current step. Do not use it for status (use the status colors) or for decoration.

### 3.5 Status colors (meaning only)

| Token | Hex | CSS var | Tailwind | Contrast | Meaning |
|---|---|---|---|---|---|
| ember | `#FF3B30` | `--ember` | `text-ember`, `bg-ember/10`, `border-ember/50` | 5.6:1 | Danger, critical, the active fire front. |
| amber | `#FFB800` | `--amber` | `text-amber` | 11.4:1 | Warning, caution, forecast/projection, simulated data. |
| phosphor | `#3DDC84` | `--phosphor` | `text-phosphor` | 11.1:1 | Nominal, online, contained, accepted. |
| ice | `#5CC8FF` | `--ice` | `text-ice` | 10.5:1 | Drones, AI output, telemetry, water. |
| violet | `#A88CFF` | `--violet` | `text-violet` | 7.4:1 | Human detections, points of interest. |

Rules:
- Status colors appear as text, 1px strokes, small dots, and 10% tinted fills (`bg-ember/10`). Never as large solid fills.
- `ember` and `signal` are both warm. Keep them apart: `signal` is "the thing you act on", `ember` is "the thing that is dangerous". A danger button uses `ember`, not `signal`.
- Never rely on color alone; pair with a label, icon or shape (see Accessibility).

---

## 4. Semantic roles and tones

Pick color by meaning, never by hue.

### 4.1 `role` (raw hex for canvas/WebGL/SVG data viz)

```ts
import { role } from '@ds';
role.accent        // #FF5A1F signal
role.danger        // #FF3B30 ember
role.warning       // #FFB800 amber
role.nominal       // #3DDC84 phosphor
role.telemetry     // #5CC8FF ice
role.detection     // #A88CFF violet
role.fireFront     // #FF3B30 ember
role.fireForecast  // #FFB800 amber
role.burnScar      // #2A1610 (dark ember-brown, map-only)
role.drone         // #5CC8FF ice
role.crew          // #E8E6E1 bone
role.water         // #5CC8FF ice
```

### 4.2 `Tone` and `toneClass` (Tailwind fragments for components)

`Tone = 'neutral' | 'signal' | 'danger' | 'warning' | 'nominal' | 'telemetry' | 'detection'`

| Tone | text | bg | border | dot | Use for |
|---|---|---|---|---|---|
| neutral | `text-bone-dim` | `bg-ink-800` | `border-line-strong` | `bg-ink-300` | Default, informational. |
| signal | `text-signal` | `bg-signal/10` | `border-signal/50` | `bg-signal` | The selected or recommended item. |
| danger | `text-ember` | `bg-ember/10` | `border-ember/50` | `bg-ember` | Critical alerts, fire front, P1. |
| warning | `text-amber` | `bg-amber/10` | `border-amber/50` | `bg-amber` | Caution, forecasts, P2. |
| nominal | `text-phosphor` | `bg-phosphor/10` | `border-phosphor/40` | `bg-phosphor` | Online, contained, accepted. |
| telemetry | `text-ice` | `bg-ice/10` | `border-ice/40` | `bg-ice` | Drones, AI, sensor data. |
| detection | `text-violet` | `bg-violet/10` | `border-violet/40` | `bg-violet` | Persons, POIs. |

```tsx
import { toneClass, cn, type Tone } from '@ds';
const t = toneClass[tone];
<span className={cn('border px-1.5 font-mono text-micro uppercase', t.text, t.border, t.bg)}>…</span>
```

Domain mappings that recur:

| Domain value | Tone |
|---|---|
| Severity `critical` / `high` | `danger` |
| Severity `med` | `warning` |
| Severity `low` | `neutral` |
| Priority `P1` / `P2` / `P3` | `danger` / `warning` / `neutral` |
| Insight `alert` | `danger` |
| Insight `forecast` | `warning` |
| Insight `recommendation` | `signal` |
| Insight `analysis` | `telemetry` |
| Insight `status` | `nominal` |
| Marker `human` | `detection` |
| Marker `hazard` / `fuel` | `warning` |
| Marker `structure` | `neutral` |
| Marker `water` | `telemetry` |
| Unit status `active` / `enroute` / `standby` / `rtb` | `nominal` / `telemetry` / `neutral` / `warning` |

---

## 5. Typography

### 5.1 Families

| Family | Tailwind | Stack | Use |
|---|---|---|---|
| Inter Tight Variable | `font-sans` (default) | `"Inter Tight Variable", ui-sans-serif, system-ui, sans-serif` | Headlines, titles, prose. Sentence case. |
| JetBrains Mono Variable | `font-mono` | `"JetBrains Mono Variable", ui-monospace, SFMono-Regular, monospace` | Labels, data, codes, timestamps, coordinates, buttons. Uppercase for labels. |

Both are self-hosted via `@fontsource-variable/*` (imported in `src/index.css`). Never load fonts from a CDN.

### 5.2 Scale

Line heights and tracking are baked into the Tailwind font sizes; do not override them unless you have a reason.

| Token | Class | Size / line | Tracking | Use |
|---|---|---|---|---|
| 6xl | `text-6xl` | 120 / 112 | -0.045em | Hero display only. One per page. |
| 5xl | `text-5xl` | 80 / 80 | -0.035em | Section display. |
| 4xl | `text-4xl` | 56 / 58 | -0.03em | Section title. |
| 3xl | `text-3xl` | 40 / 44 | -0.025em | Large readouts (KPI numerals, mono). |
| 2xl | `text-2xl` | 28 / 34 | -0.02em | Panel hero numbers, sub-section titles. |
| xl | `text-xl` | 22 / 30 | -0.015em | Card titles. |
| lg | `text-lg` | 18 / 26 | -0.01em | Lead paragraph. |
| base | `text-base` | 15 / 24 | | Body copy. |
| sm | `text-sm` | 13 / 20 | | Dense UI body, table cells. |
| xs | `text-xs` | 12 / 16 | | Secondary UI. |
| tiny | `text-tiny` | 11 / 16 | 0.06em | Mono data values, coordinates. |
| nano | `text-nano` | 10 / 14 | 0.12em | Mono labels, uppercase, tracked. Button text (md). |
| micro | `text-micro` | 9 / 12 | 0.14em | Micrographic annotations, serials, rulers. |

The scale is also exported as `type` from `@ds` (array of `{ token, px, use }`).

### 5.3 Text utility classes (`src/index.css`)

| Class | Definition | Use |
|---|---|---|
| `.fcc-label` | `font-mono text-nano uppercase text-bone-mute` | Field labels, panel meta, column headers. |
| `.fcc-micro` | `font-mono text-micro uppercase text-bone-mute` | Annotations, serials, legends, caption strips. |
| `.fcc-data` | `font-mono text-tiny tabular-nums text-bone` | Inline data values. |
| `.fcc-num` | `tabular-nums slashed-zero` | Add to any number that updates. |

### 5.4 Rules

- `micro`, `nano`, `tiny` are always `font-mono`. `micro`/`nano` are always uppercase.
- Headlines use `font-medium` (500). Never bold (700) for display sizes; Inter Tight gets heavy fast. Use `font-light` only for giant decorative numerals in `ink-600`.
- Headlines are sentence case and end with a period when they are statements ("Command the fire.").
- Highlight at most one word of a headline in `text-signal`.
- Max line length for prose: `max-w-md` to `max-w-2xl` (about 60–75 characters).
- Numbers that change: `fcc-num` (or `tabular-nums`). Units are smaller and muted: `42<span className="ml-1 text-nano text-bone-mute">S</span>`.
- Do not letter-space sans text manually; the scale already tightens large sizes.

---

## 6. Spacing and layout

### 6.1 Spacing scale (4px grid)

Exported as `space` from `@ds` (keys are Tailwind steps, values in px).

| Step | px | | Step | px |
|---|---|---|---|---|
| 0.5 | 2 | | 6 | 24 |
| 1 | 4 | | 8 | 32 |
| 1.5 | 6 | | 10 | 40 |
| 2 | 8 | | 12 | 48 |
| 3 | 12 | | 16 | 64 |
| 4 | 16 | | 20 | 80 |
| 5 | 20 | | 24 | 96 |
| | | | 30 | 120 |

Extra Tailwind spacing tokens: `px2` (2px), `4.5` (18px), `13` (52px), `15` (60px), `18` (72px), `30` (120px).

Guidance: 4–12px inside components (micro density), 24–48px between components, 96–128px between page sections (`py-24 lg:py-32`).

### 6.2 Page layout

- **Rail:** content max width 1440px (`--rail`). Always `mx-auto max-w-[1440px] px-6 lg:px-10`.
- **Gutter:** 24px (`--gutter`), `gap-6`.
- **Grid:** 12 columns (`grid-cols-12 gap-6`). Editorial sections use a 3 / 9 split (index column / content), as in `SectionHeader`.
- **Sections:** full-bleed background, `border-b border-line`, content inside the rail. Section ids: `top`, `architecture`, `dashboard`, `system`.
- **Nav:** sticky, 48px (`h-12`). Hero uses `min-h-[calc(100svh-3rem)]` to fill the remaining viewport.

### 6.3 Hairline grids

To get shared 1px dividers between cells, use the gap-px technique instead of per-cell borders:

```tsx
<div className="grid grid-cols-4 gap-px border border-line bg-line">
  {items.map((i) => <div key={i.id} className="bg-ink-950 p-6">…</div>)}
</div>
```

### 6.4 Panel anatomy

```
 ┌─ bracket                                                   bracket ─┐
 ┌──────────────────────────────────────────────────────────────────────┐
 │ 03  PANEL TITLE                      META · 12 ITEMS    [act] [act] │  header: h-9, px-3, border-b line
 ├──────────────────────────────────────────────────────────────────────┤     index = signal mono nano
 │                                                                      │     title = bone mono nano upper
 │   body (p-3 dense / p-4 default)                                     │     meta  = bone-mute mono micro
 │                                                                      │
 │   LABEL            LABEL            LABEL                            │  Datum / Metric rows
 │   42.0 KM²         18%              3.2 M/MIN                        │
 │                                                                      │
 └──────────────────────────────────────────────────────────────────────┘
   bg-ink-900 · border border-line · square corners · optional Brackets
```

---

## 7. Radii, elevation, z-index

### 7.1 Radii (exported as `radius`)

| Token | Class | px | Use |
|---|---|---|---|
| none | `rounded-none` | 0 | Default for everything. |
| hair | `rounded-hair` | 1 | Tiny chips, kbd caps. |
| xs | `rounded-xs` | 2 | Maximum for controls. |
| sm | `rounded-sm` | 3 | Rare. |
| DEFAULT | `rounded` | 4 | Avoid. |
| md / lg | `rounded-md` / `rounded-lg` | 6 / 10 | Avoid in UI. |
| pill | `rounded-pill` | 999 | Live pulse rings only. |

### 7.2 Elevation (shadow tokens only)

| Class | Definition | Use |
|---|---|---|
| `shadow-inset` | inset 1px `line` ring | Wells, map frames, inputs without a border. |
| `shadow-panel` | 1px `line` ring + soft deep drop | Floating panels over the map. |
| `shadow-lift` | 1px `line-strong` ring + deeper drop | Modals, popovers, dragged items. |
| `shadow-signal` | 1px signal ring + signal glow | The one selected/armed item (for example, a pending P1 recommendation). |

No other shadows. Do not use `shadow-md`, `shadow-xl`, etc.

### 7.3 Z-index (exported as `z`)

| Class | Value | Layer |
|---|---|---|
| `z-base` | 0 | Page content. |
| `z-raised` | 10 | Overlapping content inside a section (hero text over the visual). |
| `z-overlay` | 40 | Map HUD overlays, dropdowns. |
| `z-hud` | 50 | Sticky nav, persistent HUD bars. |
| `z-modal` | 80 | Modal and its scrim. |
| `z-toast` | 90 | Toasts and transient alerts. |

---

## 8. Motion

Motion is mechanical, short and purposeful. It confirms an action or reveals a change; it never entertains.

### 8.1 Easing (exported as `motion.ease`)

| Name | Class | Curve | Use |
|---|---|---|---|
| servo | `ease-servo` | `cubic-bezier(0.2, 0, 0, 1)` | Default for UI state: hover, select, toggles, underline slides. |
| snap | `ease-snap` | `cubic-bezier(0.7, 0, 0.2, 1)` | Symmetric moves: scanning sweeps, packets, tab indicators crossing. |
| settle | `ease-settle` | `cubic-bezier(0.16, 1, 0.3, 1)` | Entrances: panels, list items, toasts arriving. |

### 8.2 Duration (exported as `motion.duration`)

| Name | Class | ms | Use |
|---|---|---|---|
| instant | `duration-instant` | 80 | Press feedback, color flips. |
| quick | `duration-quick` | 140 | Hover, focus, small toggles. |
| base | `duration-base` | 220 | Selection, tab change, underline. |
| slow | `duration-slow` | 420 | Panel entrance, step highlight. |
| drift | `duration-drift` | 900 | Ambient map changes, forecast morphs. |

### 8.3 Animations

| Class | Use |
|---|---|
| `animate-sweep` | Indeterminate scan bar (analyzing state). |
| `animate-blink` | Cursor or REC indicator. Use once per screen at most. |
| `animate-pulse-ring` | Live dot ring (`<Dot live />`), new human detection. |
| `animate-rise` | Entrance of new feed items, alerts, insights. |

### 8.4 Rules

- Animate `transform` and `opacity`. Avoid animating layout.
- No bounce, overshoot or spring wobble.
- Continuous loops only for genuinely live things (a live dot, a drone orbit, data packets on a schematic).
- **Reduced motion:** `src/index.css` globally collapses CSS animation and transition durations under `prefers-reduced-motion: reduce`. JS-driven animation (requestAnimationFrame, SMIL `<animate>`) is not covered by that rule: check `window.matchMedia('(prefers-reduced-motion: reduce)')` and freeze or skip it (see `useReducedMotion` in `src/sections/Hero.tsx`).
- Pause rAF loops when off-screen (IntersectionObserver).

---

## 9. Textures and micrographics

Micrographics are what make FCC feel like hardware. Use them at edges and in small sizes, never as large decoration.

### 9.1 Primitives (`src/design-system/primitives/index.tsx`)

| Primitive | Props | Use |
|---|---|---|
| `Brackets` | `size?=8`, `tone?: 'line' \| 'signal' \| 'bone'`, `inset?=0`, `className?` | Corner brackets on the four corners of a `relative` parent. |
| `Frame` | `brackets?=true`, `bracketTone?`, all div props | Base hairline surface (`border-line bg-ink-900`) with brackets. |
| `Label` | `index?`, `tone?: 'mute' \| 'bone' \| 'signal'`, `children` | Mono nano uppercase label; `index` renders a leading signal code ("01"). |
| `Serial` | `children` | Bordered part-number tag: `FCC-01 / REV A`. |
| `Ruler` | `ticks?=40`, `major?=5`, `orientation?`, `labels?`, `start?`, `step?` | Tick ruler for edges of visuals, maps and footers. |
| `Crosshair` | `size?=16`, `gap?=3` | Reticle mark at a point of interest or view center. |
| `RegMark` | `size?=14` | Registration mark (circle + cross) at sheet or section corners. |
| `Hatch` | `tone?: 'neutral' \| 'signal'` | Diagonal hatch block (no-go zones, disabled areas, burn scar). |
| `GridBg` | `variant?: 'dots' \| 'lines'` | Absolute background grid overlay inside a `relative` parent. |
| `Rule` | `title?`, `align?: 'left' \| 'center'` | Divider, optionally with a micro title ("02.1 — Signal path"). |
| `Dot` | `className?='bg-phosphor'`, `live?`, `size?=6` | Square status indicator; `live` adds a pulse ring. |
| `Datum` | `label`, `value`, `unit?`, `tone?` (a text class) | Micro label over a mono value. |

```tsx
import { Frame, Label, Serial, Ruler, RegMark, Crosshair, Rule, Dot, Datum, GridBg, Hatch, Brackets } from '@ds';

<Frame className="p-4">
  <div className="flex items-center justify-between">
    <Label index="03">Sensor net</Label>
    <Serial>FCC-SN / 14</Serial>
  </div>
  <Rule className="my-3" />
  <div className="flex gap-6">
    <Datum label="Temp" value="38.2" unit="°C" />
    <Datum label="RH" value="11" unit="%" tone="text-amber" />
  </div>
</Frame>

<div className="relative h-64 overflow-hidden border border-line">
  <GridBg variant="dots" />
  <Brackets size={12} tone="bone" />
  <Crosshair className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
</div>

<Ruler ticks={60} major={10} labels start={0} step={100} />
<Hatch className="h-6 w-full" tone="signal" />
<span className="flex items-center gap-2"><Dot live /> <span className="fcc-micro">Uplink</span></span>
```

### 9.2 CSS texture classes (`src/index.css`)

| Class | Look | Use |
|---|---|---|
| `.fcc-dotgrid` | 1px ink-600 dots on a 16px grid | Empty states, map backgrounds, showcase plates. |
| `.fcc-linegrid` | 1px line-faint grid, 48px | Section backgrounds (hero). |
| `.fcc-hatch` | -45° ink-600 hatch, 6px pitch | Disabled, unavailable, no-data areas. |
| `.fcc-hatch-signal` | -45° signal hatch at 35% | Exclusion zones, burn scar, "do not enter". |
| `.fcc-scanlines` | Faint horizontal scanlines | Over video/thermal thumbnails only. |

### 9.3 Micrographic vocabulary

- **Serials:** `FCC-01 / REV A`, `FCC-PRP-0001`, `SHEET 01/04`.
- **Indices:** two-digit section codes (`01`–`04`), dotted sub-indices (`02.1`), lettered prefixes for item families (`I-01` input, `M-01` module, `O-01` output, `C-01` capability, `L-01` loop step, `S-01` stat, `F-01` footer column).
- **Classification strip:** `FCC // PROPOSAL // UNCLASSIFIED // REV A · 2026-11-14` with `//` in `ink-500`.
- **Coordinates:** `38.9120°N 120.6840°W` via `fmtLat`/`fmtLon`.
- **Clocks:** `14:22:07Z` via `zulu()`; mission elapsed `T+02:14:08`.
- **Scale bars:** `0 — 1 KM` with a split bar.

---

## 10. Iconography

Icons live in `src/design-system/icons/index.tsx`.

```tsx
import { Icon, iconNames, type IconName } from '@ds';
<Icon name="drone" size={16} className="text-ice" />
<Icon name="alert" title="Critical alert" />   // title makes it an accessible image
```

`Icon` props: `name: IconName`, `size?: number = 16`, `strokeWidth?: number = 1.25`, `className?`, `title?` (accessible name; omitted = decorative, `aria-hidden`). Other SVG props pass through.

Rules:
- 24×24 grid, 2px live margin, 1.25 stroke, square caps, miter joins. Straight segments and 45° diagonals; curves only for physically round things.
- Stroke only, `currentColor`. Color via text classes (`text-bone-mute`, `text-ice`).
- Sizes: 12 (sm buttons), 14 (md buttons), 16 (default), 18–20 (card headers). Do not scale above 24 in UI.
- Keep stroke at 1.25 at all sizes. Never fill icons.
- An icon never stands alone for an action without a label or `IconButton` `label` (tooltip + aria-label).
- To add an icon: add the name to the `IconName` union and the glyph to `glyphs`, keep the grid rules, then it appears in the showcase automatically via `iconNames`.

Full name list (60):

| Group | Names |
|---|---|
| Units | `drone` `engine` `crew` `helo` `tanker` `dozer` |
| Fire and environment | `flame` `wind` `droplet` `thermometer` `hazard` `human` `structure` `tree` |
| Intel sources | `video` `image` `news` `sensor` `radio` `satellite` `ai` |
| Actions | `target` `layers` `play` `pause` `plus` `minus` `close` `check` |
| Navigation | `chevron-right` `chevron-down` `chevron-left` `arrow-up-right` `arrow-right` |
| Instruments | `locate` `compass` `eye` `clock` `signal` `battery` `route` `shield` |
| Utility | `alert` `search` `settings` `grid` `expand` `filter` `zap` `map` |
| Orchestrator (REV B) | `orchestrator` `agents` `log` `camera` `send` `sparkle` `animal` `combustible` `social` `web` |

---

## 11. Component catalog

All components live in `src/design-system/components/` and are exported from `@ds`. Every component accepts `className`. `Tone` is the type from section 4. See them live at `#system`.

### Button

| Prop | Type | Default |
|---|---|---|
| variant | `'primary' \| 'secondary' \| 'ghost' \| 'danger'` | `'secondary'` |
| size | `'sm' \| 'md' \| 'lg'` | `'md'` |
| icon / iconRight | `IconName` | |
| loading | `boolean` | `false` |
| kbd | `string` (shortcut hint) | |
| ...rest | `ButtonHTMLAttributes` | |

```tsx
<Button variant="primary" iconRight="arrow-right" onClick={accept}>Accept plan</Button>
<Button size="sm" icon="layers">Layers</Button>
<Button variant="danger" icon="close">Abort</Button>
<Button variant="ghost" kbd="K">Search</Button>
```
Do: one `primary` per view; mono uppercase short verbs ("Accept", "Dispatch"). Don't: use `primary` for navigation chrome, or put two primaries side by side. A primary without an icon shows a small square lead mark by design.

### IconButton

`{ icon: IconName; label: string; variant?: 'secondary' | 'ghost'; size?: 'sm' | 'md'; active?: boolean }` & button attributes.

```tsx
<IconButton icon="expand" label="Fullscreen map" />
<IconButton icon="layers" label="Toggle layers" active={open} variant="ghost" size="sm" />
```
Do: always pass a meaningful `label` (becomes `aria-label` and `title`). `active` renders the signal-tinted pressed state.

### Badge

`{ tone?: Tone; variant?: 'solid' | 'outline' | 'soft'; dot?: boolean; children }`

```tsx
<Badge tone="danger">P1</Badge>
<Badge tone="telemetry" variant="soft" dot>EO/IR</Badge>
```
Do: 1–3 word mono labels. Don't: use `solid` for anything other than the single most urgent item.

### StatusPill

`{ status: 'nominal' | 'warning' | 'danger' | 'offline' | 'telemetry'; live?: boolean; children? }`

```tsx
<StatusPill status="nominal" live>Uplink</StatusPill>
<StatusPill status="danger">Red flag</StatusPill>
```
Use for system and link state. `live` adds the pulse; at most one or two live pills per screen.

### Panel

`{ title?: ReactNode; index?: string; meta?: ReactNode; actions?: ReactNode; children; bodyClassName?: string; dense?: boolean; brackets?: boolean }`

```tsx
<Panel index="03" title="Intel feed" meta="24 ITEMS" actions={<IconButton icon="filter" label="Filter" size="sm" variant="ghost" />}>
  …
</Panel>
```
The workhorse container. See panel anatomy (6.4). Use `dense` inside the dashboard.

### Card

`{ children; interactive?: boolean; selected?: boolean; onClick? }`

```tsx
<Card interactive selected={sel === r.id} onClick={() => setSel(r.id)}>…</Card>
```
`selected` uses the signal border. Use for list items that are larger than a row (recommendations, ingest items).

### Tabs

`{ items: { id: string; label: string; count?: number }[]; value: string; onChange(id: string): void; size?: 'sm' | 'md' }`

```tsx
<Tabs items={[{ id: 'feed', label: 'Feed', count: 24 }, { id: 'recs', label: 'Plan', count: 3 }]} value={tab} onChange={setTab} />
```
Active tab gets a signal underline. Use for switching views within a panel.

### Segmented

`{ options: { value: string; label: ReactNode }[]; value: string; onChange(v: string): void; size?: 'sm' | 'md' }`

```tsx
<Segmented options={[{ value: '1', label: '1×' }, { value: '4', label: '4×' }, { value: '8', label: '8×' }]} value={speed} onChange={setSpeed} size="sm" />
```
Use for mutually exclusive modes with 2–5 short options (speed, view, horizon).

### Toggle

`{ checked: boolean; onChange(v: boolean): void; label?: ReactNode; size?: 'sm' | 'md' }`

```tsx
<Toggle checked={layers.forecast} onChange={(v) => setLayers({ ...layers, forecast: v })} label="Forecast" size="sm" />
```
Square track, not a rounded iOS pill.

### Slider

`{ value: number; min: number; max: number; step?: number; onChange(v: number): void; label?: string; unit?: string }`

```tsx
<Slider label="Horizon" value={h} min={60} max={360} step={60} unit="MIN" onChange={setH} />
```

### Input

`{ label?: string; hint?: string; prefix?: ReactNode; suffix?: ReactNode }` & input attributes.

```tsx
<Input label="Callsign" placeholder="HAWK-2" prefix={<Icon name="search" size={14} />} hint="Drones, engines, crews" />
```

### Select

`{ label?: string; options: { value: string; label: string }[]; value: string; onChange(v: string): void }`

```tsx
<Select label="Sector" value={sector} onChange={setSector} options={[{ value: 'n', label: 'North flank' }, { value: 'h', label: 'Head' }]} />
```

### Tooltip

`{ content: ReactNode; children; side?: 'top' | 'bottom' | 'left' | 'right' }`

```tsx
<Tooltip content="Rate of spread at the head"><span className="fcc-label">ROS</span></Tooltip>
```
Tooltips explain; they never hold the only copy of critical information.

### Alert

`{ tone?: Tone; title: ReactNode; children?; icon?: IconName; timestamp?: string; onClose?(): void }`

```tsx
<Alert tone="danger" icon="human" title="2 persons in fire path" timestamp="14:22:07Z" onClose={dismiss}>
  HAWK-2 EO/IR · Trailhead lot · Conf 0.87
</Alert>
```
See alert severity escalation (12.4).

### Table

`Table<T>` `{ columns: { key: string; header: ReactNode; align?: 'left' | 'right' | 'center'; width?: string | number; render?(row: T): ReactNode }[]; rows: T[]; rowKey(row: T): string; dense?: boolean; onRowClick?(row: T): void; selectedKey?: string }`

```tsx
<Table
  dense
  rows={units}
  rowKey={(u) => u.id}
  selectedKey={selected}
  onRowClick={(u) => setSelected(u.id)}
  columns={[
    { key: 'cs', header: 'Callsign', render: (u) => u.callsign },
    { key: 'st', header: 'Status', render: (u) => <Badge tone="nominal">{u.status}</Badge> },
    { key: 'bat', header: 'Bat', align: 'right', render: (u) => `${Math.round((u.battery ?? 0) * 100)}%` },
  ]}
/>
```
Mono headers (`fcc-label`), right-align numbers, hairline row dividers.

### Metric

`{ label: string; value: ReactNode; unit?: string; delta?: { value: string; trend: 'up' | 'down'; good?: boolean }; tone?: Tone; size?: 'sm' | 'md' | 'lg'; sub?: ReactNode; spark?: number[] }`

```tsx
<Metric label="Burned area" value="1,284" unit="AC" delta={{ value: '+42', trend: 'up', good: false }} spark={history.acres} />
<Metric label="Containment" value="18" unit="%" tone="nominal" size="sm" />
```
`good` decides delta color (phosphor vs ember), independent of direction.

### Sparkline

`{ data: number[]; width?: number; height?: number; tone?: Tone; fill?: boolean }`

```tsx
<Sparkline data={history.ros} tone="warning" width={96} height={24} />
```

### Gauge

`{ value: number /* 0..1 */; label?: string; valueLabel?: ReactNode; size?: number; tone?: Tone }`

```tsx
<Gauge value={0.18} label="Containment" valueLabel="18%" tone="nominal" />
```

### Progress

`{ value: number /* 0..1 */; tone?: Tone; segments?: number; label?: string; showValue?: boolean }`

```tsx
<Progress value={u.battery ?? 0} segments={10} tone="telemetry" label="Battery" showValue />
```
Segmented bars read as hardware; prefer `segments` for battery and water.

### Timeline

`{ items: { id: string; time: string; title: ReactNode; body?: ReactNode; tone?: Tone }[] }`

```tsx
<Timeline items={[{ id: 'a', time: '14:02Z', title: 'Spot fire across Ridge Rd', tone: 'danger' }]} />
```

### LogLine

`{ time: string; source: string; tone?: Tone; children }`

```tsx
<LogLine time="14:22:07Z" source="ARGUS" tone="telemetry">Forecast rev 12 · head +340 M / 1H</LogLine>
```
One line, mono, for radio/system logs.

### Modal

`{ open: boolean; onClose(): void; title: ReactNode; children; footer?: ReactNode }`

```tsx
<Modal open={open} onClose={close} title="Confirm dispatch" footer={<Button variant="primary" onClick={go}>Dispatch</Button>}>
  E-41 and E-43 to Ridge Rd anchor point. ETA 9 MIN.
</Modal>
```
`z-modal`, `shadow-lift`, square. Escape and scrim click close it.

### Kbd

`{ children }` — `<Kbd>⌘</Kbd><Kbd>K</Kbd>`

### UnitChip

`{ callsign: string; kind: 'drone' | 'engine' | 'crew' | 'helo' | 'tanker' | 'dozer'; status: 'active' | 'enroute' | 'standby' | 'rtb'; meta?: ReactNode; selected?: boolean; onClick? }`

```tsx
<UnitChip callsign="HAWK-2" kind="drone" status="active" meta="BAT 72%" selected={sel === 'HAWK-2'} onClick={() => setSel('HAWK-2')} />
```

### Legend

`{ items: { label: string; color: string /* css color */; shape?: 'square' | 'line' | 'dot' | 'hatch' | 'dash' }[]; direction?: 'row' | 'column' }`

```tsx
import { role } from '@ds';
<Legend items={[
  { label: 'Active front', color: role.fireFront, shape: 'line' },
  { label: '+3H forecast', color: role.fireForecast, shape: 'dash' },
  { label: 'Burn scar', color: role.burnScar, shape: 'hatch' },
]} />
```
`color` is the one place a raw color value is passed, and it must come from `role`/`color`, never a literal.

### Compass

`{ heading: number; size?: number; label?: string }` — `<Compass heading={wind.dirDeg} label="WIND" />`

### Confidence

`{ value: number /* 0..1 */; segments?: number; showValue?: boolean }` — `<Confidence value={0.87} showValue />`

Always show AI confidence next to AI claims (detections, forecasts, recommendations).

### SectionHeader

`{ index: string; eyebrow: string; title: ReactNode; lede?: ReactNode; meta?: ReactNode }`

```tsx
<SectionHeader index="02" eyebrow="Architecture" title={<>Every signal.<br /><span className="text-bone-mute">One picture.</span></>} lede="…" meta={<Serial>FCC-02 / Schematic</Serial>} />
```
Editorial header for proposal page sections: indexed rule on top, giant ink-600 index numeral, title on a 3/9 split.

### Orchestrator components (REV B)

All in `src/design-system/components/orchestrator.tsx`, exported from `@ds`. The types are local to the design system (`OrchTier`, `OrchAlertClass`, `OrchAudience`, `MovementStatus`) and are structurally identical to `AlertTier`, `AlertClass`, `Audience` and `MovementProposal['status']` in `src/sim/types.ts`, so sim values pass straight in. Helpers exported alongside: `TIER_BANDS`, `tierOf(score)`, `tierTone`, `alertTone(cls, tier)`, `alertClassTone`, `alertClassIcon`, `alertClassLabel`, `audienceLabel`. See section 13 for the rules they encode.

#### ScoreMeter

`{ score: number /* 0..100 */; size?: 'sm' | 'md'; showValue?: boolean = true }` — `<ScoreMeter score={alert.score} size="sm" />`

20 segments (5 points each), filled in the tier tone (`danger` ≥ 85, `warning` 60–84, `telemetry` 35–59, `neutral` < 35). Ticks under the bar at 35 / 60 / 85 mark the tier edges. Default widths: `w-28` (sm), `w-44` (md); pass a `w-*` class to override. `role="meter"`.

#### TierBadge

`{ tier: 0 | 1 | 2 | 3 }` — renders `T0 | INTERRUPT` (solid ember), `T1 | FOCUS` (amber outline), `T2 | AMBIENT` (ice soft), `T3 | LOG` (hairline, mute).

#### AlertCard

`{ cls; tier; score; title; body?; why?; time?; notify?: Audience[]; actions?; compact?; onClick?; selected? }`

```tsx
<AlertCard cls="life" tier={1} score={78} title="2 hikers near Pine Hollow trailhead" body="…" why="Life safety · +1H band · conf 0.81"
  time="14:32Z" notify={['fire', 'ems']} actions={<IconButton icon="locate" label="Locate" size="sm" variant="ghost" />} onClick={select} />
```
Left 2px rule and icon in `alertTone(cls, tier)`. Header: class label + `TierBadge` + time. Body: sans title, bone-dim body, `why` as a mono micro line with a `sparkle` (the Orchestrator's grading rationale). Footer: `ScoreMeter`, relay row (notified audiences lit, others struck through), actions on the right. `compact` = one 36px row (icon, title, score, time) for the dock count list and the log. Interactive when `onClick` is set (keyboard Enter/Space). `selected` = signal border + brackets.

#### InterruptBanner

`{ cls; title; body?; score; time?; notify?; onAck(); onLocate? }`

Tier-0 only. Max width 640px, ember top rule, live ember dot, `T0 INTERRUPT` strip with hatch, large score, relay row, `Locate` (secondary) and `Acknowledge` (primary, the one signal action). `role="alert"` + `aria-live="assertive"`. Place it absolutely, centered at the top of the map; render one at a time.

#### Freshness

`{ freshness: number /* 0..1 */; live?: boolean; age?: string }` — `<Freshness freshness={obs.freshness} age="14m ago" />` or `<Freshness live />`

Ice square + age text; opacity `0.35 + 0.65 f` and `grayscale(1 − f)`. Below 0.10 it shows a dashed hollow square and struck-through age (expired). `live` = phosphor pulsing dot + `LIVE`.

#### OrchBubble

`{ role: 'orchestrator' | 'user'; time?; children?; thinking? }` — Orchestrator: left aligned, ice left rule, `orchestrator` icon header. User: right aligned, ink-800 fill, `YOU`. `thinking` = three blinking ice squares (`role="status"`).

#### PromptChip

`{ children; onClick() }` — 28px suggestion chip with `sparkle` and an arrow. Sentence-case prompt text in sans. Use 2–4 below the thread.

#### Drawer

`{ open; onClose(); title; index?; side?: 'left' | 'right' = 'left'; width?: number = 360; offset?: number = 0; actions?; children }`

Absolutely positioned inside a `relative` parent (not a portal), full height, `z-overlay`, `shadow-lift`. Slides 16px and fades with `duration-slow ease-settle`; closed drawers are `invisible` and `aria-hidden`. `offset` moves it off the anchoring edge (pass the rail width, 48). Esc closes the drawer that holds focus. Header mirrors `Panel` (signal index, mono title, actions, close).

#### IconRail

`{ items: { id; icon: IconName; label; badge?: number | string; tone?: Tone }[]; value: string | null; onChange(id | null) }`

48px vertical rail, 48px square buttons with right-side tooltips and `aria-pressed`. Active = signal icon, signal/10 fill and a 2px signal edge. Clicking the active item calls `onChange(null)`. Badges: neutral by default, tone fill when `tone` is set; `0` or `''` hides the badge.

#### FeedTile

`{ label; live?; meta?; children /* video surface */; selected?; onClick? }` — `<FeedTile label="E-41 · DASH CAM" live meta="HDG 042°"><CameraView feedId={f.id} variant="thumb" /></FeedTile>`

16:9 media well (`bg-void`, scanlines) with the child filling it, label chip top-left, `LIVE` (ember dot) or `CLIP` top-right, optional 24px meta strip. Selected = signal border + brackets.

#### PoolBar

`{ label; provider; workers; maxWorkers; queue; meta? }` — one cell per worker slot; running = ice, idle = ink-800. When the pool is saturated (`workers == maxWorkers` and `queue > 0`) the cells and the queue count turn amber. Header: label, provider tag, `07/24`, `Q03`.

#### MovementCard

`{ title; group; windowLabel; trigger; reason?; score; status: 'proposed' | 'approved' | 'rejected' | 'executing' | 'done'; onApprove?; onReject?; onLocate? }`

Movement proposals from the Orchestrator. Signal left rule only while `proposed` (it is the pending decision); otherwise ink-500. Header: `route` icon, status (executing pulses), `ScoreMeter`. Body: title, group in mono, a `WINDOW / TRIGGER / REASON` spec list (trigger in amber). Footer: locate, `Reject` (ghost), `Approve` (primary), shown only while proposed. Rejected cards dim to 60%.
### Console components (REV C)

All in `src/design-system/components/console.tsx`, exported from `@ds`. Used by the full-screen console (`/console.html`, section 13A). The types are local to the design system (`ConsoleZone`, `ConsoleAudience`, `ConsoleAutonomy`, `ConsoleLens`, `ConsoleActionKind`, `ConsoleActionStatus`, `ConsoleDraftFormat`, `ConsoleDirectiveKind`, `ConsoleScoreFactors`) and are structurally identical to the matching types in `src/console/contracts.ts`, so store values pass straight in. Helpers exported alongside: `zoneMeta` (code, name, tone, where, capacity per zone), `actionKindIcon`, `actionKindLabel`, `consoleAudienceLabel`, `AudienceRow`.

#### ZoneTag

`{ zone: ConsoleZone; showName?: boolean = true }` — `<ZoneTag zone={item.zone} />` renders `Z3 · FOCUS` in the zone tone from `zoneMeta` (Z0 danger, Z1 nominal, Z2 warning, Z3 telemetry, Z4/Z5 neutral).

#### WhyPopover

`{ score; factors: ConsoleScoreFactors; reason: string; zone: ConsoleZone; placement?: ReactNode; title?: ReactNode }`

The "Why am I seeing this?" panel. Shows the reason line, one bar per multiplicative factor (severity, exposure, confidence, freshness, lens), the additive terms as signed points (corroboration, actionability, novelty, minus fatigue), the final score, the `ZoneTag`, and a placement sentence ("Placed in Z3 because …", built from zone and score unless `placement` is given). Open it on hover or click of a focus item. Numbers match `docs/ORCHESTRATOR.md`.

#### AutonomyDial

`{ value: ConsoleAutonomy; onChange(v); compact? }` — Advise / Assist / Act as a segmented hardware dial with a one-line description of what the Orchestrator may do at the selected level. `compact` for the command strip.

#### LensSelect

`{ value: ConsoleLens; onChange(v); showKeys?: boolean = true }` — IC / OPS / AIR / EMS segmented control; `showKeys` prints the `1`–`4` keyboard shortcuts.

#### TimelineScrubber

`{ start; end; t; onSeek?(t); ticks?: { t; label?; major? }[]; series?: { t; v }[]; marks?: { t; kind: 'ghost' | 'beat' | 'event' | 'perimeter'; label? }[]; projectionUntil?; format?(t); compact?; label? = 'Scenario time' }`

Scenario time axis: ticks (local midnights, 6 h steps), fire acres as a stepped area (`series`), real perimeter days and events as marks, projection ghosts, Director beat ticks, and the playhead. `projectionUntil` draws the projection window as an amber hatched range ahead of the playhead. Keyboard seekable when `onSeek` is set. `compact` for the command strip.

#### LedgerCounter

`{ label; value: number; unit?; format?(v); size?: 'sm' | 'md' | 'lg' = 'md'; tone?: Tone = 'neutral'; sub?: ReactNode }` — big tabular mono numeral with a micro label and a delta tick when the value increases. Use for footage reviewed, articles read, drafts written, analyst minutes saved.

#### DraftDocument

`{ format: ConsoleDraftFormat; title; fields: { label; value }[]; body: string; editable?; onChange?(body); serial?; status?; meta? }`

Document-style card for evacuation notices, radio scripts, ICS-209 sitreps, orders and rescue tasks: serial and format strip, fields table, plain-text body (a textarea when `editable`), and a `SIMULATED` watermark. Square, hairline-ruled, bone on ink; no signal color (the approve button that accompanies it carries the signal).

#### DirectiveToast

`{ kind: ConsoleDirectiveKind; title; reason?; time?; suggestion?: boolean; onUndo?; onHold?; onApply?; onDismiss?; ttlMs?: number = 0 }`

"Orchestrator moved camera to HAWK-3 · reason · Undo / Hold". One icon per directive kind (focusStage `locate`, promoteFeed `camera`, restoreStage `map`, openPanel `expand`, highlight `target`, dimOthers `eye`, requestDecision `check`, notify `send`). With `suggestion` (hold layout on) it reads as a suggestion with `Apply`. `ttlMs` draws the auto-fade countdown as a hairline; 0 disables it. Stack top-left over the stage.

#### CaptionBar

`{ beat; total; title; caption; progress?: number /* 0..1 */; beatMarks?: number[] /* 0..1 */; onPrev?; onNext?; onClose? }` — Demo Director caption at the bottom of the stage: beat `n/total`, title, one-sentence caption, progress rule with beat ticks, prev / next / close.

#### DecisionCard

`{ kind: ConsoleActionKind; title; summary?; risk: 'low' | 'high'; status: ConsoleActionStatus; audiences?; windowLabel?; trigger?; units?: string[]; drafted?: string; score?; compact?; primary?; onApprove?; onEdit?; onReject?; onUndo?; onLocate?; onExpand? }`

An action that needs a decision (Z2). Kind icon and label (`actionKindIcon`, `actionKindLabel`), title, summary, risk badge, status (tone: proposed warning, approved/done nominal, executing telemetry, rejected/undone neutral), relay row (`AudienceRow`), units, window and trigger (trigger in amber), "Orchestrator drafted · 12 s ago" (`drafted`), optional `ScoreMeter`. Footer: Approve / Edit / Reject while proposed, Undo after execution. `primary` makes Approve the one signal button on screen; set it on the top card only.
---

## 12. Domain patterns

### 12.1 Map symbology

The tactical map (`src/dashboard/map`) and every other map-like visual (hero, schematics) share this vocabulary. Use `role` hex values on canvas.

| Feature | Color | Shape / stroke | Notes |
|---|---|---|---|
| Active fire front | `ember` | 1.25px solid perimeter, 10% ember fill, faint 5px outer halo at 18% | The only solid warm line on the map. |
| Burning cells | `ember` → `signal-hot` by heat | Filled cells, hotter = brighter | |
| Burn scar | `role.burnScar` + signal hatch at ~35% | Hatch fill, `signal-deep` 0.6px outline | Reads as "already gone". |
| Forecast +1H | `amber` | Dashed `5 3`, 90% opacity | Label `+1H` at the head. |
| Forecast +3H | `amber` | Dashed `3 4`, 65% | Label `+3H PROJECTION · CONF 0.78`. |
| Forecast +6H | `amber` | Dotted `1 4`, 45% | Further = fainter. Always show confidence. |
| Retardant / water drop | `ice` | 15–25% ice fill, no stroke | |
| Drone | `ice` | Solid chevron glyph pointing along heading; dashed `2 4` orbit; dotted drop line to ground; sensor footprint ring | Callout `HAWK-2 · EO/IR`. |
| Engine | `bone` | Solid square 6px with heading tick | |
| Crew | `bone` | Hollow square 6px | |
| Dozer | `bone` | Square with diagonal | |
| Helicopter / tanker | `ice` | Hollow diamond; tanker larger with wings tick | Aircraft = ice, ground = bone. |
| Unit trail | Unit color | 1px line, fading opacity | |
| Unit target / route | Unit color | Dashed line to a crosshair | |
| Human detection | `violet` | 12px hollow square reticle, 3px solid center, pulse ring on new | Callout `HUMAN DETECTED 0.87`. Highest-priority symbol. |
| Hazard / flammable brush | `amber` | Hatched triangle or hatch area | |
| Structure | `bone-dim` | Small hollow rect, ink-950 fill | Cluster label `STRUCTURES · 06`. |
| Water source | `ice` | Hollow circle | |
| POI / spot fire | `violet` / `ember` | Crosshair | |
| Approximate location (non-live) | Class tone | 3px dot + dashed uncertainty ring, opacity by freshness | REV B. See 13.4. Live = solid square. |
| Drone coverage cell | `ice` at low alpha | Hairline cell, fill by interest | REV B. Assigned drone shown inside its cell. |
| Movement proposal | `signal` | Dashed route to a crosshair, phosphor hollow safety-zone circle | REV B. Only while proposed or executing. |
| Roads | `bone-mute` | Dash-dot `6 3 1 3` | Labels micro mono (`RIDGE RD`). |
| Creeks | `ice` at 45% | 1px solid | |
| Contours | `ink-500` minor, `ink-300` major | 0.5 / 0.8px | Major every third level. |
| Grid | `line-faint` | 1px | Coordinates in micro at edges. |

Callouts: 3px square anchor, 0.75px leader with one angled elbow and an 18px horizontal run, mono 10px label in the feature color, optional 9px `bone-mute` sub-line. Never more than about five simultaneous callouts.

### 12.2 AI recommendation card

```
┌──────────────────────────────────────────────────────────────┐
│ [P1]  REC-014 · 14:22Z                       CONF ▮▮▮▮▮▮▮▯▯▯ │  priority Badge (danger/warning/neutral) · id · time · Confidence
│                                                              │
│ Reposition E-41 to Ridge Rd anchor point                     │  title: sans text-sm/base, bone
│ Head is tracking NE at 22 M/MIN; anchor holds before         │  rationale: text-sm bone-dim, 2–3 lines
│ the saddle and protects Pine Hollow.                         │
│                                                              │
│ UNITS  E-41 · E-43     ETA 9 MIN     IMPACT −18% SPREAD →PH │  Datum row, mono micro labels
├──────────────────────────────────────────────────────────────┤
│ [ Accept ▸ ]  [ Dismiss ]                     SRC 3 · VIEW ↗ │  primary + ghost, refs
└──────────────────────────────────────────────────────────────┘
```
States: `pending` (default; the top P1 may use `shadow-signal`), `accepted` (phosphor `check` + "ACCEPTED · DISPATCHED", actions removed, card dims to bone-dim), `dismissed` (collapsed, `ink-500` text, struck reason optional). Always show units, ETA, impact and confidence. Accept is the only primary button on the card.

### 12.3 Intel feed item states

| State | Visual |
|---|---|
| `queued` | `ink-500` text, `fcc-hatch` strip on the left edge, label `QUEUED`. |
| `analyzing` | Icon in `ice`, label `ANALYZING` in ice, a 1px `animate-sweep` bar along the bottom edge. |
| `processed` | Bone title, bone-dim summary, derived tags as `Badge` (tone by marker kind), `animate-rise` on arrival. |

Item anatomy: type icon (`video`, `image`, `news`, `sensor`, `radio`, `satellite`) · source in mono micro (`HAWK-2 EO/IR`) · time · title · summary · tags · derived marker count.

### 12.4 Alert severity escalation

REV B: in the console, placement is decided by the Orchestrator grade (section 13.1), not by these levels. The table still applies to `Alert` used outside the console.

| Level | Tone | Presentation |
|---|---|---|
| Info | `neutral` / `telemetry` | `LogLine` in the log only. |
| Advisory | `warning` | `Alert` in the panel stack, auto-collapses. |
| Warning | `warning` | `Alert` pinned, `Badge` count in the tab. |
| Critical | `danger` | `Alert` at top of stack with `Dot live`, map callout, persists until acknowledged. |
| Life safety (human in path) | `danger` + `detection` marker | Critical alert plus violet pulsing reticle on the map; never auto-dismissed. |

Escalate one level at a time. Never use sound or full-screen flashes in this prototype.

---

## 13. Orchestrator patterns (REV B)

REV B is Orchestrator-first. The default console is calm: a big map, a slim command bar and the Orchestrator dock. Everything else (forces, feeds, agent pipeline, layers, log) sits behind the left `IconRail` in `Drawer`s. The Orchestrator is an AI that works beside the commander: it grades every piece of information and the grade decides where, and whether, it shows.

### 13.1 Grading and placement

Every alert carries `score` 0–100. `tierOf(score)` maps it to a tier:

| Score | Tier | Where it renders | Who is notified | Rules |
|---|---|---|---|---|
| 85–100 | T0 INTERRUPT | `InterruptBanner`, map center-top; the camera flies to the location | Console user + every field audience in range | One at a time. Must be acknowledged. Others queue behind it. |
| 60–84 | T1 FOCUS | Orchestrator dock, "Needs attention" stack (`AlertCard`); map label shown | Console user + units nearby (fire, EMS) | Max 3 visible. The oldest drops to ambient when a fourth arrives. |
| 35–59 | T2 AMBIENT | Map glyph only, no label; a count in the dock | Console user, passively | Read on hover or selection. |
| 0–34 | T3 LOG | Log drawer only (`AlertCard compact`) | Nobody; recorded for audit | Never surfaced proactively. |

Scoring guidance: life (humans or animals) inside or near a projection band starts at 80; combustibles inside the +3H band start at 60; projection changes are graded by how far the band moved; status is below 35. Scores of non-live findings are multiplied by freshness, so stale items sink a tier on their own.

### 13.2 Alert class → tone

| Class | Icon | Map glyph tone | Card tone |
|---|---|---|---|
| `life` | `human` / `animal` | `detection` (violet) | `danger` (ember) at T0–T1, violet at T2–T3 |
| `hazard` (tanks, depots, vehicles) | `combustible` | `danger` | `danger` |
| `fuel` (dry brush; irrigated fields lower risk) | `tree` | `warning` | `warning` |
| `movement` | `route` | `signal` | `signal` |
| `projection` | `flame` | `warning` | `warning` |
| `status` | `radio` | `neutral` | `neutral` |

Use `alertTone(cls, tier)` for cards and `alertClassTone[cls]` for map glyphs. Movement is the only class allowed to use `signal`, because a pending movement is the next action.

### 13.3 Freshness and fade

Time is of the essence. Anything not seen live right now is approximate and fades.

- `f = 0.5 ^ (age / t½)`. Live sources (drone or ground camera currently looking) hold `f = 1`.
- Half-lives: social video 15 min, web/news 20 min, satellite pass 40 min, a live finding after the camera moves on 5 min.
- Rendering: `opacity = 0.2 + 0.8 f` for the glyph and label; `Freshness` adds desaturation.
- Expiry: `f < 0.10` (about 3.3 half-lives) removes the item from the map; it stays in the log.
- Score coupling: displayed score = graded score × f (see 13.1).

### 13.4 Approximate-location glyph

| Part | Non-live (article, social, satellite) | Live (camera confirmed) |
|---|---|---|
| Center | 3px solid dot (hollow when expired) | 8px solid square inside a 14px hollow square |
| Ring | Dashed `3 3` circle, radius = location uncertainty (meters → pixels), 6% fill × f | None, or sensor accuracy only |
| Opacity | `0.2 + 0.8 f` | 1 |
| Color | Class glyph tone (life = violet) | Same |

Never draw a non-live finding as a solid point; the ring is the honesty.

### 13.5 Interrupt rules

- Only T0 may interrupt. Only one interrupt is on screen; the next waits until acknowledgement.
- An interrupt always says who was already notified (relay row) and offers `Locate`.
- Acknowledge is the only primary button. No sound, no full-screen flash, no auto-dismiss.

### 13.6 Orchestrator voice

- **Calm.** No alarm words; the tier carries urgency.
- **Plain.** Street names, callsigns, minutes: "HAWK-2 is 90 s out."
- **Specific.** Numbers with units, sources named, confidence when it is a claim.
- **One action per sentence.** "Pull DIV A back to Ridge Rd. Start within 4 minutes."
- Headline ≤ 80 characters; brief = 3 bullets; suggestions = 2–4 `PromptChip`s.

### 13.7 Movement proposals

A proposal names who moves (`group`), where (`to`, safety zone), by which route, the time window (`windowMin`), the trigger, and the reason. Show it as a `MovementCard`; on the map draw the route as a dashed signal line to a crosshair and the safety zone as a hollow phosphor circle. Approve dispatches; reject logs the reason.

---

## 13A. Console patterns (REV C)

REV C adds a full-screen console at `/console.html`, separate from the proposal page, designed for 1920 × 1080 and up (responsive down to 1440 × 900, no page scroll). Full-bleed dark ops: the 3D stage dominates and the Orchestrator decides what earns screen space. The attention model (score, zones, directives, autonomy) is specified in `docs/ORCHESTRATOR.md`; this section is the visual side.

### 13A.1 Layout anatomy

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ COMMAND STRIP 48px  FCC mark · CALDOR FIRE · REPLAY · clock (local + Z) · Timeline    │
│ (compact) · play/speed · LensSelect · AutonomyDial · Hold · status · Director · DISCL.│
├────┬─────────────────────────────────────────────────────────────┬───────────────────┤
│RAIL│ STAGE (Z1)                                                   │ ORCHESTRATOR 400px│
│52px│  Z0 InterruptBanner (top-center)                             │  Now: brief       │
│    │  DirectiveToast stack (top-left)                             │  Decisions (Z2×3) │
│pool│                                                              │  Focus (Z3×3)     │
│bars│        3D globe · fire · bands · units · routes             │  Ambient count    │
│    │                                                              │  Conversation     │
│Agts│  metric strip (bottom-left)          CaptionBar (bottom)     │  Ledger counters  │
│Drft├─────────────────────────────────────────────────────────────┴───────────────────┤
│Ldgr│ FEED STRIP ~180px  FeedSurface thumbs by relevance, top feed 2× · fire timeline   │
│Log │                                                                                  │
└────┴──────────────────────────────────────────────────────────────────────────────────┘
```

| Region | Zone | Contents |
|---|---|---|
| Command strip | — | Incident identity, scenario clock (local and Zulu), compact `TimelineScrubber`, play / pause / speed, `LensSelect`, compact `AutonomyDial`, hold-layout `Toggle`, Orchestrator `StatusPill`, Director controls, disclaimer chip. |
| Stage | Z1 (Z0 overlay) | `<Stage>` from `src/console/stage3d`. Overlays only: `InterruptBanner` (Z0), `DirectiveToast` stack, compact metric strip (acres, containment (simulated), ROS, lives at risk, structures threatened), legend on demand, `CaptionBar`. In feed mode the promoted feed fills the stage with a "Back to globe" control. |
| Orchestrator column | Z2, Z3, Z4 count | Brief (headline, bullets, "changed since last brief"), Decisions needed (`DecisionCard` ×3), Focus (`AlertCard` + `WhyPopover`, ×3, bundles show member count), ambient count line, conversation (`OrchBubble`, `PromptChip`, input), compact `LedgerCounter`s. |
| Left rail | — | Agent swarm as tiny live pool bars; opens drawers: Agent Ops (pipeline, `PoolBar`s, job stream with provider and model), Drafts (`DraftDocument`s), Ledger (full Agent Work Ledger), Log (Z5 and all items, filter by zone and class), Layers. |
| Feed strip | — | `FeedSurface variant="thumb"` inside `FeedTile`s ordered by `feed.relevance`, top feed enlarged 2×; click promotes the feed to the stage. |

### 13A.2 Rules

- **Calm by default.** On a quiet screen: stage, brief, ledger counters, feed strip. Nothing else asks for attention.
- **One signal element per view.** Usually the top `DecisionCard`'s Approve, or Acknowledge on a Z0 interrupt (which then takes it). Projection bands are amber; life is violet on the stage and ember in the interrupt.
- **Zones are budgets.** Never render more than `ZONE_CAPACITY` items in a zone; show overflow as a count.
- **Every placement is explainable.** Each focus item and decision has a reason line and a `WhyPopover`.
- **Directives are visible.** Every automatic camera move, feed promotion or panel opening raises a `DirectiveToast` with the reason and Undo / Hold. With hold layout on, directives arrive as suggestions with Apply.
- **Disclaimer always visible:** "Scenario built from public data; units, people and events are simulated." `DraftDocument` carries a `SIMULATED` watermark.
- **Respectful content.** No gore, no real casualty claims; people in danger are fictional and get rescued.
- **Motion.** Camera flights `ease-settle`, toasts and cards `ease-servo` at `duration-base`; no bounce; with `prefers-reduced-motion` camera moves cut instead of fly and toasts do not slide.
- **Keyboard.** `Space` play / pause, `D` start demo, `←` / `→` beats, `1`–`4` lens, `Esc` closes drawers and popovers.
---

## 14. Content and voice

- **Terse and operational.** Write like a dispatcher, not a marketer. "Head tracking NE at 22 m/min." not "The fire is moving quickly!"
- **Micro labels:** mono, uppercase, 1–3 words, no trailing punctuation: `BURNED AREA`, `ROS`, `ETA`.
- **Headlines:** sentence case, short, declarative, end with a period.
- **Separators:** `·` between fields, `//` in classification strips, `/` in serials, `—` in ranges and rule titles.
- **Units:** uppercase after the number, separated by a space or as a smaller span: `22 M/MIN`, `9 MIN`, `1,284 AC`, `28 KPH`, `11 %`. Metric by default; acres for burned area (fire service convention).
- **Numbers:** tabular; thousands separator `,`; zero-pad indices and counts (`01`, `06`) but not callsigns (`E-41`, not `E-041`); confidence as `0.87` (two decimals) or a `Confidence` bar; percentages without decimals unless < 10.
- **Time:** Zulu `14:22:07Z` (`zulu()`), mission elapsed `T+02:14:08`, horizons `+1H`, `+3H`, `+6H`.
- **Coordinates:** decimal degrees, four places, hemisphere letter: `38.9120°N 120.6840°W` (`fmtLat`, `fmtLon`).
- **Callsigns:** `HAWK-2` (drones), `E-41` (engines), `CREW-7`, `HELO-3`, `TANKER-12`, `DOZER-2`.
- **AI claims** always carry a confidence and a source.
- **No emoji. No exclamation marks.**

---

## 15. Accessibility

- Body text uses `bone` or `bone-dim` (≥ 8.9:1). `bone-mute` (4.4:1) is for micro labels and captions only. `ink-500`/`ink-400` are decorative only.
- Focus: global `:focus-visible` is a 1px signal outline with 2px offset. Do not remove it; components add their own equivalent.
- Color is never the only signal: pair status with a label, icon or shape (map symbols differ in shape as well as color).
- `IconButton` requires `label`. Decorative SVG gets `aria-hidden`; meaningful SVG visuals get `role="img"` and an `aria-label` that describes what is shown.
- Use semantic elements: `nav`, `header`, `section` with ids, `dl/dt/dd` for spec lists, `ol` for ordered steps, `table` for tabular data.
- Respect `prefers-reduced-motion` (section 8.4) for both CSS and JS animation.
- Hit targets: at least 28px (`h-7`) for dense controls, 36px (`h-9`) default.
- Live regions: critical alerts should be announced (`role="alert"` / `aria-live="assertive"`); feeds use `aria-live="polite"` sparingly.

---

## 16. File map

```
DESIGN_SYSTEM.md                  this document
AGENTS.md                         operating rules for AI agents
tailwind.config.ts                tokens → Tailwind utilities
src/index.css                     fonts, base styles, .fcc-* utility classes, reduced motion
src/design-system/
  index.ts                        barrel: import everything from '@ds'
  tokens/tokens.css               CSS custom properties (source of truth)
  tokens/index.ts                 JS mirror: color, role, toneClass, Tone, font, type, space, radius, motion, z, tokens
  utils.ts                        cn, pad, fmtLat, fmtLon, zulu
  primitives/index.tsx            Brackets, Frame, Label, Serial, Ruler, Crosshair, RegMark, Hatch, GridBg, Rule, Dot, Datum
  components/                     Button, IconButton, Kbd, Badge, StatusPill, Panel, Card, SectionHeader, Tooltip,
                                  Tabs, Segmented, Toggle, Slider, Input, Select, Alert, Progress, Timeline, LogLine,
                                  Modal, Table, Sparkline, Metric, Gauge, Confidence, UnitChip, Legend, Compass
  components/orchestrator.tsx     REV B: ScoreMeter, TierBadge, AlertCard, InterruptBanner, Freshness, OrchBubble,
                                  PromptChip, Drawer, IconRail, FeedTile, PoolBar, MovementCard + tier helpers
  components/console.tsx          REV C: ZoneTag, WhyPopover, AutonomyDial, LensSelect, TimelineScrubber, LedgerCounter,
                                  DraftDocument, DirectiveToast, CaptionBar, DecisionCard, AudienceRow + zoneMeta helpers
  icons/index.tsx                 Icon, iconNames, IconName
src/sim/                          simulation engine; types.ts is the contract
src/dashboard/                    live ops console; map/ holds TacticalMap
src/sections/                     page sections: Nav, Hero, Architecture, Stack, DashboardSection, DesignSystemSection, Footer
src/sections/ds/                  showcase chapters (Orchestrator.tsx = 05.8 Orchestrator patterns)
console.html, src/console/        REV C full-screen console (contracts.ts, store, stage3d, ui, orchestrator, ...)
docs/                             BACKEND_CONTRACT, ORCHESTRATOR, DATA_SOURCES, SETUP
public/rev-a/                     frozen REV A build (never edit)
public/rev-b/                     frozen REV B build (never edit)
src/App.tsx                       page composition
```

Utilities in `utils.ts`:

| Function | Signature | Example |
|---|---|---|
| `cn` | `(...parts: (string \| false \| null \| undefined \| 0)[]) => string` | `cn('px-2', on && 'text-signal')` |
| `pad` | `(n: number, width = 2) => string` | `pad(7, 3)` → `"007"` |
| `fmtLat` | `(deg: number, places = 4) => string` | `38.9120°N` |
| `fmtLon` | `(deg: number, places = 4) => string` | `120.6840°W` |
| `zulu` | `(date = new Date()) => string` | `14:22:07Z` |

---

## 17. Recipes

Copy, paste, adapt. All imports come from `@ds`.

### 17.1 Panel with metrics

```tsx
import { Panel, Metric, Gauge, Datum, Rule, Serial } from '@ds';
import type { SimSnapshot } from '@/sim/types';

export function IncidentPanel({ s }: { s: SimSnapshot }) {
  const m = s.metrics;
  return (
    <Panel index="01" title="Incident" meta={<Serial>INC-2611</Serial>} dense>
      <div className="grid grid-cols-2 gap-px bg-line">
        <div className="bg-ink-900 p-3">
          <Metric label="Burned area" value={Math.round(m.acres).toLocaleString()} unit="AC" spark={s.history.acres} size="md" />
        </div>
        <div className="bg-ink-900 p-3">
          <Metric label="Rate of spread" value={m.rateOfSpreadMpm.toFixed(1)} unit="M/MIN" tone="warning" spark={s.history.ros} size="md" />
        </div>
      </div>
      <Rule title="Containment" className="my-3" />
      <div className="flex items-center gap-4">
        <Gauge value={m.containmentPct / 100} valueLabel={`${Math.round(m.containmentPct)}%`} tone="nominal" size={72} />
        <div className="grid flex-1 grid-cols-2 gap-3">
          <Datum label="Structures" value={m.structuresThreatened} tone="text-amber" />
          <Datum label="Persons" value={m.personsAtRisk} tone="text-violet" />
          <Datum label="Personnel" value={m.personnel} />
          <Datum label="Units" value={m.activeUnits} />
        </div>
      </div>
    </Panel>
  );
}
```

### 17.2 List of units

```tsx
import { Panel, UnitChip, Progress, Badge } from '@ds';
import type { Unit } from '@/sim/types';

export function UnitList({ units, selected, onSelect }: { units: Unit[]; selected?: string; onSelect(id: string): void }) {
  return (
    <Panel index="02" title="Forces" meta={`${units.length} UNITS`} dense bodyClassName="p-0">
      <ul className="divide-y divide-line">
        {units.map((u) => (
          <li key={u.id} className="flex items-center gap-3 px-3 py-2">
            <UnitChip
              callsign={u.callsign}
              kind={u.kind}
              status={u.status}
              selected={selected === u.id}
              onClick={() => onSelect(u.id)}
              className="flex-1"
            />
            {u.battery != null && <Progress value={u.battery} segments={8} tone="telemetry" className="w-16" />}
            {u.water != null && <Progress value={u.water} segments={8} tone="telemetry" className="w-16" />}
            {u.sensor && <Badge tone="telemetry" variant="soft">{u.sensor}</Badge>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
```

### 17.3 Alert stack

```tsx
import { Alert, Panel } from '@ds';
import type { Insight } from '@/sim/types';

const toneFor = { alert: 'danger', forecast: 'warning', recommendation: 'signal', analysis: 'telemetry', status: 'nominal' } as const;
const iconFor = { alert: 'alert', forecast: 'route', recommendation: 'target', analysis: 'ai', status: 'check' } as const;

export function AlertStack({ items, onClose }: { items: Insight[]; onClose(id: string): void }) {
  return (
    <Panel index="04" title="Alerts" meta={`${items.length} ACTIVE`} dense>
      <div className="flex flex-col gap-2" aria-live="polite">
        {items.slice(0, 5).map((i) => (
          <Alert
            key={i.id}
            tone={toneFor[i.kind]}
            icon={iconFor[i.kind]}
            title={i.title}
            timestamp={`CONF ${i.confidence.toFixed(2)}`}
            onClose={() => onClose(i.id)}
            className="animate-rise"
          >
            {i.body}
          </Alert>
        ))}
      </div>
    </Panel>
  );
}
```

### 17.4 Editorial section shell

```tsx
import { SectionHeader, Rule, Serial } from '@ds';

export default function ExampleSection() {
  return (
    <section id="example" className="relative border-b border-line">
      <div className="mx-auto max-w-[1440px] px-6 py-24 lg:px-10 lg:py-32">
        <SectionHeader index="05" eyebrow="Example" title="Short declarative title." lede="One or two sentences of context." meta={<Serial>FCC-05</Serial>} />
        <div className="mt-20">
          <Rule title="05.1 — Sub-section" />
          <div className="mt-10 grid grid-cols-1 gap-px border border-line bg-line md:grid-cols-3">
            <div className="bg-ink-950 p-6">…</div>
            <div className="bg-ink-950 p-6">…</div>
            <div className="bg-ink-950 p-6">…</div>
          </div>
        </div>
      </div>
    </section>
  );
}
```

### 17.5 HUD overlay on a map

```tsx
import { Brackets, Crosshair, Datum, Dot, fmtLat, fmtLon } from '@ds';

<div className="relative aspect-video overflow-hidden border border-line bg-void">
  {/* map canvas here */}
  <Brackets size={12} tone="bone" />
  <Crosshair size={20} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
  <div className="pointer-events-none absolute left-3 top-3 z-overlay flex items-center gap-2">
    <Dot className="bg-ember" live size={5} />
    <span className="font-mono text-micro uppercase text-bone">Live</span>
  </div>
  <div className="pointer-events-none absolute bottom-3 left-3 z-overlay flex gap-5">
    <Datum label="Ctr" value={`${fmtLat(lat)} ${fmtLon(lon)}`} />
    <Datum label="Wind" value="247° / 28" unit="KPH" tone="text-amber" />
  </div>
</div>
```

---

## Adding to the system

1. Need a new color or size? Add it to `tokens.css`, `tokens/index.ts` and `tailwind.config.ts` together, then document it in section 3 or 5.
2. Need a new component? Build it from primitives and tokens in `src/design-system/components/`, export it from `components/index.ts`, add a specimen to `src/sections/DesignSystemSection.tsx`, and add a catalog entry in section 11.
3. Need a new icon? Follow section 10.
4. Never fork a component inside a feature folder to restyle it. Extend its props instead.
