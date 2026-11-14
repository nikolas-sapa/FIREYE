# FCC — Fire Command Center

**FCC-01 / REV D · Proposal + console · 2026-11-14**

FCC is an incident watch officer made of AI agents. A swarm of analysis agents reads every feed: news (Firecrawl), social video, satellite passes (NASA FIRMS, GIBS, GOES), drone and dash cams (fal video understanding), weather (Open-Meteo, NWS) and radio (Whisper-style transcription). A projection agent keeps re-forecasting the fire. The **Orchestrator** decides what the human sees, when, and where, and drafts the actual work: drone retasks, crew moves, evacuation notices, ICS-209 sitreps, resource orders and rescue tasks. An Agent Work Ledger shows the useful work done and the analyst minutes saved.

**Open the console: [`/console.html`](http://localhost:5173/console.html)** (run `npm run dev` first).

This is a simulated product demonstration, not a live agent service. No LLM/provider inference runs. Video feeds, detections, tasks and time-savings counters are simulated; the local spread solver is prototype code. High-risk drafts require a human approval click, including during the Demo Director tour.

The full-screen console (1920 × 1080 and up) defaults to **Mati, Greece, 23 July 2018**, with public data cached in `public/data/mati/`. Select **Caldor 2021** in the scenario menu or open `/console.html?scenario=caldor-2021` for the earlier replay.

The Mati timeline is a reconstruction fitted to documented checkpoints and the EFFIS final perimeter, not a sequence of observed fire fronts. Matching those anchors tests consistency, not predictive accuracy. The pack's 28 FIRMS detections occurred after the main run. Historical checkpoint errors and comparisons against reconstructed spread must be reported separately.

Switch between FCC (orange, Inter Tight) and Team (blue, Geist) with the theme toggle, `T` in the console, or `?theme=team`.

The model starts from reconstructed issue-time fire and uses archived future weather as a perfect forecast. It substantially underpredicts Mati's speed. IoU is against reconstructed spread; checkpoint timing is against sourced moments. No final-perimeter evaluation is implemented. See [`PROJECTION.md`](src/console/orchestrator/PROJECTION.md) for assumptions and results.

> Scenario built from public data; units, people and events are simulated.

## Revisions

| Rev | Date | Notes | Where |
|---|---|---|---|
| D | 2026-11-14 | Mati reconstruction, Caldor selection, dual themes, prototype spread model with prediction checks and richer simulated feeds | `/console.html`, this source |
| C | 2026-11-14 | Full-screen Caldor console, attention manager, drafts, ledger and backend contract | `/rev-c/index.html`, git tag `rev-c` |
| B | 2026-11-14 | Orchestrator-first: graded alerts, calm default view, agent pools, drone coverage grid, stack and open questions | `/rev-b/index.html` (frozen build in `public/rev-b/`), git tag `rev-b`; also embedded on the proposal page as the concept preview |
| A | 2026-11-14 | Initial proposal: dashboard-first console with the ARGUS core | `/rev-a/index.html` (frozen build in `public/rev-a/`), git tag `rev-a` |

## Run

```bash
npm install
npm run dev        # http://localhost:5173  (proposal)  ·  /console.html  (console)
npm run build      # typecheck + production build
npm test           # both scenarios: tours, approvals, prediction independence
```

Tokens are optional. Copy `.env.example` to `.env.local` and add `VITE_CESIUM_ION_TOKEN` and/or `VITE_GOOGLE_MAPS_KEY` for world terrain and photoreal 3D tiles; without them the console uses the pack's own heightmap and cached imagery. Step by step: [`docs/SETUP.md`](docs/SETUP.md).

Rebuild Mati with `node scripts/fetch-data.mjs --scenario mati`; rebuild Caldor with `node scripts/fetch-data.mjs`. `FIRMS_MAP_KEY` is optional. Run `node scripts/check-mati.mjs` for reconstruction consistency checks.

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
| [`docs/VALIDATION.md`](docs/VALIDATION.md) | Reproducible checks, browser receipts, frame-time samples and explicit unverified gates. |
| [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) | Tokens, typography, layout, motion, components (including console components), map symbology, Orchestrator patterns, voice and recipes. |
| [`AGENTS.md`](AGENTS.md) | Rules, contracts, ownership and commands for AI agents working in this repository. |
| `public/data/caldor/README.md` | What is in the scenario pack and where it came from. |

## Stack

Vite 5, React 18, TypeScript (strict), Tailwind CSS 3.4, CesiumJS (console stage). Fonts self-hosted via Fontsource.
