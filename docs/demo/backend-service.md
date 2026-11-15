# Callable local orchestration service

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
