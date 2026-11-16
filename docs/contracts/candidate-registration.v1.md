# Candidate registration v1: standalone reviewed proposals

## Approval and scope

Issue #19's three exact files are reassigned to this worker by owner Nikolas via
the coordinator; the claim is recorded externally. This bounded approval covers
only an isolated, non-executing proposal registry. It does not approve dynamic
core registration, a core event/schema change, or application adoption.

## Acceptance tests before implementation

- CR01: 20 reviewed current finite candidates register exactly 20 times, retaining
  exact candidate/route/mission/asset identity and deeply immutable geometry;
  20 invalid requests reject 20/20 with zero entries.
- CR02: 20 repeats create zero duplicates; 20 two-candidate Promise.all races each
  have exactly one asset winner; 20 model-authored geometry/safety/approval flags
  grant zero authority.
- CR03: 10 revision interleaves invalidate prior eligibility 10/10 and reject
  pending stale reviews; 10 serialized audit replays produce JSON.stringify-equal
  registries. Unknown required feasibility yields zero eligible proposals.
- CR04: actual exported APIs exercised, existing backend tests have zero failures,
  TypeScript exits zero. These are local tests, not distributed transaction proof.

## API and trust boundary

`backend/planning/register-candidates.ts` exports `createCandidateRegistry` and
`replayCandidateRegistrations`, plus the DTO/event/registry types. No provider,
network, clock, command, core reducer or core approval writes are involved.

The factory exposes synchronous `setCurrent(inputs)`, `register(request,
trustedActor)`, `snapshot()` and `auditLog()`. Mutating operations return the
existing protocol `Result`. Trusted composition code alone supplies received
snapshot/context, exact identity mappings, known asset IDs, and authenticated
protocol `ActorContext`. Passing an object is not authentication. No public HTTP
adapter is provided. The human actor's principal/session and current incident/run
are required; reviewer identity never comes from request body fields. This is
per-candidate human review, not Chief command approval or execution permission.

`setCurrent` recomputes actual `generateMissionCandidates` output: caller-supplied
plans, arbitrary waypoints and feasibility booleans cannot be registered.
Mappings must exactly match its candidate/route/mission/drone IDs, map only to
known asset IDs, and consistently map drones and assets one-to-one. No aliases or
new identities are synthesized. Missing mappings admit no proposals. Empty plans
and unknown required finite planner inputs admit no proposals; an unknown-input
update uses an empty mapping list. Invalid DTOs/mappings are rejected, leaving
the last accepted trusted current state unchanged. The trusted caller must not
continue offering the previous revision after a rejected currentness update.

All DTOs use closed allowlists and bounded plain-data checks. Extra review fields,
including reviewer IDs, geometry, model-created safety and approval flags, are
rejected. Proxies, accessors, cycles, exotic objects and non-finite numbers are
rejected without invoking getters/proxy traps. Geometry comes only from the
finite bounded toy planner; it is not calibrated flight physics or safety proof.

`register` requires a distinct explicit `decision: 'approve'` record per exact
candidate/route/mission/asset tuple, current run and input revision. It neither
registers every assignment in an option nor automatically approves new inputs.
Successful entries preserve `executable: false`, `status: 'reviewed_proposal'`,
reviewer receipt and a deeply frozen independent copy of the planner proposal.
The nested planner registration status remains awaiting reviewed core
registration. No input or output grants command authority.

## Currentness, concurrency and immutability

An instance is bound to one incident/run. Input revision is monotonic. Changed
inputs, mapping or context require a new revision; exact repeats are permitted.
Every accepted revision change permanently invalidates all preceding entries;
pending old requests reject. Old immutable snapshots remain historical views,
not live authority: consumers must query the current registry snapshot.

An eligible exact repeat succeeds without adding an entry. Identity/geometry
replacement is rejected; request geometry is never accepted, and changed planner
inputs cannot overwrite an existing revision. Two distinct candidates competing
for one asset in the current revision have exactly one winner. The synchronous
check-and-append has no await point. This is single-instance, single-process
atomicity only; independent registries, workers, durable storage and Convex
transactions are not coordinated. Revision changes permit new reviewed proposals
for an asset but do not release or modify any real/core reservation.

## Audit and replay

Audit receipts append current-input updates, successful human registrations,
idempotent repeats and rejection codes/reasons. Rejected untrusted bodies are not
retained. Arrays and event payloads are immutable copies; earlier returned logs
remain unchanged. Ordered replay regenerates catalogs through the actual planner
and applies successful review receipts, checking registered/repeated event kinds.
Rejected events are no-ops. There are no wall-clock timestamps, random IDs or
sorting-dependent mutations: replay of the same local log yields byte-identical
registry JSON. Replay is pure reconstruction, not authentication, a signed log,
or proof that an imported human receipt is genuine. Use only trusted local logs.

## Deferred core integration and non-goals

This module does not insert core Candidates, change protocol types/validation,
call the core reducer or approval functions, issue commands, execute routes or
claim approved execution. Core integration requires a separately reviewed exact
claim for `backend/protocol/types.ts`, `backend/protocol/validation.ts`,
`backend/state/reducer.ts`, and `backend/state/approval.ts`, reviewed event/schema
design and bridge/orchestration integration tests. Existing strict currentness,
reservation guards, fixed-seed mapping and immutable geometry remain untouched.

Owner review must decide global reservation-revision invalidation of competing
registrations and precise reservation/sector ownership (the current projection
maps live reservations to all layout sectors). Local asset exclusion here is not
an adopted replacement policy. Chief approval and Marco #9 real receipt remain
required before any approved-execution claim.

Non-goals: arbitrary LLM waypoints, fake registration aliases, auto approval,
rotor/flight control, physics/calibrated reserve, mandatory dynamic schema for the
first demo, auth/Convex/media/deployment/spend, provider calls, frontend adoption,
real identity provisioning, or distributed/core reservation authority.
