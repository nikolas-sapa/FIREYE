# Frontend issue repairs

2026-11-15. Owner: Marco's frontend delivery lane. Branch: `fix/frontend-issues`,
based on the FIREYE integration plus current shared main. No backend/schema/lock,
provider, deployment, or GitHub issue-state changes are authorized by this work.

## Test plan before implementation

- TH01: every baseline drone has an actual, uniquely registered thermal channel.
  Existing presentation feed IDs remain valid; separate EO/thermal channels retain
  independent identities and explicit simulated/non-radiometric metadata.
- TH02: reject 100 malformed frame records (25 timestamps, 25 nonfinite numbers,
  25 modalities, 25 missing identities); accept 10 records with explicit unknown
  acquisition/geography. A display palette never changes source modality.
- TH03/04: 20 captures retain IDs, pixel hashes/dimensions, source time and separate
  receipt time. Disconnects and failed renders generate no new frame. Capture
  exports allowlisted metadata/pixels only, never detector labels or truth masks.
  Frames older than 3 simulation seconds are stale; a seek cannot make future
  pixels current. PNG encoding is opt-in and one-at-a-time, not per animation tick.
- TH05: 600 real Runtime ticks advance 60 simulation seconds with zero provider calls.
- CR01: validate the actual `backend-bridge.v1` received DTO, including protocol
  version, identities, rows, revisions, enums and unknowns. Invalid data never
  partially replaces last-known state.
- CR02: 20 received revisions converge for two readers; 10 reconnects never
  regress revision. Changed run/epoch requires explicit reconnect. Stop/restart,
  late replies, abort-insensitive transports and expired capabilities cannot
  resurrect a stopped reader or leak its capability to a redirected URL.
- CR03: real `?mode=crew` entry imports no simulator/store/Director/world truth.
  It displays only received facts, unknown positions and unavailable media.
  UI selection stays local. Frozen authority and connection loss never show live
  execution; delivered/rejected never becomes accepted/completed.
- FP01–FP04: run the existing spread-precision regressions unchanged.

Exact frontend scope: `contracts.ts`, `world/feeds.ts`, new
`world/frame-capture.ts`; `stage3d/feeds/FeedRenderer.ts`,
`FeedSurfaceView.tsx`, `world3d/render/WorldRenderer.ts` (pixel-copy hook only);
`fireye/data/fleet.ts`, `fireye/shell/FleetColumn.tsx`, `FeedDeck.tsx`,
`Dive.tsx`, `sync.ts` (label display palettes explicitly, preserve channel labels);
new `bus/crew-view.ts`, `bus/crew-transport.ts`, `crew/CrewApp.tsx`;
`main.tsx`; `tests/thermal.ts`, `tests/crew-store.ts`, `tests/crew-http.mjs`;
`scripts/check-console.mjs`, new `scripts/check-crew-http.mjs` and
`scripts/check-thermal-browser.mjs` (optional finite production browser check);
`package.json` (scripts only); this document, `BACKEND_CONTRACT.md`,
`VALIDATION.md`, `FIREYE.md`, and `AGENTS.md` for the new entry/metadata contract.

## Remaining cross-owner gates

Issue #9's actual producer executor cannot be implemented by guessing a mapping:
the shared handoff still explicitly leaves Unit/feed/finite-route mapping, source
clock/epoch registration, coordinates and cadence unaccepted. This repair adds a
safe read-only crew consumer, not fabricated SimController execution or receipts.
No Chief/producer capability is requested by the reader.

Issue #8's local capture is not shared media transport. Backend media ingestion
is deferred. Short real-entry crew and thermal screenshots/exports passed locally
(see `VALIDATION.md`). Ten-minute actual-browser/producer/crew acceptance,
steady ≥30 FPS and real finite-command execution remain separate measured gates,
not inferred from unit tests or a successful build. Neither issue is fully closed.
