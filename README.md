# Fire Command Center

Small human crew. Larger team of analyst and drone-agent contexts. One shared picture of what actually arrived, one accountable human approving changed mission scope.

Fire Command Center is a hackathon coordination prototype for **wildfire exercises**. Intended workflow: collect permission-cleared evidence, surface unverified hypotheses, rank finite collection or placement options, obtain Chief approval, track simulated execution, then replay the decision trail. Goal: make evidence, uncertainty and responsibility understandable to a small crew without assigning a human to every logical agent. No measured staffing benefit claimed.

Current main delivers the local protocol foundation, not that whole application: pure TypeScript validation, received-event state, revision-bound approval and deterministic replay. Teammate's visual console is a separate submitted prototype. No operational emergency response, live drone control or validated rescue prediction.

[Taskboard](TASKBOARD.md) · [Collaboration rules](AGENTS.md) · [Docs index](docs/README.md) · [Software status](SOFTWARE.md)

## Contents

[Concept and demo](#20-second-concept) · [Implementation status](#implementation-status) · [Agent roles](#runtime-agent-role-map) · [Architecture](#system-and-data-architecture) · [Approval lifecycle](#approval-and-mission-lifecycle)

[Evidence and cameras](#evidence-inputs-and-source-age) · [Software and sponsors](#software-and-sponsor-roles) · [Local setup](#run-local-protocol-checks) · [Public API](#public-protocol-and-state-api) · [Repository map](#repository-map)

[Collaboration](#contributing-and-file-ownership) · [Tests and failure modes](#verification-and-failure-modes) · [Roadmap](#roadmap-and-current-gates) · [Sources](#sources-and-attribution) · [Limits](#limitations-security-and-privacy) · [FAQ](#faq)

## 20-second concept

“Several camera and source feeds suggest something worth checking. Analysts explain the evidence and uncertainty. Chief approves one finite simulated task. Crew sees whether it was sent, delivered, accepted and completed, then replays exactly what was known.” This is the product concept, not a claim that every step runs today.

![Proposed scan-area demo: three simulated drones, captured evidence, unverified exercise-map marker and human review.](docs/assets/readme/demo-flow.png)

Proposed scan-area illustration, not a working end-to-end demonstration. Table below describes the broader evidence-to-replay product story. [Vector image](docs/assets/readme/demo-flow.svg) · [Mermaid source](docs/assets/readme/demo-flow.mmd) · [Editable scene](docs/assets/readme/demo-flow.excalidraw).

| Story step | What the audience should see | Current boundary |
|---|---|---|
| 1. Capture | Identified feed, acquisition/receipt clocks, source mode and uncertainty. | Typed frame/telemetry records exist; no ingest or media decoder. |
| 2. Analyze | Unverified human/animal/fire/canister hypothesis linked to evidence. | Hypothesis validation exists; actual model inference absent. |
| 3. Review | Finite options and rationale, current Chief decision, visible rejection. | Local approval/reservation checks exist; real session/UI integration absent. |
| 4. Track and replay | Separate receipt stages, last-known state during loss, historical knowledge cutoff. | Local receipt/replay rules exist; network/executor integration absent. |

Proposed scenario may combine news, satellite context, weather/terrain and authorized cameras. Current PR #2 uses a Caldor scene; North Evia/Greek data remains a candidate, not an adopted replacement. Proposed fleet sizes, region, fidelity and final recording length still require agreement. Do not present the concept diagram as a live-provider receipt.

## Implementation status

Snapshot: 2026-11-15, main source baseline `6ade6aea`. **Built** means implemented local code, **Submitted** means separate unmerged source, **Planned** means future gated integration, **Proposed** means draft concept/contract. These labels are not readiness percentages. [TASKBOARD](TASKBOARD.md) owns detailed receipts and work status.

| Area | Status | What exists / what does not |
|---|---|---|
| Protocol validation | Built, main | Closed JSON guards for seed, seven event kinds and approval requests. No source authenticity guarantee. |
| Received state | Built, main | Immutable reducer, revisions, stream ordering, duplicate handling and authority freeze. No network service. |
| Approval and receipts | Built, main | Trusted-context local approval, exclusive reservation, enqueued command, acceptance checks and receipt progression. No real auth or dispatcher. |
| Replay | Built, main | Canonical log reconstruction and receipt-cutoff snapshots. No model calls, live commands or integrated console replay acceptance. |
| Local verification | Built, main | 71 native Node tests; TypeScript typecheck. Not distributed, browser or field acceptance. |
| Visual console/simulator | Submitted | [Draft PR #2](https://github.com/nikolas-sapa/fire-command-center/pull/2), pinned `6bdb5884`, unmerged. Isolated install/build/typecheck passed; browser/full-product acceptance unverified. |
| Shared application | Planned | Convex approved as eventual canonical authority, one teammate simulator producer. No SDK, provisioning or two-client integration. |
| Model/source integrations | Planned | Google, Iris, fal and Firecrawl/Treg roles researched. No genuine product inference/retrieval calls. |
| Thermal fleet, Camera Room, fault-aware exercise | Proposed | Draft contracts and simulator requirements. Current console's mixed EO/false-color channels do not satisfy every-drone thermal requirement. |
| Deployment and submission | Planned | No deployed service or final submission receipt established by this repository. |

The [approved bounded spec](docs/superpowers/specs/2026-11-14-backend-protocol-design.md) and [four-task test-first plan](docs/superpowers/plans/2026-11-14-backend-protocol.md) authorize only the merged local protocol slice. Full V1 remains gated. Administrative work and passing local tests do not complete any full-product P0 card.

## Runtime agent role map

“Agent team” describes logical product responsibilities, not the coding agents used to build this repo, running VMs or already connected models. A small human crew supervises bounded contexts; one current Chief controls changed collection/placement scope. No recursive spawning or unrestricted autonomous mission generation intended.

![Role map separating human Chief authority, planned model analysts and orchestrator, submitted simulator ownership, and implemented deterministic protocol checks.](docs/assets/readme/agent-roles.png)

All model roles below are planned. Deterministic core is built; it is not an LLM. [Vector image](docs/assets/readme/agent-roles.svg) · [Mermaid source](docs/assets/readme/agent-roles.mmd) · [Editable scene](docs/assets/readme/agent-roles.excalidraw).

| Role | Intended responsibility | Allowed output / authority |
|---|---|---|
| Human Chief and crew | Review evidence, choose current finite scope, inspect progress and uncertainty. | Chief approves; person's pin/preset/replay selection should remain local, not change peers. Real sessions still absent. |
| Google orchestrator | Organize received evidence and bounded analytical tasks. | Validated hypotheses/proposals, not simulator truth, reservations or fabricated human decisions. |
| Oumi Iris decision role | Rank finite feasible choices or eligible feed IDs using current snapshots/capabilities. | Select/rank known candidates, not invent routes/resources or change calibration. Genuine call pending. |
| fal / Google visual analyst | Inspect permitted EO/thermal pixels for candidate people, animals, fire or objects. | Unverified evidence-linked hypotheses. Provider/task/thermal capability must be tested, not assumed. |
| Firecrawl / Treg source tools | Retrieve authorized articles/source material for context. | Source snapshots with attribution/times. Retrieved text has no instruction authority; Treg is a tool registry, not model routing. |
| Drone/task context and simulator | Execute only approved finite simulated work, capture observations, emit factual receipts. | Teammate owns simulator truth/render/execution; root consumes events. Submitted console is not integrated with this core. |
| Deterministic protocol/state core | Reject invalid/stale input, preserve received state, bind approval and reconstruct history. | Pure local functions. No inference, physical safety calculation, transport or cloud allocation. |

Planned analysts consume immutable received snapshots, not animation frames or hidden future-world arrays. Proposed bounds in [crew contract](docs/contracts/crew-agent-boundaries.md): at most 16 logical contexts, 2 in-flight requests, 8 queued jobs, 30 calls/10 minutes, 8-second timeout. These are draft limits, not an implemented scheduler or measured performance.

## System and data architecture

Two worlds must stay separate: **simulation truth** (teammate's producer) and **crew knowledge** (validated events actually received). A camera footprint or future arrival in the simulator is not evidence that crew observed a target. Models must never receive hidden planted answers.

![System overview: gated sources and submitted simulator feed validated events into the built local received-state, approval and replay core; future Convex and crew clients remain planned.](docs/assets/readme/system-overview.png)

Implemented local modules are distinguished from future integrations. Arrows describe intended seams, not existing network connections. [Vector image](docs/assets/readme/system-overview.svg) · [Mermaid source](docs/assets/readme/system-overview.mmd) · [Editable scene](docs/assets/readme/system-overview.excalidraw).

1. Capture/source adapters preserve facts and permissions; future verified server derives actor/run/lease context. Neither layer exists as a live service in main.
2. Closed validators accept exact versioned JSON shapes. Body-supplied role/session fields cannot grant Chief authority.
3. `commitEvent` returns a new canonical state/log with one revision advance; duplicates do not advance it. Acquisition clocks remain in payloads; receipt/actor/revision metadata comes from context.
4. Analysts propose only registered current finite candidates. `approveProposal` binds Chief, proposal/input/plan/reservation revisions and expiry, returning reservation plus enqueued command in one local transition.
5. Simulator receipts report separately received stages. Acceptance validation is an intent gate, not an executor, acknowledgement or completion generator.
6. `replayLog` validates stored canonical history; `selectReceivedSnapshot` exposes the prefix at a UTC receipt cutoff without seed/control fields. Full dual-cursor frontend replay remains future work.

Convex is approved as eventual canonical shared authority. One designated teammate producer retains simulation/capture/execution, not one independent authoritative world per browser. Local compare-and-commit models the boundary; it does **not** prove distributed transaction safety. Host loss requires freeze and explicit reconciled takeover, not automatic second-producer startup.

## Approval and mission lifecycle

Evidence becomes an **unverified hypothesis**, then a **finite proposal**, never a direct field order. Current trusted human Chief approval is required for new collection scope, reassignment or revised simulated ground placement. Routine observations may later run inside an already approved scope/lease; approval per frame is not the intended workflow.

![Mission state progression from proposal and human approval to enqueued, sent, delivered, accepted, running and completed, with failed, cancelled and rejected outcomes distinct.](docs/assets/readme/mission-lifecycle.png)

Built core validates/records local transitions; transport and simulated executor integration are planned. [Vector image](docs/assets/readme/mission-lifecycle.svg) · [Mermaid source](docs/assets/readme/mission-lifecycle.mmd) · [Editable scene](docs/assets/readme/mission-lifecycle.excalidraw).

| Stage | Exact meaning |
|---|---|
| Proposed | Known candidates plus rationale/current revisions, not a command. |
| Approved | Trusted current human decision recorded with reservation; not a network send. |
| Enqueued | Generated command exists, initially `sent_sim_tick=null`; no dispatcher in this package. |
| Sent | Received producer receipt says transmission was sent. Delivery remains unconfirmed. |
| Delivered | Arrived at simulated executor. Executor may still reject. |
| Accepted | Executor accepted a valid current command. Work is not completed. |
| Running | Received progress fact, not predicted success. |
| Completed | Matching terminal receipt with linked evidence. Failed/cancelled/rejected are separate outcomes. |

Local guards bind incident/run, authority/capture epochs, command/mission versions, current Chief and relevant revisions/expiry. Same-ID conflicting reuse rejects; exact authorized duplicates return current unchanged state. Old approval cannot silently revive after reconnect. A delayed older ACK cannot regress a terminal command.

`ActorContext` is a trusted function argument, not wire privilege. Tests construct it explicitly; no real authentication implementation exists. `mode: 'live'` means local control context, **not** real cameras, a model call or a production deployment. Replay/offline contexts cannot approve new work.

## Evidence inputs and source age

| Input type | Intended use | Preserve / do not infer |
|---|---|---|
| News/articles | Context and leads worth corroborating. | Publisher/URL, post and retrieval times, quoted claims; article is not confirmed incident truth. |
| Satellite imagery/event catalog | Regional context, dated fire/terrain layers. | Layer/date/resolution/CRS/rights. Coarse imagery cannot identify individuals; approximate event geometry is not a perimeter. |
| Authorized fixed cameras | Visible scene changes, smoke or contextual evidence. | Source permission, modality, acquisition time/geometry and uncertainty. Public reachability is not reuse permission. |
| Drone EO/thermal frames | Candidate observations during simulation or permission-cleared recorded fixtures. | Unique feed/modality, source/synthetic/radiometric/calibration flags, media reference/content hash. No guessed pin or Celsius. |
| Weather/terrain/fuel proxies | Relative toy projections and exercise constraints. | Units/source epoch/geography/assumptions; reanalysis is not an as-issued forecast, paths not validated safe routes. |
| Telemetry and receipts | Last-known observed state and factual simulated progress. | Producer/epoch, command/mission/version, capture and receipt clocks. Missing receipt stays unconfirmed. |
| Model output | Candidate interpretation or finite ranking. | Actual model/task/input version, evidence links, score scale, contradictions and misses. No calibrated probability implied. |

Before ingest: record source/publisher/version or commit, exact rights/license/notices, permitted use, capture/publication/retrieval/receipt clocks, geography/CRS/uncertainty and modality/resolution. Current frame schema covers a subset; full rights manifests and ingest jobs are future work. [Pinned resource catalog](docs/data/camera-satellite-resources.md) lists six complementary candidates, not installed sources.

### Camera and thermal rules

Every simulated drone is required to have a distinct thermal feed; optional EO is a separate channel. Core seed validators enforce declared thermal registrations, but metadata is not demonstrated rendered capability. PR #2 currently mixes EO and false-color channels, so fleet requirement is not met by that submission.

Simulated feeds require `source_kind='simulated'`, `synthetic=true`, `radiometric=false`, `calibration=null`. False-color is display, not calibrated thermal sensing or Celsius. Current protocol has no temperature fields. Real radiometric use would need source-linked calibration, permitted measurements and capability validation. Thermal does not see through walls; smoke/occlusion performance is source-specific.

Unknown source time stays `captured_at=null` with `capture_time_status='unknown'`; unknown position stays null, not `(0,0)` or a made-up GPS pin. Frame `source_position` describes capture geometry, not target geography. Hypothesis `geography` and uncertainty also remain null when unknown. A seed's declared feasible route is not calculated flight safety.

Acquisition and receipt clocks are different. Late arrival does not make old evidence fresh; replay preserves original clocks. Core stores these distinctions, but UI aging/ranking and real clock authentication are not implemented. Proposed stale thresholds in [thermal draft](docs/contracts/thermal-camera.md) remain future acceptance criteria. Aging, fading, muting or acknowledging never silently resolves an unresolved critical hypothesis.

### Model result versus fixture result

| Provenance | Honest label |
|---|---|
| Deterministic test/scene fixture | Synthetic exercise input or scripted result, not actual inference. |
| Recorded provider reply | Replay of a particular original reply, not a new live call. No such product receipt established yet. |
| Genuine authorized future inference | Actual provider/model/task/input and latency/trace, including invalid replies and misses. |

Synthetic exercise media must be visibly labelled for viewers; planted labels/answer boxes/true coordinates stay evaluator-only and hidden from model inputs. Preserve actual model output, including misses, rather than replacing it with planted truth. Dataset ground-truth labels are not inference output or georegistration.

## Software and sponsor roles

Role selection is intended product design, not proof of using every sponsor. [SOFTWARE.md](SOFTWARE.md) links official documentation and separates local authentication, owner reports and actual integration. Paid calls default disabled pending exact scope/budget approval.

| Component | Intended role | Verified/reported state |
|---|---|---|
| TypeScript / Node | Deterministic protocol checks and development typechecking. | Main package, Node ≥24; tested 26.11.1. TypeScript 5.9.3 / `@types/node` 24.10.1 dev-only, zero runtime dependencies. |
| Vite / React / Cesium | Teammate's 3D console, camera previews and simulator presentation. | Separate draft PR #2, Vite 5/React 18/Tailwind 3/strict TS/Cesium; unmerged. Not root backend dependencies. |
| Convex | Eventual canonical shared state and transaction adapter. | Direction approved, SDK/provisioning/integration absent. |
| Google / Gemini | Candidate orchestrator and visual analysis. | Project/key/authorized access unconfirmed; no product call. |
| Oumi / Iris | Finite decision/ranking model. | Existing organization/project verified; key setup and genuine inference pending. Account presence is not API acceptance. |
| fal | Candidate vision/video/segmentation analysis; optional generated exercise media deferred. | Credits ready per owner report, API/thermal-task capability unverified. Catalog schemas do not prove accuracy. |
| Firecrawl | Candidate news/article retrieval. | No confirmed product connector or ingestion receipt. |
| Treg | Tool registry and source retrieval, complementary to article tools. | Scoped local CLI/auth verified; proposed three-file source adapter remains draft, not implemented/called. Not a general model gateway. |
| Boxd | Optional bounded CPU preprocessing after approval. | Scoped auth verified; zero machines created. No compute/inference receipt. |
| Camera/satellite tooling | Permission-cleared recorded/stream/context inputs. | Research only. Transport code licenses do not license media. |

No `.env.example`, application env-variable contract or provider setup script exists in this slice. Do not invent key names or copy private account details into examples. A future authorized adapter needs real non-mocked receipts plus timeout, stale-result and offline fallback tests before integration can be marked working.

## Run local protocol checks

From repo root, use Node ≥24 and npm:

```sh
cd backend
npm ci --ignore-scripts
npm test
npm run typecheck
```

Verified on Node 26.11.1; Node 24 minimum declared, not separately tested. [Package scripts](backend/package.json) use native `node --test tests/*.test.ts` and `tsc --noEmit`. Install restores pinned dev tooling from [lockfile](backend/package-lock.json); tests/typecheck need no provider key, service, VM or cloud database.

These commands **do not start an application** or contact model providers. No root app manifest, dev server, API endpoint or main-branch frontend launch command exists. Console install/build instructions belong to its separate PR and teammate-owned package. Node <24 support and non-erasable TypeScript syntax are outside this package's contract.

## Public protocol and state API

Wire version: `backend-protocol.v1`, readonly snake_case JSON records. [Protocol exports](backend/protocol/index.ts) expose three validators; [state exports](backend/state/index.ts) expose six functions. Both re-export public [types](backend/protocol/types.ts). These are local TypeScript functions, **not REST/WebSocket endpoints**.

<details>
<summary>All nine exact public function signatures</summary>

```typescript
validateSeed(input: unknown): Result<IncidentSeed>;
validateEvent(input: unknown): Result<EventInput>;
validateApproval(input: unknown): Result<ApprovalRequest>;
createIncidentState(seed: IncidentSeed): IncidentState;
commitEvent(state: IncidentState, input: unknown, context: CommitContext): Result<IncidentState>;
approveProposal(state: IncidentState, input: unknown, context: CommitContext): Result<IncidentState>;
validateCommandAcceptance(state: IncidentState, command: Command, context: CommitContext): Result<Command>;
replayLog(seed: IncidentSeed, log: readonly CommittedEvent[]): Result<IncidentState>;
selectReceivedSnapshot(state: IncidentState, received_at: string): Result<ReceivedSnapshot>;
```

Signature reference, not a standalone executable code block. Validators return owned accepted values or rejection. `createIncidentState` throws `TypeError` for invalid seed; other listed APIs return `Result<T>` with `ok`, then `value` or `code`/`reason`. Rejection leaves caller state unchanged. Invalid closed JSON includes unknown/prototype keys, accessors, cycles, functions and non-finite numbers. Schema validity proves neither source authenticity nor media bytes.

Rejection codes: `INVALID_SCHEMA`, `INVALID_TIME`, `VERSION_MISMATCH`, `UNAUTHORIZED`, `STALE_VERSION`, `STREAM_GAP`, `CONFLICT`, `EXPIRED`, `FROZEN`. Full record/ordering semantics: [bounded spec](docs/superpowers/specs/2026-11-14-backend-protocol-design.md#exact-boundary-records).

</details>

| Record / function group | Integration contract |
|---|---|
| `IncidentSeed` | Identity/zero initial revisions, current Chief/producer epochs, assets/feeds and finite declared candidates. No hidden world is exposed by a received snapshot. |
| `EventInput` | Envelope plus `telemetry.received`, `frame.received`, `hypothesis.received`, `proposal.created`, `command.receipt`, `authority.changed` or `chief.changed`. |
| `CommitContext` | Trusted actor, actual `recorded_at`/`received_at`, `sim_tick`, control mode. Body cannot supply canonical actor/session/revision metadata. |
| `IncidentState` | Immutable seed/identity/revisions, stream cursors and canonical log. Telemetry/frame/hypothesis/proposal maps retain committed wrappers; reservation/command maps hold typed records. |
| Approval | Exact current request creates one canonical `approval.committed` containing request/command/reservation. That kind is not accepted inbound `EventInput`. |
| Acceptance | Rechecks current committed command/producer/versions/expiry; returns command, creates no receipt or movement. |
| Replay / snapshot | Validates full log, including suffix, before success. Snapshot includes identity/revision/telemetry/frames/hypotheses/commands/cutoff, not seed/candidates/control state. |

<details>
<summary>Complete synthetic telemetry envelope and fixture-based public API example</summary>

```json
{
  "contract_version": "backend-protocol.v1", "incident_id": "i1", "run_id": "r1", "authority_epoch": 1,
  "event_id": "telemetry1", "stream_id": "telemetry:d1", "stream_sequence": 1,
  "trace_id": "trace-telemetry1", "causation_id": null, "kind": "telemetry.received",
  "payload": {
    "asset_id": "d1", "mission_id": null, "mission_version": 0,
    "captured_at": "2026-11-14T00:00:01Z", "capture_time_status": "known", "sim_tick": 1,
    "position": { "x_m": 100, "y_m": 200, "z_m": 300 }, "battery_percent": 90,
    "producer_id": "sim1", "capture_epoch": 1
  }
}
```

Fixture coordinates/battery are synthetic, not a real drone observation. From a TypeScript module under `backend/`, public exports can be exercised with existing [test fixtures](backend/tests/fixtures.ts):

```typescript
import { createIncidentState, commitEvent, selectReceivedSnapshot } from './state/index.ts';
import { seed, telemetry, context } from './tests/fixtures.ts';

const initial = createIncidentState(seed());
const committed = commitEvent(initial, telemetry(), context());
if (!committed.ok) throw new Error(`${committed.code}: ${committed.reason}`);
const snapshot = selectReceivedSnapshot(committed.value, '2026-11-14T00:00:01Z');
if (!snapshot.ok) throw new Error(`${snapshot.code}: ${snapshot.reason}`);
// snapshot.value.telemetry.d1.payload is observed synthetic data at this receipt cutoff.
```

`seed`, `telemetry` and `context` are test helpers, not public package APIs or authentication. Frame `media_ref` is an opaque ID (for example `media1`), not a URL fetch sink; valid metadata/hash strings do not prove media existence, decoding or content-hash verification. See [validation](backend/protocol/validation.ts), [reducer](backend/state/reducer.ts), [approval](backend/state/approval.ts) and [replay](backend/state/replay.ts).

</details>

## Repository map

```text
fire-command-center/
├── README.md / TASKBOARD.md / AGENTS.md / SOFTWARE.md
├── backend/
│   ├── protocol/       types.ts, validation.ts, index.ts
│   ├── state/          reducer.ts, approval.ts, replay.ts, index.ts
│   ├── tests/          fixtures plus validation/reducer/approval/replay suites
│   └── package.json / package-lock.json / tsconfig.json
└── docs/
    ├── assets/readme/  four code-native infographic families
    ├── contracts/      thermal-camera and crew-agent drafts
    ├── data/           camera/satellite candidate catalog
    ├── references/     preserved operational-clarity archive/index
    ├── specs/          simulator parameter draft
    └── superpowers/    approved protocol spec and historical test-first plan
```

Main has no `proposal/fcc/` application tree. That teammate-owned source remains in [PR #2](https://github.com/nikolas-sapa/fire-command-center/pull/2). Generated dependencies/output and private `.scratch/` are ignored, not product source. [Docs index](docs/README.md) distinguishes approved protocol, unapproved drafts and historical references.

## Contributing and file ownership

Read [AGENTS.md](AGENTS.md) and [TASKBOARD.md](TASKBOARD.md) first. Claim task, branch and exact files before edits; one active owner per file. Nontrivial implementation needs named numeric tests before plan, explicit non-goals, approved scope and independent review. Full V1 permission does not follow automatically from local protocol approval.

| Lane | Ownership |
|---|---|
| Design/simulator/frontend | Teammate owns all `proposal/fcc/**`, world/runtime/store/adapters/render/camera assets and frontend package/lock. Root never edits that source. |
| Architecture/data/backend/agents | Coordinator/root owns approved backend seams and versioned root contracts/data documents. Future paths require exact claims, not wildcard permission. |
| Shared schemas/locks/CI | One designated owner per shared file. Interface changes go through reviewed contract revision and all consumers, not silent cross-owner edits. |
| Delivery | Coding/document workers do not stage/push/merge/deploy. Authorized Git coordinator delivers explicit reviewed paths on branch/PR. |

Use separate task branches/worktrees; preserve other workers' changes. Do not rewrite simulator truth to fix an evidence discrepancy. Person-local pins/presets/replay cursors should remain outside shared incident revisions. An unused socket adapter, screenshot or green build is not a shared-state integration receipt.

## Verification and failure modes

Current 71-test suite calls actual local public exports with fixtures. It proves bounded consistency rules, not field observations, source permissions, real authentication or Convex atomicity. [Taskboard receipts](TASKBOARD.md) record reviewed/merged source separately from product acceptance.

| Suite | Count | Exercised locally |
|---|---:|---|
| [Validation](backend/tests/validation.test.ts) | 19 | Closed records, real calendar UTC, malformed values, declared thermal metadata and unknown fields. |
| [Reducer](backend/tests/reducer.test.ts) | 23 | Immutable ordering, duplicates/conflicts, actor/producer boundaries, received state and explicit freeze/takeover. |
| [Approval](backend/tests/approval.test.ts) | 18 | Current human-context/revision binding, local serialized races, reservation/TTL/lease and command acceptance. |
| [Replay](backend/tests/replay.test.ts) | 11 | Canonical reconstruction/cutoffs, receipt progression, corruption rejection and preserved critical hypotheses. |

Unproven: two real clients/20 approval races, full transport loss/retry/rejoin, real auth, thermal pixels/detection, hidden-truth isolation across actual adapters, browser accessibility/performance, route/energy physics, authorized model calls, deployment. Node 24 minimum remains unrun. Direct offline/frozen exact-duplicate approval coverage is a documented non-blocking test gap, not silently claimed solved.

| Failure | Core behavior / remaining integration duty |
|---|---|
| Wrong run/epoch/revision or malformed model-shaped result | Reject stale/invalid input, no mutation. Actual provider validation adapters pending. |
| Exact duplicate / conflicting reused ID | Authorized exact duplicate leaves current state unchanged; changed reuse rejects. Network retries not implemented. |
| Stream gap | `STREAM_GAP`, unchanged state. Future ingestor must commit explicit authority freeze before admitting further approvals, then reconcile. |
| Producer loss or Chief handoff | Explicit loss freezes; server takeover advances epochs; old intent blocked while executor history remains. No automatic host election. |
| Late frame or ACK | Preserve history without replacing newer last-known facts or regressing terminal status. UI stale presentation still pending. |
| Corrupt replay suffix | Reject complete log, not partial success. No replay-time calls/dispatch. |
| Provider outage / missing calibration / missing receipt | Planned deterministic fallback; unknown temperature remains unknown; absent progress is unconfirmed, never invented success. Provider/fault scheduler absent. |

## Roadmap and current gates

1. Adopt/reconcile full scope, teammate console, region/fidelity and file-level source/reuse manifest.
2. Integrate approved Convex authority and one simulator producer, real sessions and received-state frontend adapter; verify two-client approval races.
3. Add honest media/clocks/uncertainty, every-drone thermal fixtures, delivery/loss/reserve/rejoin and bounded model/source adapters.
4. Verify genuine authorized provider decisions plus offline fallback, dedicated Camera Room/presets, browser/performance and fresh replay/demo.
5. Lock reviewed receipts/attribution, then separately authorize deployment and submission if needed.

[TASKBOARD](TASKBOARD.md#detailed-build-cards-full-acceptance-gated) contains 44 existing cards and 78 workflow checkpoints; no full-product P0 card complete. Published draft/admin checks are not product readiness. Voice input, generated media and resident read-only view remain deferred; optional internal voice output needs separate threshold/ack/mute/cooldown agreement.

## Sources and attribution

[Camera/satellite catalog](docs/data/camera-satellite-resources.md) is the source of pinned candidate terms: MediaMTX MIT transport, HIT-UAV CC BY 4.0 recorded thermal fixtures, HPWREN archive/live permission distinctions, USGS public-domain volcano context, NASA GIBS/EONET dated context and optional Apache-2.0 PySTAC Client metadata helper. Each has different use limits. No sources ingested here; software license does not license imagery.

HIT-UAV labels must stay ground truth, not be passed as model answers. NASA event context is approximate/non-authoritative; 10 m satellite pixels cannot identify people. Public camera access does not grant automated retrieval, embedding or model-use rights. Preserve original source notices and changes for any later selected asset.

Prior [wildfire-sweep research](https://github.com/nikolas-sapa/wildfire-sweep/tree/66bb3c9), baseline `66bb3c9`, dated 2026-11-10, predates event work. Frozen outputs remain untouched. Any reuse requires **file-level source + commit + license + attribution**, with visible pre-existing/event-adapted/event-new split. No hidden reuse, masking or backdating. Existing [reference archive](docs/references/operational-clarity-index.md) preserves supplied historical material, not adopted product requirements.

Repository remains private and has no project-wide license grant. Broader publication/open-source licensing is not approved by this documentation task. Open-source-core monetization is a hypothesis, not a decided business model. Linked third-party licenses do not license this repository.

## Limitations, security and privacy

Prototype/synthetic relative danger indexes and paths are not validated operational forecasts or safe placements. Unverified person/object/fire appearance is not confirmed victim identity, canister contents or hazard severity. No life-saving, accuracy, ROI, staffing-percentage or customer-traction claims established.

Non-goals: real aircraft/vehicle control, emergency dispatch, field orders/public alarms, calibrated thermal measurements, validated identification/forecasting, full PX4/controller training, unlimited ingestion/autoscaling or unbounded agent autonomy. No deployment/shared application follows from local tests.

Retrieved articles, images, source metadata and model replies are untrusted data, not instructions. Future credentials stay server-side; never commit keys, `.env`, auth/browser bundles, balances or private account details. Current lexical media IDs have no fetch sink; actual upload/fetch permissions, redirect validation, private-network blocking, MIME/byte decoding and retention controls remain unimplemented.

Future camera/person evidence needs explicit access rights, minimal retained data and a reviewed privacy policy. This repo performs no live person identification or camera scanning. Schema validation cannot establish media ownership, privacy compliance or physically safe actions.

## FAQ

**Can I run the full visual product from main?** No. Main runs local protocol tests/typecheck. Visual console is separate draft PR #2, not adopted or deployed.

**Which models have actually run for this product?** None verified. Google/Iris/fal roles are planned; scripted console cards and fixture payloads are not inference receipts. Treg auth is not a product retrieval call.

**Why a larger agent team but only one Chief?** Analysts handle bounded logical tasks; accountable human chooses changed mission scope. Contexts do not each require a human, process or VM. Scale benefit remains a product goal, not measured.

**Are all drone feeds thermal?** Required in intended exercise and declared core seeds, not demonstrated in submitted console. False-color/EO mix does not prove thermal capability or temperature measurement.

**What does “live” mean here?** A local control-mode/context label, not proof of real footage, model access, cloud service or current source acquisition. Always inspect source mode and original clocks.

**What happens when evidence goes stale or link disappears?** Keep last-known facts and unresolved critical hypotheses; no invented arrival/completion. Core supports explicit freeze/version rules; integrated loss/rejoin and UI aging remain future work.

**Can models approve commands or invent target pins?** No intended authority. Chief context/revisions gate approval; unknown geography stays null. Models propose finite known options and unverified evidence-linked hypotheses.

**What should contributors do next?** Read TASKBOARD and claim an approved exact-file lane. Integration is gated; installing a SDK, using reported credits or deploying is not authorized merely by reading this guide.
