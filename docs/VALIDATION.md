# REV D validation receipt

Run: 2026-11-14, macOS 25.2 (Apple silicon, 10 CPUs, 16 GB), Node 22.14.0.
Browser: Chromium headless, 1920 × 1080. Scenario-defined seeds, unchanged.

## Reproducible checks

From the application directory:

```bash
npm run typecheck
npm test
node scripts/check-mati.mjs
VITE_CESIUM_ION_TOKEN='' VITE_GOOGLE_MAPS_KEY='' npm run build
git diff --check -- . ':!public/rev-c/cesium/**'
```

- The full staged whitespace check reports upstream trailing whitespace in the frozen
  REV C Cesium runtime/SVGs. The source check excludes only `public/rev-c/cesium/**`;
  those vendor bytes remain unchanged rather than rewriting embedded strings or WASM.
- Typecheck includes the application and regression tests.
- `npm test` passes each scenario's 190-second Director tour at 10 Hz. It checks every step
  for at most one Z0 and no automatic high-risk approval. It then jumps to all six beats,
  approves one draft and verifies the other high-risk drafts stay pending. Hold-layout camera
  suggestions remain unapplied until accepted. Ridge cameras aim down at terrain; satellite imagery is not marked live.
- Future-fire isolation: remove every future arrival, perimeter, hotspot, checkpoint and
  report from a copy of the pack. At the same issue time and weather, the model's entire
  arrival field must be identical. This does not remove the documented perfect-weather assumption.
- The WebSocket seam recognizes the new scoring event and rejects non-finite event timestamps.
  It is not a validated backend/reducer or authentication boundary.
- Mati reconstruction consistency: 1,362 ha, equal by construction to the EFFIS final area.
  Point arrival differences: west Neos Voutzas +9 min, Neos Voutzas +1, Marathonos −1,
  Mati coast +4. These fitted checks are not prediction validation.

## Forecast failure retained

The first Mati prediction at 16:43 EEST scores 0.36 IoU at +30 min (21 vs 56 ha)
and 0.19 at +60 (56 vs 289 ha), against the **reconstruction**.
Its coast checkpoint is 178 minutes late against the sourced time.
Later +30 overlap reaches 0.63 with a much larger reconstructed initial fire.
Caldor initial overlap is 0.80 at +30 and 0.66 at +60.
See [model assumptions and results](../src/console/orchestrator/PROJECTION.md).

No independent final-perimeter prediction evaluation, forecast calibration or operational
safety claim. The model uses archived future hourly weather, coarse fuel classes and no spotting.

## Browser and performance scope

Proposal theme checks pass: FCC uses Inter Tight, Team uses Geist, and neither overflows
horizontally at 1920 × 1080. All six Mati beats were screenshot-reviewed in both themes.
The real console's ion and offline paths render. Caldor was selected through the menu and
checked with both themes. IR, ridge, dash, helmet, fictional social and archived satellite
views were reviewed; the final satellite crop includes visible MODIS/date/nominal-pass/source
labels and marks annotations simulated. Some ground cameras can be occluded by coarse buildings.
The real Approve button changed exactly one high-risk draft, leaving the other two pending.
The prototype still has no authenticated human/Chief boundary.

Screenshots are local ignored artifacts in `.scratch/qa/`.

Ten-second real-entry samples, fresh browser processes, DPR 1, 1920 × 1080, Team theme,
15 feeds, running simulation, including the initial jump to beat 4:

| Scenario / basemap | Average FPS | p50 frame | p95 frame | Worst frame |
|---|---:|---:|---:|---:|
| Mati / offline | 46.4 | 16.7 ms | 33.4 ms | 599.9 ms |
| Mati / ion | 50.3 | 16.7 ms | 33.2 ms | 349.9 ms |
| Caldor / offline | 44.5 | 16.7 ms | 49.9 ms | 250.1 ms |

These are short local samples, not a steady-frame-time guarantee. Jumps/loading still hitch.
An automated close/reopen batch hit a browser-daemon restart and timed out on `about:blank`;
browser diagnostics passed and individual navigations/measurements succeeded afterward.

The Node simulation checks are not browser FPS measurements. No claim of the team's
two-client 10-minute, ≥30 FPS acceptance gate, shared authority, thermal-camera draft
compliance or real-provider inference. No Google 3D key was supplied, so that path remains unverified.

REV C is frozen from source tag `rev-c` under `public/rev-c/`, built with empty local
browser credentials. REV A/B remain untouched.
