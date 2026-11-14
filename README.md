# FCC — Fire Command Center

**FCC-01 / REV C · Proposal + console · 2026-11-14**

FCC is an incident watch officer made of AI agents. A swarm of analysis agents reads every feed: news (Firecrawl), social video, satellite passes (NASA FIRMS, GIBS, GOES), drone and dash cams (fal video understanding), weather (Open-Meteo, NWS) and radio (Whisper-style transcription). A projection agent keeps re-forecasting the fire. The **Orchestrator** decides what the human sees, when, and where, and drafts the actual work: drone retasks, crew moves, evacuation notices, ICS-209 sitreps, resource orders and rescue tasks. An Agent Work Ledger shows the useful work done and the analyst minutes saved.

**Open the console: [`/console.html`](http://localhost:5173/console.html)** (run `npm run dev` first).

REV C is a full-screen console (1920 × 1080 and up) that replays the **2021 Caldor Fire** (El Dorado County, California; ignited Aug 14 2021 near Omo Ranch and ran into Grizzly Flats on the night of Aug 16–17) on a 3D CesiumJS globe, using public data cached in `public/data/caldor/`.

> Scenario built from public data; units, people and events are simulated.

## Revisions

| Rev | Date | Notes | Where |
|---|---|---|---|
| C | 2026-11-14 | Full-screen console, real-fire replay (Caldor 2021), attention manager (zones, directives, drafts), agent work ledger, backend contract | `/console.html`, this source |
| B | 2026-11-14 | Orchestrator-first: graded alerts, calm default view, agent pools, drone coverage grid, stack and open questions | `/rev-b/index.html` (frozen build in `public/rev-b/`), git tag `rev-b`; also embedded on the proposal page as the concept preview |
| A | 2026-11-14 | Initial proposal: dashboard-first console with the ARGUS core | `/rev-a/index.html` (frozen build in `public/rev-a/`), git tag `rev-a` |

## Run

```bash
npm install
npm run dev        # http://localhost:5173  (proposal)  ·  /console.html  (console)
npm run build      # typecheck + production build
```

Tokens are optional. Copy `.env.example` to `.env.local` and add `VITE_CESIUM_ION_TOKEN` and/or `VITE_GOOGLE_MAPS_KEY` for world terrain and photoreal 3D tiles; without them the console uses the pack's own heightmap and cached imagery. Step by step: [`docs/SETUP.md`](docs/SETUP.md).

Rebuild the scenario pack with `node scripts/fetch-data.mjs` (optional `FIRMS_MAP_KEY`).

## The console

| Area | What it does |
|---|---|
| 3D stage | Terrain, fire arrival over time, perimeters, hotspots, projection bands (+1 h, +3 h, +6 h), units, routes and safety zones. The Orchestrator frames the stage or promotes a live feed to it. |
| Interrupt | At most one life-safety interrupt, held until acknowledged. |
| Decisions | Up to three drafted actions waiting for approval, with editable documents. |
| Focus and ambient | What deserves a look, with a "Why am I seeing this?" breakdown of the score. |
| Agents | Pools, jobs, models and autoscaling for every source. |
| Ledger | Footage reviewed, articles read, passes triaged, drafts written, analyst minutes saved. |
| Demo Director | A scripted three-minute tour with captions. |
| Controls | Role lens (IC, OPS, AIR, EMS), autonomy (advise, assist, act), hold layout, timeline scrubber. |

## The proposal page

| Anchor | Section | Contents |
|---|---|---|
| `#top` | 01 Overview | Hero with an animated oblique terrain view; links to the console. |
| `#architecture` | 02 Architecture | Signal path (inputs → analysis pools on boxd → projection agent → Orchestrator tiers → audiences), capabilities, freshness, decision loop. |
| `#stack` | 03 Stack | Vendor per job with IN DEMO / IN DEMO (CACHED) / VERIFIED / TO CONFIRM / OPTIONAL status, plus open questions. |
| `#dashboard` | 04 Live Ops | Link to the full console, and the REV B embedded dashboard as the concept preview. |
| `#system` | 05 Design System | Live specimens of tokens, primitives, components, icons and Orchestrator patterns. |

## Docs

| Doc | For |
|---|---|
| [`docs/BACKEND_CONTRACT.md`](docs/BACKEND_CONTRACT.md) | The event bus as a backend API: every event with JSON, agent roles and vendors, latency, autoscaling, ordering, security, phased plan. |
| [`docs/ORCHESTRATOR.md`](docs/ORCHESTRATOR.md) | The attention model: score formula, factors, lenses, zones, placement rules, directives, autonomy, drafts, worked examples. |
| [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md) | Catalog of satellite, weather, 3D, terrain, fire, footage, news, aircraft and population sources with status, keys and licenses. |
| [`docs/SETUP.md`](docs/SETUP.md) | Tokens (Cesium ion, Google Map Tiles), `.env.local`, running the console, Demo Director keys, rebuilding the pack. |
| [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) | Tokens, typography, layout, motion, components (including console components), map symbology, Orchestrator patterns, voice and recipes. |
| [`AGENTS.md`](AGENTS.md) | Rules, contracts, ownership and commands for AI agents working in this repository. |
| `public/data/caldor/README.md` | What is in the scenario pack and where it came from. |

## Stack

Vite 5, React 18, TypeScript (strict), Tailwind CSS 3.4, CesiumJS (console stage). Fonts self-hosted via Fontsource.
