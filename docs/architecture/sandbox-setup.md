# Dormant bounded Boxd job seam

SANDBOX-01, [issue #26](https://github.com/nikolas-sapa/fire-command-center/issues/26), assigned `nikolas-sapa`. Branch `task/sandbox-jobs-v1`, source base `f4a2e9d`. Coordinator owns review and Git delivery. Backend source remains unwired to application routes, models and simulator.

## Test plan, before implementation

Issue body was published and read back before source edits. Exact owned paths: `backend/sandbox/{types.ts,jobs.ts}`, `backend/tests/sandbox-jobs.test.ts`, this document, TASKBOARD.md append only.

- SB01: 20 unapproved/missing-config/zero-budget cases, 0 executor invocations.
- SB02: 20 exact immutable task-input duplicates, 1 execution; conflicting job ID, 0 extra executions. Property order canonicalized; arrays remain ordered. At most 128 retained results and 256 job-ID aliases.
- SB03: 10 distinct jobs, at most 2 physical in-flight and 8 queued; eleventh rejected. Shared actual SponsorBudget grants at most 2 physical slots across scheduler instances.
- SB04: 20 stale submits, 0 executions; 20 stale cached reads, 0 successes. Source changed in-flight/queued, 0 successes and 0 queued executions.
- SB05: deadline at most 30,000 ms. Hung timeout, 0 success; physical slot and budget remain held until executor settles. Late replies, queued deadlines and expired cached reads (including alternate IDs/deadlines), 0 revived success.
- SB06: request at most 16,384 bytes, reply at most 8,192 bytes, at most 32 registered candidates. Unknown operations, commands/env/private-world keys, invalid received evidence references, accessors, secret-like IDs and malformed/oversized replies, 0 accepts. Exceptions return finite codes without raw error text.
- SB07: actual exported fixture produces exact deterministic ranking; provenance fixture, remote_execution false. Actual exported Boxd binding returns UNSUPPORTED with positive authorization/budget, 0 budget reservation and 0 remote invocations.
- SB08: npm ci --ignore-scripts, focused/full native tests and typecheck exit 0. No dependency/core/frontend changes.

Implementation sequence: failing tests, closed finite types, small scheduler reusing actual sponsor JSON/snapshot/budget exports, actual fixture and unsupported Boxd bindings, numeric GREEN and honest receipts.

## Finite operation and server gates

Only `score-received-candidates.v1` exists. Input contains current received snapshot and registered candidate IDs, each linked to existing evidence IDs. Score equals candidate evidence count divided by received snapshot evidence count. Ranking sorts descending score, then exact candidate ID. Relative evidence coverage only, not feasibility, danger, calibrated confidence, verified incident, mission decision or real compute benefit. No free text, commands, URLs, environment, credentials or private simulator world.

`SandboxJobs` constructor takes trusted server-only enabled flag, authorization ID, explicit machine ID, positive per-job micro reservation, shared SponsorBudget, candidate registry, source-currentness callback and injected executor. Body cannot supply those capabilities. Missing authorization/machine/budget/currentness/registry fails closed. Machine ID is checked but never contacted. Constructor config is not real session authentication and must never be assembled from model/body-supplied authority.

Fixture is the only allowed execution mode. `createBoxdCliExecutor()` deliberately has no CLI subprocess, shell construction, network access or machine lifecycle functions, always unsupported even with positive config. Remote binding is dormant, not a verified sponsor integration. Model cannot create a VM or select an executor/command.

Currentness checks use existing closed Snapshot validation, received cutoff/source clocks, at-most-60-second snapshot window and trusted `is_current(snapshot) === true`: before enqueue, before start, before executor invocation, after result and on every cached read. Duplicate success also remains bound to original job deadline. Input is copied and recursively frozen; complete bound task input (operation/snapshot/candidates) is canonically hashed. Bounded identity maps do not evict old identities or enable resubmission to escape budget. No retries or refunds. Instance recreation is not distributed idempotency proof.

Deadline includes queue time. Advisory AbortSignal is not physical cancellation proof: hung work continues occupying scheduler and shared-budget physical slot until actual settlement. Queue expires independently. Constructor-local queues are at most 2/8; shared budget limits physical execution across instances, not global queue length. Fixture reservations reuse budget accounting but are not measured charges.

## Future activation, explicitly gated

Prior parent-session read-only Boxd auth reportedly found one hibernated machine and reported credit. Not independently rechecked here, not execution permission. Do not connect to its HTTPS/SSH/exec surfaces: Boxd connections can wake a hibernated machine. CPU-only jobs can also look idle to Boxd auto-suspend/hibernate. Existing timers, credentials and VM state remain untouched.

Before actual binding, obtain separate explicit owner approval naming machine ID, finite installed CPU operation, payload rights, execution count/spend ceiling and lifecycle policy. Verify genuine Boxd CLI behavior with command-specific help and approved hard deadline/physical cancellation. Standard machines can expose integration credentials via metadata; untrusted code requires isolation, but provisioning/isolation changes remain outside this slice. This seam does not install a worker, upload anything or pretend an AbortSignal is a remote kill acknowledgement.

## Non-goals

0 VM creation/wake/start/delete/fork/proxy/deploy/upload/remote exec. No keys/env/private truth, arbitrary shell, paid compute, model inference, recursive agents, frontend/core/package/lock changes, endpoints, app wiring, operational predictions or full-product readiness. No actual Boxd CLI invocation was made by this worker.

## Local verification receipts

2026-11-15, local macOS workspace, Node 26.11.1. RED: native sandbox suite exit 1, missing sandbox/jobs.ts. GREEN: 15/15 focused tests, 118/118 full backend tests, 0 failures/cancellations/skips; full run 473.497917 ms (one run, not a performance benchmark). npm ci --ignore-scripts exit 0, 0 audit vulnerabilities. Typecheck exit 0 includes new sandbox modules through test imports, existing tsconfig unchanged. Actual fixture and dormant Boxd exports invoked, no mocked package exports, no remote/dist deployment claimed. Full suite includes prior 103 tests, not just historical 71-core baseline.

Worker self-checks pass. Independent coordinator TypeScript/security review and Git delivery remain pending. `remote_execution=false`, remote calls 0, key/env/VM mutations 0, deployments 0. No product acceptance checkpoint earned.
