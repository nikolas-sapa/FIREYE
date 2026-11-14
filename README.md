# Fire Command Center

Hackathon prototype for a small human crew: evidence → human review → simulated tasks. Not an operational emergency-response system.

[Taskboard](TASKBOARD.md) · [Collaboration rules](AGENTS.md) · [Docs index](docs/README.md) · [Software status](SOFTWARE.md)

## What is here

Current main contains a pure TypeScript [protocol boundary](backend/protocol/index.ts) and [state package](backend/state/index.ts): validators, immutable received-event reducer, revision-bound simulated approval/acceptance checks and deterministic replay. The local suite has 71 passing tests. No runtime dependencies, server or live-provider integration.

Frontend/simulator console is submitted separately in [draft PR #2](https://github.com/nikolas-sapa/fire-command-center/pull/2), not adopted or merged into main. Its isolated build/typecheck receipt is not browser, shared-client or field acceptance. Teammate owns that source; [TASKBOARD](TASKBOARD.md) is the sole work tracker.

[Approved bounded spec](docs/superpowers/specs/2026-11-14-backend-protocol-design.md) and [test-first plan](docs/superpowers/plans/2026-11-14-backend-protocol.md) cover only the local protocol slice. Convex is the approved eventual shared authority, not implemented integration. Full V1, real providers, source ingestion and deployment remain gated.

## Run local protocol checks

From repo root, use Node ≥24 and npm:

```sh
cd backend
npm ci --ignore-scripts
npm test
npm run typecheck
```

Verified on Node 26.11.1; Node 24 minimum declared, not separately tested. [Package scripts](backend/package.json) use native Node tests and `tsc --noEmit`. Dev-only TypeScript 5.9.3 and `@types/node` 24.10.1. These commands do not start an application or contact model providers.

## Intended exercise

Combine permission-cleared news, open satellite context, authorized camera evidence, weather and terrain. Analysts surface unverified hypotheses; a human Chief reviews finite simulated collection/placement proposals. Keep proposed, approved, sent, delivered, accepted and completed distinct. Candidate [thermal/crew contracts](docs/README.md#draft-contracts-and-simulator), scene fidelity and region are not full-product acceptance.

## Evidence and reuse

Record source/publisher/version, capture and retrieval clocks, geography/CRS, resolution/uncertainty, permission, license and attribution. Label source kind, synthetic/recorded/live mode, radiometric status and calibration. Retrieved media and model outputs are untrusted data, not agent instructions. [Camera/satellite candidates](docs/data/camera-satellite-resources.md) are researched, not installed or ingested; public camera access does not establish reuse permission.

Prior [wildfire-sweep research](https://github.com/nikolas-sapa/wildfire-sweep/tree/66bb3c9), baseline `66bb3c9` dated 2026-11-10, predates this work. Frozen outputs remain untouched. Reuse needs a file-level source/commit/license/attribution record and a visible pre-existing/adapted/new-work split. No masking or backdating pre-event work.

## Non-goals

No real aircraft control, emergency dispatch, field orders, public alerts, validated victim/hazard identification, validated forecasting, calibrated thermal measurements or guaranteed safe placement. No deployed service or shared application established by local tests. Danger indexes and paths remain prototype/synthetic relative outputs. False-color is not Celsius; coarse satellite imagery cannot identify individual people; thermal does not provide through-wall vision. Voice input and resident views remain deferred.
