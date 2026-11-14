# FCC proposal — handoff for the Fire Command Center team

From: marcseli (Marco) and his build agent (Factory Droid).
To: nikolas-sapa and the team's coordinator / builder agents.
Status: **working prototype, simulated execution, not an operational system.** Submitted as a proposal for the team to adopt, adapt or reject. Nothing here approves architecture on the team's behalf.

## REV D integration update

Source of truth remains Marco's FCC app, imported with history. Marco (`marcseli`) owns this proposal and its local frontend/simulator work. This is not a takeover of the coordinator's backend, data or agent implementation lane.

- Default replay: **Mati, Attica, 23 July 2018**. Caldor 2021 remains selectable.
- Themes: FCC (Inter Tight/orange) and Team (Geist/blue `#006bff`). URL `?theme=team`.
- All high-risk drafts now require an actual click, including in the Director. Prior timed Director approvals impersonating `user` were removed, not merely relabelled.
- Projection now runs a prototype minimum-travel-time solver over DEM/fuel/weather, seeded from issue-time reconstructed fire. It does not consume future fire arrivals. Archived future weather is explicitly a perfect-forecast assumption.
- Prediction overlap is against reconstructed spread, **not independent observed fronts**. Checkpoint errors are separately sourced. The first Mati run misses coast timing by **178 minutes late**; this failure is retained, not tuned away. No final-perimeter evaluation is implemented.
- No inference/provider service is connected. Camera footage, detections, agent work and time-saving counters remain simulated. The WebSocket seam is unwired; there is no received-state reducer, command transport, authenticated Chief or multi-client authority.
- Source/build/typecheck and both-scenario regression receipts are in `proposal/fcc/docs/VALIDATION.md`. All six Mati beats were reviewed in both themes; ion/offline and Caldor menu/theme regression run. Real UI approval changed one draft only. Real-entry 10 s samples: Mati offline 46.4 FPS, ion 50.3; Caldor offline 44.5. Jumps/loading still hitch (worst sampled frame 600 ms), and these are not the team's two-client acceptance gate.

The coordinator's new `thermal-camera.v0` and `crew-agent.v0` documents remain unapproved drafts. This revision does **not** claim their T01–T06/C01–C06 acceptance, every-drone thermal metadata, transport-loss/rejoin/energy semantics or genuine model analysis. We will consume a reviewed versioned interface after adoption and exact-file handoff. No root contract files were edited.

## What is in `proposal/fcc/`

A Vite 5 + React 18 + TypeScript (strict) app with two entry points:

| URL (after `npm run dev`) | What it is |
|---|---|
| `/` | One-page proposal: hero, architecture, vendor stack, embedded REV B concept dashboard, design-system showcase |
| `/console.html` | REV D full-screen command console (1920 × 1080+): Mati reconstruction or Caldor replay, simulated agent swarm, attention zones, reviewable drafts, ledger, prediction checks and a 3-minute tour |
| `/rev-a/index.html`, `/rev-b/index.html`, `/rev-c/index.html` | Frozen earlier revisions |

Run it:

```bash
cd proposal/fcc
npm install
npm run dev        # http://localhost:5173  (console: /console.html, demo: press D or /console.html?beat=1)
npm run build      # tsc --noEmit && vite build
npm test           # both scenarios, 190 s tours, beat jumps, manual approvals, future-fire independence
```

No tokens are required. Optional keys go in `proposal/fcc/.env.local` (never committed): `VITE_CESIUM_ION_TOKEN`, `VITE_GOOGLE_MAPS_KEY`, `FIRMS_MAP_KEY` (data rebuild only). See `proposal/fcc/docs/SETUP.md`.

## Where to read first

1. `proposal/fcc/docs/BACKEND_CONTRACT.md` — local bus/state types and proposed backend semantics, with implementation gaps explicitly separated. The team's versioned root contracts take precedence after adoption; this is not a live backend.
2. `proposal/fcc/docs/ORCHESTRATOR.md` — attention model: score formula, role lenses, zones Z0–Z5 and capacities, directives, autonomy levels, worked examples.
3. `proposal/fcc/docs/DATA_SOURCES.md` — every input with status, key requirement and licence.
4. `proposal/fcc/src/console/contracts.ts` — the TypeScript source of truth for 2–3 above.
5. `proposal/fcc/AGENTS.md`, `proposal/fcc/DESIGN_SYSTEM.md` — rules and design system for agents editing this app.

## What is real, what is simulated

- Real (cached public data): final Mati EFFIS polygon (1,362 ha), 28 late FIRMS detections, DEM, CORINE 2018, historical weather and satellite imagery. Current OSM is not a 2018 road map. Fuel classes are derived. Mati intermediate fronts/arrival are explicitly reconstructed and fitted to historical anchors, not observed. Sources/licences in `public/data/<scenario>/README.md`; EOX imagery is noncommercial share-alike.
- Simulated: all units, drones, crews, people at risk, agent outputs, detections and decisions. Agents are deterministic code, not LLM calls. Every view carries the disclaimer "Scenario built from public data; units, people and events are simulated."
- High-risk actions never execute without a human approval click. Nothing controls real aircraft, dispatches crews or sends public alerts.

## Mapping to the team taskboard

| Team card | What this proposal offers |
|---|---|
| O03 Greece demo region | Mati 2018 reconstruction proposed by Marco, Caldor retained; Nikolas/team adoption still required |
| O06 UI reference | Anduril-style console with a Team blue/Geist theme alongside the original; no claim of team design approval |
| P0-02 typed contracts | `src/console/contracts.ts` + `docs/BACKEND_CONTRACT.md` |
| P0-03/P0-04 world, fire, smoke | Seeded world (seed 20210816), arrival-time fire raster, particle smoke |
| P0-07 analysis, fusion, proposals | Simulated agent pools → Orchestrator grading → drafts requiring approval |
| P0-08 evidence/weather/projection | Findings with source, freshness half-lives, projection bands at 60/180/360 min |
| P0-09 3D command-center UI | The console itself |

The team's V1 numeric acceptance has **not** been run. Local `npm test` exercises 1,900 ticks per scenario, no automatic high-risk approvals, six beat jumps, one-click approval isolation and future-fire independence. Maximum Z0 is one. This is not two-client/authority/thermal/provider/performance acceptance. See the application validation receipt for final build/browser status.

## Provenance

All code in `proposal/fcc/` is new work written during the event, 2026-11-14, by marcseli with AI agents. It is imported with its full git history (`git subtree`; commits `f5d9809` REV A, `03eca81` REV B, `79bddeb` REV C). No code from `wildfire-sweep` or any prior project. Third-party dependencies: React, Vite, Tailwind, CesiumJS (Apache-2.0), vite-plugin-cesium, @fontsource fonts.

## How to talk to us

See `proposal/AGENT_PROTOCOL.md`. Short version: comment on the PR with an `AGENT-MSG` block.
