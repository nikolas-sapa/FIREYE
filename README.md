# FCC — Fire Command Center

**FCC-01 / REV B · Proposal · 2026-11-14**

A control panel for fire departments and first responders: one up-to-date picture of fire movement, projected fire paths and AI alerts about areas of danger.

REV B is **Orchestrator-first**. Pools of analysis agents read local news (Firecrawl), open satellite imagery (NASA FIRMS, Sentinel-2, GOES), ground vehicle cameras, a drone network, social video, weather and terrain. A projection agent re-draws the fire path as evidence arrives. The Orchestrator grades every finding from 0 to 100 and decides where it shows: a single acknowledged interrupt, a short "needs attention" stack, a quiet map glyph, or the log. It relays alerts to fire, EMS, law and the public, and proposes group movements (who, where, route, time window, safety zone, trigger). Findings from non-live sources are drawn as approximate locations that fade as they age.

Everything on the page is simulated in the browser: procedural terrain, a cellular fire spread model, synthetic units, cameras and intel. No external APIs.

## Revisions

| Rev | Date | Notes | Where |
|---|---|---|---|
| B | 2026-11-14 | Orchestrator-first: graded alerts, calm default view, agent pools, drone coverage grid, stack and open questions | this source |
| A | 2026-11-14 | Initial proposal: dashboard-first console with the ARGUS core | `/rev-a/index.html` (frozen build in `public/rev-a/`), git tag `rev-a` |

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build
```

## What is on the page

| Anchor | Section | Contents |
|---|---|---|
| `#top` | 01 Overview | Hero with an animated oblique terrain view: fire perimeter, forecast bands, drone orbits, graded life and hazard callouts. |
| `#architecture` | 02 Architecture | Signal path (inputs → analysis pools on boxd → projection agent → Orchestrator tiers → audiences), capabilities, freshness, decision loop. |
| `#stack` | 03 Stack | Vendor per job with VERIFIED / TO CONFIRM / OPTIONAL status and fallbacks, plus open questions for the client. |
| `#dashboard` | 04 Live Ops | The Orchestrator-first console: map, command bar, Orchestrator dock, interrupt banner, drawers for forces, feeds, agents, layers and log. |
| `#system` | 05 Design System | Live specimens of tokens, primitives, components, icons and the Orchestrator patterns. |

## Docs

- `DESIGN_SYSTEM.md` — the design system reference: tokens, typography, layout, motion, components, map symbology, Orchestrator patterns, voice and recipes.
- `AGENTS.md` — rules, contracts and commands for AI agents working in this repository.

## Stack

Vite 5, React 18, TypeScript (strict), Tailwind CSS 3.4. Fonts self-hosted via Fontsource.
