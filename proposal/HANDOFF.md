# FCC proposal — handoff for the Fire Command Center team

From: marcseli (Marco) and his build agent (Factory Droid).
To: nikolas-sapa and the team's coordinator / builder agents.
Status: **working prototype, simulated execution, not an operational system.** Submitted as a proposal for the team to adopt, adapt or reject. Nothing here approves architecture on the team's behalf.

## Precision/presentation follow-up, 2026-11-15

Stacked on draft [PR #2](https://github.com/nikolas-sapa/fire-command-center/pull/2), not main.
Tested production source: [`c2ff541578a9deceaed2dcfdc6cbd92b3b6f65b2`](https://github.com/nikolas-sapa/fire-command-center/commit/c2ff541578a9deceaed2dcfdc6cbd92b3b6f65b2).
See [exact claimed paths](fcc/docs/REVIEW_SCOPE.md) and [current receipt](fcc/docs/REVIEW_RECEIPT.md).

- Fix the Float32-distance/Float64-heap fresh-entry rejection without weakening the stale guard. Permanent exact corridor control, independent shortest-path graph, boundary and fractional-seed checks pass. Both 190-second tours still require manual high-risk approval.
- Transfer the owner's monitoring/presentation work from an isolated, frozen snapshot. `/console.html` now defaults to real-data Current Attica / Mati 2018 / Attica 2024; `?mode=replay` and existing scenario/beat links preserve legacy replay. The six separate simulated camera views always use Mati terrain and dated archive imagery, without incident detections or thermal-measurement claims.
- Include cartography/motion and the explicit opt-in image lab. Restore four sequential 1K paid calls by default, no automatic regenerations; nondefault retries require explicit selection/consent. Bound terrain PNG decompression. No paid/provider request was made during this review.
- Exclude 249 experiment outputs and six study CLIs, local credentials, builds/dependencies and browser artifacts. Original dirty local work remains untouched. Frozen revisions and dependency lock are unchanged.
- No broad-repository security certification or refreshed browser/performance acceptance. This remains draft pending independent broad-diff/browser review and coordinator acceptance, despite green local automated checks.
- Read the newer `producer-handoff.v1` at `d1213b03edaaf439f0533caa6c37065929b7f08c`. All d1–3/t1–3 owner mappings and candidate/mission/route resolution remain unsupported, not inferred. No reviewed CRS/origin/axes/units/altitude-datum or sim-tick/UTC conversion is adopted. Capture/receipt unknowns remain separate.
- Monitoring is not a crew bridge. Legacy replay still has per-page Runtime; designated producer ownership, zero-Runtime crew readers/capabilities, factual receipts and a reviewed heartbeat/telemetry/recovery schedule remain unimplemented. [#8](https://github.com/nikolas-sapa/fire-command-center/issues/8)/[#9](https://github.com/nikolas-sapa/fire-command-center/issues/9) are not completed. No frontend/backend launch or merge permission is inferred.

## Historical REV D integration update (pre-follow-up)

Source of truth remains Marco's FCC app, imported with history. Marco (`marcseli`) owns this proposal and its local frontend/simulator work. This is not a takeover of the coordinator's backend, data or agent implementation lane.

- Delivery source: `e561695995fa3aa97bbbca48e6376d71d604a111`, following Marco's manual initial REV D commit `4870ee2`. Imported with full history in subtree merge `ab42fa3c24a381cafb04c386af6753f5186891fc`. The imported `proposal/fcc` tree exactly matches the validated source tree (`ddac8f18bf44e4d0b4e5e013db6d35c142c0e5e5`). Remote publication is recorded on PR #2; no main merge is authorized.
- Default replay: **Mati, Attica, 23 July 2018**. Caldor 2021 remains selectable.
- Themes: FCC (Inter Tight/orange) and Team (Geist/blue `#006bff`). URL `?theme=team`.
- Appearance: independent Auto / Light / Dark controls. Console Auto follows the same replay sun as the map, with continuous dawn/dusk blending; reduced motion applies immediately. Proposal Auto follows the system. Both accents have checked text-token contrast ≥4.5:1 across 1,001 daylight samples each.
- Main globe: clean monochrome DEM Outline by default, Satellite switch with lazy Google/ion loading, and independent globe layer controls. Building marks are approximate, not surveyed footprints. Hiding a layer never clears a decision or changes a sensor feed.
- Standalone PWA: Install control, icons/manifest and versioned offline app/pack cache (418 files, 33.4 MiB). The active worker pins its HTML shell to its own assets until older windows close; external tiles/APIs and revision archives are not cached. Launch the installed app to remove the browser address bar; OS title/status bars may remain. HTTPS or localhost is required. Native OS installation was not performed.
- Genuine Google **imagery** rendering over Mati was verified: 64 HTTP-200 resource responses, 81 selected tiles, repeated Satellite/Outline switching. This is not a Google model/inference receipt.
- All high-risk drafts now require an actual click, including in the Director. Prior timed Director approvals impersonating `user` were removed, not merely relabelled.
- Projection now runs a prototype minimum-travel-time solver over DEM/fuel/weather, seeded from issue-time reconstructed fire. It does not consume future fire arrivals. Archived future weather is explicitly a perfect-forecast assumption.
- Prediction overlap is against reconstructed spread, **not independent observed fronts**. Checkpoint errors are separately sourced. The first Mati run misses coast timing by **178 minutes late**; this failure is retained, not tuned away. No final-perimeter evaluation is implemented.
- No model-inference service is connected. Camera footage, detections, agent work and time-saving counters remain simulated. The WebSocket seam is unwired; there is no received-state reducer, command transport, authenticated Chief or multi-client authority.
- Source/build/typecheck and both-scenario regression receipts are in `proposal/fcc/docs/VALIDATION.md`. All six Mati beats were reviewed in both themes; ion/offline and Caldor menu/theme regression run. Real UI approval changed one draft only. Earlier real-entry 10 s samples, **before Outline/daylight/PWA changes**: Mati offline 46.4 FPS, ion 50.3; Caldor offline 44.5. Jumps/loading still hitch (worst sampled frame 600 ms); these are not latest-mode measurements or the team's two-client acceptance gate.
- Final source build, `npm test`, `npm run test:pwa` and whitespace checks pass. Chromium manifest/installability diagnostics: zero errors. In production with browser networking disconnected, Mati reload, Caldor scenario navigation and the Light proposal render passed. The shared clone was not given another dependency installation; exact Git tree identity establishes that it contains the tested application, not a separately claimed shared-clone build.

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
npm run build      # typecheck, Vite build, then generate offline cache
npm test           # both scenarios, 190 s tours, beat jumps, manual approvals, future-fire independence
npm run test:pwa   # after build: manifest/icons/cache/provider exclusion/update-shell regression
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

Application code in `proposal/fcc/` was written during the event, 2026-11-14–15, by marcseli with AI agents, with cached public data and third-party runtime/assets disclosed separately. It is imported with its full git history (`git subtree`; commits `f5d9809` REV A, `03eca81` REV B, `79bddeb` REV C, `e561695` complete REV D). No code from `wildfire-sweep` or any prior project. Third-party dependencies: React, Vite, Tailwind, CesiumJS (Apache-2.0), vite-plugin-cesium, @fontsource fonts.

The frozen REV C Cesium bundle is byte-identical to the installed upstream runtime and contains an upstream default token. Droid Shield flagged the bundle; it does not contain the supplied local provider credentials. Marco made the initial archive commit outside Droid after review; Shield stays enabled. The final supplied-credential scan found zero matches across 1,460 publishable/build files, with no `.env.local`, scratch or dist paths staged. Upstream vendor whitespace is retained unchanged and excluded only from source whitespace checks. A push may still need manual handling if Shield flags the historical archive again.

## How to talk to us

See `proposal/AGENT_PROTOCOL.md`. Short version: comment on the PR with an `AGENT-MSG` block.
