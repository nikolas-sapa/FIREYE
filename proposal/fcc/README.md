# FIREYE — fire information for residents

**FCC-01 / REV D · Proposal + console · 2026-11-14**

FIREYE helps local residents see where a fire is and get informed. The primary **Civilian** view shows a simulated location, fire information, MONITOR / PREPARE TO LEAVE / LEAVE NOW / SHELTER IN PLACE, Fire ETA, Leave by and a prototype “Your route out”. It simulates the 2018 Mati fire, not current conditions or official evacuation advice. Follow **112 / civil protection**; routes and projections are not validated forecasts or proven safe evacuation routes.

Chief / Scout and the orchestrator serve the resident information picture, alongside announcements labelled “Official alerts · simulated”. Replies are scripted/deterministic; SMS and voice-call counters do not mean real notifications were sent. Responder/ops views are secondary **for authorities**. The earlier proposal envisioned feed-analysis agents (Firecrawl news, social video, NASA FIRMS/GIBS/GOES satellites, fal drone/dash-camera analysis, Open-Meteo/NWS weather and Whisper-style radio transcription), a projection agent, an Agent Work Ledger and orchestrator drafts for drone retasks, crew moves, evacuation notices, ICS-209 sitreps, resource orders and rescue tasks. These are proposal roles, not evidence of connected live agents, measured analyst time savings or field execution.

**Open the resident experience: [`/console.html?view=civilian`](http://localhost:5173/console.html?view=civilian)** (run `npm run dev` first). [Public demo](https://nikolas-sapa.github.io/FIREYE/console.html?view=civilian) is a static frontend on GitHub Pages, not a hosted backend.

**Default: Civilian.** Plain `/console.html` selects Civilian unless a valid `ops.view` preference is saved. Explicit `?view=civilian` or `?view=responder` overrides it. Location choices are scenario presets; own-location input and Google Maps least-risk-route hand-off, on-device notifications, resident Chief chat and PR #67 backend-approved drone execution are **in progress**, not completed features.

**Reconnaissance exercise: `?mode=fireye`.** A separate simulated Mati 2018 reconstruction, scrubbable 14:00–22:00 local, with a fleet column, INTAKE/OPS log, IoT sensors, Normal/Thermal globe, drone-feed dive and scripted Orchestrator callout. Recon tasking is local simulation; consequential Ops and legacy replay actions require human approval. [FIREYE guide](docs/FIREYE.md).

**Real-data Attica monitoring** (`/console.html?mode=monitoring`). Current observations/forecasts, historical Mati 2018 and Copernicus EMSR746 Attica 2024, source/time labels, camera-provider links and saved real-data fallback. Six separately labeled 3D drone/ground-camera views are simulated over local terrain and dated imagery, with an isolated smooth renderer; they are not live webcams. No fictional incident runtime or AI analysis runs in monitoring. It is not an emergency warning service. [Presentation setup, keys, source limits and camera recording safety](docs/MONITORING.md).

The **legacy replay** at `/console.html?mode=replay` remains a simulated product demonstration, not a live agent service. Its video feeds, detections, tasks and time-savings counters are simulated; the local spread solver is prototype code. High-risk drafts require a human approval click, including during the Demo Director tour. The separate, opt-in proposal [image lab](http://localhost:5173/#image-lab) can make real paid image-editing calls to fal after explicit submission. Its output never feeds monitoring or replay predictions.

**Image lab:** open `/#image-lab` to pick a random Greece satellite landscape, analyze exactly **2×2 independent cells**, and inspect/download their stitched result. Picking imagery makes no fal call; analysis needs `FAL_KEY=your_fal_api_key` in `.env` or `.env.local` and a server restart. Runs are capped at four 1K submissions, with duplicate/retry protection. Default model: `google/nano-banana-2.1/edit`. Single-image uploads and three credited samples remain available. Satellite imagery is EOX's historical 2020 mosaic, approximately 10 m, non-commercial CC BY-NC-SA, not current conditions. Outputs are unvalidated review images, not fire forecasts. [Setup, privacy and limitations](docs/IMAGE_LAB.md).

The legacy full-screen replay (1920 × 1080 and up) defaults to **Mati, Greece, 23 July 2018**, with public data cached in `public/data/mati/`. Select **Caldor 2021** in its scenario menu or open `/console.html?scenario=caldor-2021` for the earlier replay.

The Mati timeline is a reconstruction fitted to documented checkpoints and the EFFIS final perimeter, not a sequence of observed fire fronts. Matching those anchors tests consistency, not predictive accuracy. The pack's 28 FIRMS detections occurred after the main run. Historical checkpoint errors and comparisons against reconstructed spread must be reported separately.

The brand is locked to FCC (orange, Inter Tight). The Team theme toggle was removed; its token code remains unused.

**Daylight appearance:** Auto follows the replay sun through a continuous light/dark palette, using the same solar curve as the map. Light and Dark are manual overrides, independent of the FCC/Team accent. The proposal's Auto follows the system appearance. `?appearance=auto|light|dark` overrides the saved preference. Reduced-motion users get immediate changes.

**Globe:** Outline is the clean default: monochrome DEM relief, elevation contours, road outlines and essential incident overlays. Satellite restores Google 3D, ion imagery or cached imagery, depending on available credentials. The Layers menu hides labels, units, findings, fire, predictions, routes, coverage and outline details independently. Building marks are approximate, not surveyed footprints. These are display preferences, not changes to incident state.

**Install:** FCC is a standalone PWA with an Install button. Build and serve over HTTPS or localhost, then launch it from your Dock/home screen to remove the browser address bar. The app and both replay packs work offline after the initial download; streamed Google/Cesium maps still need a connection. [Installation details](docs/SETUP.md#9-install-as-a-standalone-app-pwa).

The model starts from reconstructed issue-time fire and uses archived future weather as a perfect forecast. On Mati, from detection, it is about 30 min early at Neos Voutzas but about 20 min late at Marathonos Ave and the coast, with less than half the reconstructed area. IoU is against reconstructed spread; checkpoint timing is against sourced moments. No final-perimeter evaluation is implemented. See [`PROJECTION.md`](src/console/orchestrator/PROJECTION.md) for assumptions and results.

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
npm run test:monitoring # source adapters, real fixtures, failure/race/isolation checks
npm run test:pwa   # after build: manifest, icons, precache and provider exclusion
npm run test:image-lab # mocked fal adapter and image-lab rendering, no paid calls
```

Tokens are optional. Copy `.env.example` to `.env.local` and add `VITE_CESIUM_ION_TOKEN` and/or `VITE_GOOGLE_MAPS_KEY` for world terrain and photoreal 3D tiles; without them the console uses the pack's own heightmap and cached imagery. Step by step: [`docs/SETUP.md`](docs/SETUP.md).

Rebuild Mati with `node scripts/fetch-data.mjs --scenario mati`; rebuild Caldor with `node scripts/fetch-data.mjs`. `FIRMS_MAP_KEY` is optional. Run `node scripts/check-mati.mjs` for reconstruction consistency checks.

## The legacy simulated console

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
| `#image-lab` | 04B Image Lab | Opt-in fal image editing, seeded visible-fuel prompt, test scenes, fixed categorical palette and run export. |
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
