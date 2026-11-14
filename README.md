# FCC — Fire Command Center

**FCC-01 / REV A · Proposal · 2026-11-14**

An AI-native command center for firefighting drones and first responders. FCC shows a live, Google-Earth-style view of an incident and runs an AI core, ARGUS, that ingests drone video, imagery, news, sensors, satellite hotspots and radio traffic. ARGUS flags danger (dry brush, people, structures), projects the fire path at +1, +3 and +6 hours, recommends how forces should move, and re-plans whenever new information arrives.

Everything on the page is simulated in the browser: procedural terrain, a cellular fire spread model, synthetic units and intel. No external APIs.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build
```

## What is on the page

| Anchor | Section | Contents |
|---|---|---|
| `#top` | 01 Overview | Hero with an animated oblique terrain view: growing fire perimeter, forecast bands, drone orbits, human and structure callouts. |
| `#architecture` | 02 Architecture | Signal-path schematic (inputs → ARGUS core → outputs), capability spec cards, and the decision loop with cycle times. |
| `#dashboard` | 03 Live Ops | The working console: tactical map, intel feed, AI insights and recommendations, forces, metrics. Accept a recommendation and watch the simulation respond. |
| `#system` | 04 Design System | Live specimens of tokens, primitives, components and icons. |

## Docs

- `DESIGN_SYSTEM.md` — the design system reference: tokens, typography, layout, motion, components, map symbology, voice and recipes.
- `AGENTS.md` — rules and commands for AI agents working in this repository.

## Stack

Vite 5, React 18, TypeScript (strict), Tailwind CSS 3.4. Fonts self-hosted via Fontsource.
