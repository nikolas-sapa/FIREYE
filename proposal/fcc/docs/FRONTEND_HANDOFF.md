# FIREYE and World3D frontend handoff

This delivery integrates the approved local frontend work into current main's `proposal/fcc/` layout. It does not replace the repository root or implement a backend executor.

## Run and inspect

From the repository root:

```bash
cd proposal/fcc
npm ci
npm run build
npm run preview
```

- `/console.html?mode=fireye&tokens=0`: updated reconnaissance console and presentation boot.
- Add `&t=16:44&paused=1&boot=0` for a stationary active exercise.
- Plain `/console.html` keeps Ops, its human approval flow and shared Chief/Scout chat.
- `?mode=crew` stays an isolated received-only reader. `?mode=monitoring` and legacy replay routes remain available.

FIREYE has six drones at two stations and eight fixed cameras. Every drone retains separate EO and thermal channel IDs, giving **20 registered channels across 14 physical sources**. Palette controls are display transforms, not source switching. On-pad/takeoff/charging video is explicitly offline without archive substitution.

The boot uses eight serial 100 ms icon holds, a short local camera approach, then panels sliding over a final-size full-bleed map. World3D adds coherent procedural scenery, atomic detail/object/mask replacement and bounded cache/upload work. All exercise positions, objects, thermal pixels and tasking remain simulated.

## Backend connection boundaries

| Seam | Current implementation / handoff requirement |
|---|---|
| Received state | `src/console/bus/crew-transport.ts`, `src/console/crew/CrewApp.tsx`. Validated GET-only snapshots, memory-only reader capability, no Runtime/store import or simulator fallback. Keep producer/Chief credentials out of this browser reader. |
| Identity | Frontend units use `uav-1`…`uav-6`; existing primary channels use `feed-uav-N`, with a separate opposite-modality suffix channel. Backend asset/feed IDs require an explicit mapping, not a positional join or palette-based guess. See `world/feeds.ts` and `fireye/data/fleet.ts`. |
| Coordinates | The bridge still reports `coordinate_frame: null`. Do not interpret backend metre coordinates as longitude/latitude or invent map positions. Frontend `Geo` and camera AGL/absolute elevation conventions need an agreed conversion. |
| Clocks | `clock.t` and recon task/event times are scenario milliseconds; do not equate them with wall-clock acquisition, receipt time or backend `sim_tick`. Preserve each clock and unknown status separately. |
| Recon state | Optional `ConsoleState.recon` carries stations, drone lifecycle, tasks and events. Task/event histories are capped at 60/240 and rebuilt on seeks, not a durable audit or external command transport. See `contracts.ts` and `docs/BACKEND_CONTRACT.md`. |
| Authority/execution | FIREYE's recon profile autonomously animates local, simulated reconnaissance only. It generates no dispatch/approval `Action`s. Ops/legacy human approval remains separate. Backend-approved command → mapped frontend execution → factual completion is **not connected**. Recon notifications are not backend approvals or receipts. |
| Media | Preserve channel identity, modality, source/synthetic/radiometric/calibration flags and offline status. Local PNG/metadata exports are opt-in, unshared simulated frames, not verified live media or received backend evidence. |
| Analysis provenance | `fireye/data/source-flow.ts` joins retained source references and issue-time observations. Aggregate jobs must not imply per-camera analysis. Do not send procedural truth masks, planted labels, future fire arrivals or future perimeters as model evidence. |
| Renderer | `stage3d/feeds/world3d.ts` adapts feeds to World3D. `FeedSurfaceView.tsx` preserves rendered-channel metadata and rejects stale/offline/mismatched/truth-overlay captures. Main globe remains Cesium. |

Shared compatibility helpers (`journal`, `useDecisions`, legacy chronology and visibility) remain for Ops. Recon chronology/profile caches are separate. No backend, dependency, lockfile, CI, frozen archive, provider credential or generated experiment belongs to this delivery.

## Integration validation

15 November 2026, local macOS Apple Silicon, Node 22.14.0, production Vite build, local assets/providers disabled for browser checks:

- Passed `npm test`, `npm run typecheck`, `npm run test:monitoring`, `npm run test:crew`, `npm run test:image-lab`, `npm run test:spread-precision`, `npm run build` and `npm run test:pwa`.
- `node scripts/check-fireye-boot-browser.mjs`: eight exact 100 ms holds; constant 1600×952 canvas at (0,48); stationary panel-entry camera/frustum; both stations visible; actual map/panel/feed controls; Escape/reduced motion; 1024×768 and 1920×1080 resizing. Final run: 109 approach renders, approximately 60 fps, frame-gap p95 18 ms. Also passed normal default Ops boot, Chief reply/history and isolated Crew entry.
- `npm run test:thermal-browser`: 20 actual distinct 960×540 thermal PNG exports with matching hashes/metadata, no external requests, maximum encoded PNG 656,878 bytes at 1280×633. This is bounded local export proof, not ten-minute producer acceptance.
- `node scripts/check-world3d-browser.mjs`: all 20 registered channels fullscreen at 16:44, 30 batch fps; worst sampled fullscreen 142 draws / 938,740 triangles; initial wall worst view 175,097 triangles. Cache ≤64; sampled generation maximum 13.2 ms. Palette/reduced-motion/tab visibility checks passed.
- `WORLD3D_QA_CASE=monitoring node scripts/check-world3d-browser.mjs`: six fullscreen cameras, offline rendering, no reconstructed fire, 480×270 truth pass and labelled context-loss fallback passed. Worst sampled fullscreen 131 draws / 756,534 triangles; wall worst view 372,637 triangles.
- Fresh-process `node scripts/bench-world3d.mjs`: first near tile 26.5 ms; warm near maximum 15.0 ms; far maximum 5.0 ms; whole-area generation 474.3 ms. Synthetic imagery fixture, not the browser JPEG.

World3D numbers describe finite sampled windows, not guaranteed sustained per-feed rate or whole-transition latency. Earlier transition hitches and pointer-seek automation stalls remain documented in `WORLD3D.md`; full ten-minute acceptance and the complete dusk/missing-imagery/soak matrix were not rerun for this integration. Browser helpers close their owned browsers/listeners. World3D artifacts are opt-in with `WORLD3D_QA_ARTIFACTS=1`.

No genuine provider inference, backend execution loop, cloud/auth/media integration, deployment or operational validation is claimed. Hosted CI and teammate review remain required before merge.
