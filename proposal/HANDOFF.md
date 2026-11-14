# FCC proposal — handoff for the Fire Command Center team

From: marcseli (Marco) and his build agent (Factory Droid).
To: nikolas-sapa and the team's coordinator / builder agents.
Status: **working prototype, simulated execution, not an operational system.** Submitted as a proposal for the team to adopt, adapt or reject. Nothing here approves architecture on the team's behalf.

## What is in `proposal/fcc/`

A Vite 5 + React 18 + TypeScript (strict) app with two entry points:

| URL (after `npm run dev`) | What it is |
|---|---|
| `/` | One-page proposal: hero, architecture, vendor stack, embedded REV B concept dashboard, design-system showcase |
| `/console.html` | REV C full-screen command console (1920 × 1080+): 3D CesiumJS stage replaying a real past fire, simulated agent swarm, Orchestrator that grades every finding and places it on screen by attention zone, Agent Work Ledger, 3-minute Demo Director |
| `/rev-a/index.html`, `/rev-b/index.html` | Frozen earlier revisions |

Run it:

```bash
cd proposal/fcc
npm install
npm run dev        # http://localhost:5173  (console: /console.html, demo: press D or /console.html?beat=1)
npm run build      # tsc --noEmit && vite build
```

No tokens are required. Optional keys go in `proposal/fcc/.env.local` (never committed): `VITE_CESIUM_ION_TOKEN`, `VITE_GOOGLE_MAPS_KEY`, `FIRMS_MAP_KEY` (data rebuild only). See `proposal/fcc/docs/SETUP.md`.

## Where to read first

1. `proposal/fcc/docs/BACKEND_CONTRACT.md` — the typed event bus and state contract a real backend would publish (11 event types, envelopes, latency budgets, ordering/idempotency). This is the main integration surface for the team.
2. `proposal/fcc/docs/ORCHESTRATOR.md` — attention model: score formula, role lenses, zones Z0–Z5 and capacities, directives, autonomy levels, worked examples.
3. `proposal/fcc/docs/DATA_SOURCES.md` — every input with status, key requirement and licence.
4. `proposal/fcc/src/console/contracts.ts` — the TypeScript source of truth for 2–3 above.
5. `proposal/fcc/AGENTS.md`, `proposal/fcc/DESIGN_SYSTEM.md` — rules and design system for agents editing this app.

## What is real, what is simulated

- Real (cached public data): fire perimeters, satellite hotspots, terrain, fuels, roads/buildings (OSM), weather (Open-Meteo archive), imagery. Sources and licences in `public/data/<scenario>/README.md`.
- Simulated: all units, drones, crews, people at risk, agent outputs, detections and decisions. Agents are deterministic code, not LLM calls. Every view carries the disclaimer "Scenario built from public data; units, people and events are simulated."
- High-risk actions never execute without a human approval click. Nothing controls real aircraft, dispatches crews or sends public alerts.

## Mapping to the team taskboard

| Team card | What this proposal offers |
|---|---|
| O03 Greece demo region | Next revision replays the 2018 Mati / NE Attica fire (EFFIS perimeter, documented timeline). Current build replays Caldor 2021 (US) |
| O06 UI reference | Anduril-style console; a theme toggle adds the team spec (Geist Sans, `#006bff`, no orange) |
| P0-02 typed contracts | `src/console/contracts.ts` + `docs/BACKEND_CONTRACT.md` |
| P0-03/P0-04 world, fire, smoke | Seeded world (seed 20210816), arrival-time fire raster, particle smoke |
| P0-07 analysis, fusion, proposals | Simulated agent pools → Orchestrator grading → drafts requiring approval |
| P0-08 evidence/weather/projection | Findings with source, freshness half-lives, projection bands at 60/180/360 min |
| P0-09 3D command-center UI | The console itself |

Numeric acceptance tests from the team's spec have **not** been run against this code. Receipts we do have: `npm run build` passes with 0 TypeScript errors; 1920 × 1080 screenshots of the 6 demo beats were reviewed; a headless scratch run of the full demo produced 0 errors and never more than 1 Z0 interrupt.

## Provenance

All code in `proposal/fcc/` is new work written during the event, 2026-11-14, by marcseli with AI agents. It is imported with its full git history (`git subtree`; commits `f5d9809` REV A, `03eca81` REV B, `79bddeb` REV C). No code from `wildfire-sweep` or any prior project. Third-party dependencies: React, Vite, Tailwind, CesiumJS (Apache-2.0), vite-plugin-cesium, @fontsource fonts.

## How to talk to us

See `proposal/AGENT_PROTOCOL.md`. Short version: comment on the PR with an `AGENT-MSG` block.
