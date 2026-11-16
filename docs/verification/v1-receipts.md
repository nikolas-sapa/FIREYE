# Keyless local acceptance receipts

**Simulation only. Not a live, browser, performance or field result.** This
runner does not close issues #9 or #13 or claim operational readiness. It makes
zero genuine provider calls and does not read provider keys or application env
files. It changes no UI and requires no browser.

## Run

Use Node 24 or newer with the existing dependencies:

```sh
cd backend
npm ci --ignore-scripts
cd ../proposal/fcc
npm ci --ignore-scripts
npm run acceptance:local
```

The runner starts the real `backend/scripts/start-local.ts --await-producer`
with providers disabled on port `0` (OS-assigned loopback port). It reads the
private role handoff without printing it. One esbuild-bundled actual frontend
Runtime loads the committed Mati scenario, proposes a high-risk simulated drone
inspection and executes only through the real OpsBridge Chief approval and
producer command-check path. The drone must move and the Runtime must finish
the action naturally before `observe` sends a synthetic SVG execution-status
frame and completed receipt. This frame is **not thermal/camera pixels**;
backend route IDs remain declared fixture aliases, not calibrated geometry.

Two CrewStore readers have only the reader capability and GET transport.
The actual Crew entry dependency graph is also checked for simulator imports.
Twenty received, unverified synthetic hypotheses test canonical convergence
and unknown geography/model confidence; ten reader stop/rejoins test retained
cursors. Negative checks cover duplicate approval/pending submit/repeated
delivery, invalid Chief, stale command-check revision and terminal replay.
Heartbeat absence for more than five wall seconds must expose frozen authority
to an explicit new reader and reject an obsolete producer command check.

Finally the backend is stopped, its port is rebound to prove release and the
private capability file must have been removed. SIGINT/SIGTERM trigger cleanup;
SIGKILL or machine loss cannot be handled by the runner.

Each invocation writes timestamped JSON and short Markdown files under ignored
repo-root `.scratch/acceptance/`. They contain mode
`simulated-local-rehearsal`, a prominent disclaimer, date, Git SHA/dirty flag,
Node/OS/CPU, fixed seed, total/per-check durations and all eleven issue gates.
No capabilities, tokens, private handoff paths or raw transport traces are
written. Duration is wall time, **not** FPS or a performance acceptance result.

Exit status is nonzero for any executed failure. Zero means the bounded local
checks passed, **not** full issue acceptance: aggregate remains `incomplete`
while any gate/check is skipped. Missing cases default to skipped. Raw local
artifacts are not committed, and this document records no invented run result.

## Coverage versus remaining acceptance

The case IDs retain the **full numeric targets from the issues**; passing a
subset never marks a whole gate passed.

| Gate | Local coverage | Remaining / reported status |
|---|---|---|
| SC01 | One Runtime, two received-only stores, 20 canonical commits; Crew import isolation | **Skipped:** 10 wall minutes, actual producer + two crew browser pages and 10 local camera/pin/lens changes |
| SC02 | One successful execution; duplicate approval/pending submit/repeated delivery, invalid Chief, stale revision and terminal replay cause zero extra executions | **Skipped:** 20 valid/20 duplicate/20 obsolete commands and 10 input-revision interleaves |
| SC03 | Enqueued before check/execution; running before terminal; local completion alone is not canonical completion; one frame precedes one completed receipt; HTTP 200 never treated as terminal | **Skipped:** sent/delivered/accepted are not invented; full stages and 10 delivered-then-rejected trials remain |
| SC04 | 10 store reconnects without revision regression; unknown geography/model confidence in 20 received hypotheses | **Skipped:** browser-local views and 20 replay/offline/Director attempts |
| SC05 | Non-mocked built (esbuild) actual Runtime + real localhost bridge executes one approved task, moves drone, naturally completes and produces simulated status frame/receipt; both crew revisions match | **Pass only if executed successfully.** Not a browser, dist UI, thermal image or calibrated flight result |
| DA01 | Actual Runtime approval/execution/status-frame subset with distinct observed stages and unverified hypothesis provenance | **Skipped:** full capture → hypothesis → review → all stages → replay sequence |
| DA02 | Two reader stores, 20 converged commits and no reader writes | **Skipped:** two browser crew pages/one producer for 10 minutes, 10 view changes and 20 competing approvals |
| DA03 | Reconnects, stale/replay rejection, unknowns, >5-second heartbeat absence/freeze and obsolete check rejection | **Skipped:** complete obsolete/offline trial matrix and unresolved-critical source-aging trials |
| DA04 | Build/typecheck/tests are separate commands, not browser measurements | **Always skipped:** M3/16 GiB/1080p/30 FPS/p95/10-minute soak/native installation not measured |
| DA05 | Honest local simulation receipt only | **Always skipped:** recording, submission checklist/deadline/portal, publication and submission not performed |
| DA06 | Disabled providers, no keys, zero calls | **Always skipped:** genuine provider smokes need separate exact authorization/caps |

The optional `vite preview`/`console.html` serving probe is explicitly skipped:
it would not establish visual/browser behavior and is outside this bounded
Runtime/HTTP rehearsal. Use `npm run build` independently. The fast pure receipt
tests are wired into `npm test`; existing console and backend tests remain
independent evidence, not implicit browser or provider acceptance.
