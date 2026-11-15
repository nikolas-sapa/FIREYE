# Callable local orchestration service

## DQR test plan, before queued wiring implementation

- DQR01: 20 analyses without explicit server authorization issue 0 transports and 0 reservations.
- DQR02: 20 identical snapshots derived from actually ingested existing frame fixture metadata produce 1 real loopback request, 1 reservation and 1 receipt identity through the actual queued Iris export.
- DQR03: 20 cached reads after canonical input revision changes return 0 actionable results and 0 new reservations. Authority freeze rejects cached output too.
- DQR04: 20 HTTP bodies attempting model/budget/client configuration override return 400 and create 0 assessments or calls.
- DQR05: default 20 HTTP objectives retain null receipts and 0 external calls; trusted queued options on the unchanged telemetry-only fixture also issue 0 calls. Native/compiled/typecheck/diff-check exit 0.

### DQR implementation plan

1. Add tests for one small service composition helper against real authority/received fixture metadata and real loopback transport.
2. Add optional server-only `queued_iris` options; derive clock and currentness from shared authority, never HTTP body. Pass actual queued client into existing coordinator only when configured.
3. Verify unchanged HTTP input and disabled defaults; document fixture limitation and local-only proof.

### DQR non-goals

No fixture/scenario override, candidate registration change, invented camera/hash/pixels, HTTP configuration, environment keys, provider activation, paid calls, new dependencies, frontend, deployment or full issue #15 completion.

### Trusted queued composition boundary

`startDemoService({ queued_iris: config })` optionally constructs the actual reviewed `createQueuedIrisClient` and injects it into the real coordinator. Omit this option to preserve the previous disabled direct-client default. CLI/environment startup does not populate this option. Import and construction make no network calls.

`DemoQueuedIrisConfig` reuses queue configuration but excludes caller clock/currentness hooks and requires explicit `max_call_micro` and `deadline_ms`. Existing queue/client guards enforce positive finite limits, authorization, fixed candidate IDs and supported fixture/local-http transport. `createServiceQueuedIris(authority, config)` derives time from trusted authority clock and currentness from canonical incident/run, active authority, epoch and input revision, including producer expiry. Supplied extra runtime hooks cannot replace these authority-owned checks. No provider credential accepted by the queued configuration.

HTTP objective shape remains closed and unchanged. Body fields cannot select a model, budget, transport, client, authorization or currentness callback. No per-request configuration or environment fallback.

The fixed seeded service layout cites no frame evidence and cannot produce an eligible sponsor snapshot. Supplying queued options therefore still gives deterministic fallback/null receipt, not model inference. DQR loopback proof invokes the same service composition helper against separately ingested existing BC01 fixture metadata. That fixture reuses BC01's explicit metadata hash/rights declaration, does not generate pixels, and is not a genuine producer/media/inference receipt. No scenario override or dynamic candidate registration added. End-to-end HTTP queued inference and Gemini orchestration remain open under issue #15.

### DQR local verification receipt, 2026-11-15

macOS, Node26.11.1/npm11.20.0, pinned TypeScript5.9.3. RED missing helper export failed1/1; corrected test-only unsupported telemetry time fixture before final GREEN. Focused10/10; complete native260/260 and compiled260/260, check-backend/typecheck/compiler exit0, failures/skips0. `npm ci --ignore-scripts` exit0/audit0; diff-check0. Twenty unapproved+twenty disabled helper calls reserve/invoke0. Real service helper/queued export/Iris/local HTTP:20duplicates yield1request/1reservation/1receipt, provenance local-http, fresh_provider_call=false. Twenty revised-cache plus twenty frozen-cache reads yield0actionable outputs/0extra reservations; already-pending cached read also rejects changed revision. Twenty HTTP config overrides400/assessments0/calls0. Twenty configured telemetry-only HTTP objectives return1assessment/null receipts/calls0, existing disabled-default check remains green. No environment/core/schema/scenario/package/provider/frontend changes or worker Git operations. Node24 floor, hostedCI, genuine inference and end-to-end HTTP queued inference unrun; root TypeScript/security review and delivery pending. Partial issue #15 only.

## Test plan, before implementation

- DS01: 20 concurrent HTTP objectives create 1 real coordinator assessment. Two HTTP readers see identical proposal/command facts.
- DS02: 20 unknown/stale/expired/superseded reviews create 0 proposals/commands. 20 current-Chief submissions create exactly 1 command. Non-Chief creates 0 commands.
- DS03: real planner recipe registers exactly 1 reviewed finite fixture course. Changed/unregistered inputs stay review-only. 20 disabled-provider objectives issue 0 external calls.
- DS04: exact loopback Host/Origin and fixture role gates reject invalid requests. Body <=65,536 bytes, request deadline <=10,000 ms. Ten start/stop cycles rebind 10/10 ports, zero retained listeners. Native/compiled/typecheck exit 0.

## Implementation plan

1. Build explicit seeded-fixture metadata scenario using actual planner exports, then construct final authority with immutable reviewed candidate.
2. Compose actual coordinator with shared authority. Existing bridge handles canonical endpoints, private loopback bridge proxied through bounded service.
3. Expose closed objective/assessment/review/Chief paths. Server-owned roles only. Never manufacture execution receipts.
4. Verify numeric tests and publish backend-only runbook.

## Non-goals

No frontend launch/edits, production login, Convex, dependencies, dynamic route registry, media/pixels, paid calls, deployment, shell/URL tools, simulated completion or operational claims.

## Backend-only runbook

From repository root: `node backend/scripts/start-local.ts --demo`. No browser/frontend starts. Default launcher without `--demo` remains bridge-only. Importing modules opens no listener.

Startup prints `service: orchestration-demo`, `provenance: seeded-fixture`, default objective ID/tick, URL and ignored private 0600 capabilities-file path, never capability values. Use its local role handoff server-side, never bundle Chief/producer capabilities into a frontend. Send exact `Origin: http://localhost:5173` and `Authorization: Bearer <private role capability>`. Default port 8787; local settings remain documented in [local backend](local-backend.md).

Service uses one canonical authority, one private ephemeral bridge plus public loopback service. No public bind/tunnel. Canonical `snapshot`, `events`, `approvals`, `commands`, `command-checks`, `producer-heartbeats` endpoints pass through existing bridge validation. Its capabilities and limits remain unchanged.

Additional resources under `/incidents/exercise-local/`:

| Resource | Method, role | Closed request |
|---|---|---|
| `objectives` | POST, analyst/current Chief | `{"objective_id":"fixture-refresh-1","capture_goal":"refresh_coverage","required_capabilities":["thermal"],"created_at_sim_tick":1}` |
| `assessments` | GET, any member | Empty, no query. All <=64 bounded assessments. |
| `reviews` | POST, analyst/current Chief | `{"assessment_id":"<returned>","option_id":"<selected_option_id>"}` |
| `chief-decisions` | POST, current Chief only | `{"assessment_id":"<returned>","approval_id":"local-approval-1"}` |

Assessment returns EXERCISE/unverified planner options and deterministic fallback, null model receipt. Review commits one registered proposal, never command. Chief decision enqueues one command; producer must supply its own actual acceptance/stage events through canonical endpoints. New received telemetry changes assessment identity and removes fixed registration eligibility, so reassessment remains review-only. No dynamic registration or route substitution.

Explicit **seeded-fixture** setup: one drone, declared thermal feed, one toy region/sector, one synthetic telemetry event. No actual producer observations, heartbeat, camera frames, media hash, thermal pixels/detection or completed status. Fixture initial tick is 1; actual monotonic elapsed clock advances thereafter. Fixed-course snapshot expires after 5 elapsed ticks, intent at tick 11. Idle producer timeout freezes authority after >5 seconds, without fake heartbeat. Start fresh reconciled run for repeat proof; connected producer is responsible for actual heartbeat/events. No field safety claim.

HTTP body limit 65,536 bytes, 10-second deadline, 64 connections, 60 supplemental mutation attempts per local session/minute, exact local Origin/Host, no arbitrary URL/shell path. SIGINT/SIGTERM close both listeners and remove private handoff.

## Local verification receipt

2026-11-15, macOS, Node26.11.1, TypeScript5.9.3. Native192/192 and compiled192/192 exit0, all five service tests pass in both paths. Typecheck/compiler exit0, audit0 vulnerabilities, diff-check0. Twenty HTTP duplicates create1 assessment; twenty stale/unknown reviews create0 commands; twenty Chief racers produce1 command; ten closes rebind10/10 ports. Actual native/compiled CLI objective succeeds with freshPID and private handoff removal. Zero provider calls, frame events or executor receipts. Node24 floor/hostedCI/frontend/production acceptance unrun. Coordinator reviews/delivery pending.
