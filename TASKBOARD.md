# Fire Command Center shared taskboard

Snapshot: 2026-11-14, Europe/Athens. Preserve 44 task IDs. Separate research/admin receipts, submitted source and verified product milestones. [Brief](README.md) · [Rules](AGENTS.md) · [Parameter DRAFT/numeric cases](docs/specs/simulator-parameter-contract.md).

## Completion dashboard

- **Product implementation estimate: ~30%, plausible range 25–40%.** Provisional static source coverage of bounded V1 below, not measured readiness. Submitted UI/local world/fire/weather/synthetic feeds/scripted proposals/replay provide foundation. Authority, honest evidence/projection, delivery/energy faults, genuine providers, tests and integration remain incomplete/absent. No earned milestone credit without runnable receipts.
- **Verified product acceptance: 0/13 P0 cards complete, 0% independently verified V1 numeric acceptance.** No product card checked. Isolated build/typecheck independently passed on pinned PR2 source; author screenshots remain unverified. These are foundation checks, not V1 numeric acceptance.
- **Research/admin/draft checkbox ratio: 18/44 = 40.9%, not project completion.** Research/admin partition: 18/28 checked = 64.3%; 13 gated product + 3 deferred cards form remaining 16. Equal weights apply only to administrative ratios.
- **44 cards:** 18 done, 1 draft-ready, 2 scoped-active, 9 owner-action, 11 gated, 3 deferred. P0-02/P0-10 active ONLY for approved local protocol foundation; no product card complete. REF-01/PARAM-01 remain published drafts, not app features.
- Private [PR #1](https://github.com/nikolas-sapa/fire-command-center/pull/1) merged, baseline main `ed470de61df5fad86c249d6a2a7facfb5d1666aa`. [Draft PR #2](https://github.com/nikolas-sapa/fire-command-center/pull/2), author marcseli, source 6bdb58843a33a70806ff9ca053407d57926ac6aa: submitted prototype, **not adopted/merged** in this board baseline. Independent isolated Node 26.11.1/npm ci --ignore-scripts/build/typecheck passed at pinned head; no V1/provider/shared-client/browser-perf acceptance. Backend protocol cases not yet run.
- PR2 conflict is **TASKBOARD.md only**, not app source. Its PROP-01 card is not imported into this 44-ID planning snapshot. Future approved reconciliation must retain PROP-01 plus these 44 IDs (45 total), recompute statuses and preserve author ownership.

PR2 uses Vite 5/React 18/strict TypeScript/Tailwind 3/Cesium, Node ≥22, real dev/build/typecheck/preview scripts. No test script, CI or backend. ConsoleProvider/runtime/world/director/StageArea/evidence/feed UI is locally wired; WebSocket adapter is built **unwired**, 0 connector calls. Store reads simulator snapshots, not a received-event reducer. Backend-contract prose overstates reducer/command-sink implementation. Static audit flags high-risk autoapproval, cosmetic battery, future-ground-truth projection and Inter/orange theme. **0 genuine Google/Iris/fal/Treg product calls.** Independent isolated build/typecheck passed, not browser/evidence/approval/fault validation. Earlier “no app code exists” prose is stale for PR2, still true of main/planning delta; do not edit another owner's files to hide discrepancy.

## Scope, gate and non-goals

Bounded V1 candidate: small human crew, shared received Map + dedicated Camera Room, role presets, ranked PIP feeds/replay. **Every simulated drone has a thermal camera**; contract/observations/backend are root-owned, simulator/render/feed UI teammate-owned. EO may be an optional second channel. Chief approves collection scope and revised simulated ground placement. Distinguish proposed/approved/sent/delivered/accepted/completed. Wind/terrain-shadow blackout preserves last-known state, reserve and reconciled rejoin. Weather/terrain inform explicitly relative toy fire projections, not operational forecasts.

Actual analysis candidate: labelled synthetic exercise media, hidden planted person/canister/dry-brush truth; models inspect pixels, never answer metadata. Every drone thermal feed must have feed_id/modality, acquisition versus receipt clocks and explicit synthetic/real/radiometric/calibration status. False-color simulation is not measured temperature or thermal detection proof; no invented temperature/range/confidence. Must verify Google/fal thermal support before selecting task; Iris ranks by actual modality/capability. Google orchestrates, Iris ranks finite feasible choices if access ready; fal Florence/video-understanding/SAM analysis selection pending. Treg is a tool registry/source retrieval, not model router. Boxd CPU jobs bounded/disabled pending budget, 0 VMs. Provider outage must preserve deterministic fallback.

North Evia/Greek data is a candidate; existing PR2 Caldor is placeholder, not silently replaced. Region/fidelity/fixture (proposed 2 bases/4 drones/2 fires/2 vehicles), runtime/authority/providers/spend/sources/tests require adoption. Parameter DRAFT: 14 proposed numeric tests; latest external MVP/UI draft: 14 MVP tests; architecture draft: 17. Different unapproved documents, not passed tests. Architectural changes return to spec approval.

Non-goals: real aircraft/vehicle control, field orders/public alarms, validated identification/fire forecast/safe placement, full PX4/rotor/controller training, local Gemma/on-device claims, unlimited ingestion/autoscaling, unauthorized provisioning/paid calls/undisclosed reuse. Optional internal voice **output** needs defined threshold/ack/mute/cooldown; input/resident view deferred. Prior [wildfire-sweep 66bb3c9](https://github.com/nikolas-sapa/wildfire-sweep/tree/66bb3c9) pre-event/frozen/untouched; reuse requires file/commit/license/notices and prior/adapted/new split.

## Current ownership claims

USER-GO-2026-11-14: approved Convex eventual shared authority + single teammate simulator producer + protocol-only coding PR. [Final bounded spec](docs/superpowers/specs/2026-11-14-backend-protocol-design.md) and [test-first four-task plan](docs/superpowers/plans/2026-11-14-backend-protocol.md) formalize reviewed boundaries. No full V1/provider/deploy permission.

| Lane | Owner | Branch / exact boundary |
|---|---|---|
| Protocol spec/plan/board gate | /root/protocol_plan_and_gate, coordinator reassignment | task/backend-protocol: docs/superpowers/specs/2026-11-14-backend-protocol-design.md, docs/superpowers/plans/2026-11-14-backend-protocol.md, TASKBOARD.md, AGENTS.md only; docs owner, no application/Git writes |
| Protocol Task 1, awaiting root review/start | /root/backend_protocol_task1, schema/backend lock owner | task/backend-protocol: backend/package.json, backend/package-lock.json, backend/tsconfig.json, backend/.gitignore, backend/protocol/types.ts, backend/protocol/validation.ts, backend/protocol/index.ts, backend/tests/fixtures.ts, backend/tests/validation.test.ts only |
| Protocol Tasks 2–4 | Unassigned until coordinator handoff | Exact files in four-task plan, no edit without named claim; shared schema/fixtures remain Task 1 owner's files |
| REF-01 published source | /root/visual_catalog_github, lane finished | chore/hackathon-planning: docs/references/operational-clarity-supplied.md, docs/references/operational-clarity-index.md |
| PARAM-01 published DRAFT | /root/simulator_parameter_contracts, lane finished | chore/hackathon-planning: docs/specs/simulator-parameter-contract.md |
| Design/simulator/frontend | Frontend/simulator teammate (PR2 author marcseli; identity pending) | proposal/fcc-console: proposal/fcc/** exclusively, including runtime/store/sim/render/assets/package-lock; other proposal/** preserved |
| Architecture/data/backend/agents/integration | Coordinator/root lane, USER-OWN-2026-11-14 | Future backend/**, docs/contracts/**, docs/data/**, docs/architecture/**; no edits to teammate app code |
| Thermal/crew interface planning | /root/thermal_camera_contracts, coordinator claimed | chore/hackathon-planning: docs/contracts/thermal-camera.md, docs/contracts/crew-agent-boundaries.md ONLY; claimed planning responsibility, source pending, app cards gated |
| Git delivery | Authorized Git specialist/coordinator | Explicit approved planning paths only, review before integration; no blanket staging |
| Local setup | Supervised backend setup agent | Boxd/Treg auth outside repo; no application/provider inference implied |

**Functional ownership confirmed; exact protocol Task 1 claims approved above, all other app claims gated.** Frontend/simulator teammate (PR #2 author marcseli, identity confirmation pending) owns design + ALL proposal/fcc/**, including world/runtime/store/adapters/camera render/assets/frontend lock. Coordinator/root owns architecture/data/backend/agents/integration: future backend/** plus docs/contracts/**, docs/data/**, docs/architecture/**. Root never edits teammate app files; teammate consumes versioned root contracts. Frontend lock: teammate; backend protocol schema/lock: Task 1 worker; shared CI/integration: coordinator, exactly one active owner per file. Other future backend/document paths remain candidates, not stack approval; claim exact files/branch before edits. Teammate identity confirmation does not undo assigned functional ownership.

## Product milestones, prospective weights

Weights total 100% of proposed bounded V1, exclude research/admin/deferred scope. Priorities for later verified tracking, not automatically earned progress or selected architecture.

| Reviewable milestone | Weight | Cards / next dependents |
|---|---:|---|
| M1 Adopt/reconcile spec + runnable PR2 foundation | 10% | P0-01/P0-12 → M2–M9 |
| M2 Contracts, sole authority, two-client approval | 15% | P0-02/P0-10 → M3/M4/M6/M7 |
| M3 Honest evidence/clocks/weather/projection/map fade | 12% | P0-03/P0-04/P0-08 → M5/M6/M7 |
| M4 Delivery/loss/rejoin/routes/reserve | 15% | P0-05/P0-06/P0-10 → M6/M9 |
| M5 Source/sample-media ingestion + genuine analysis | 12% | P0-07/P0-08 → M6/M9 |
| M6 Validated Google/Iris adapters + cheap fallback | 10% | P0-07/P0-10 → M7/M9 |
| M7 Camera Room/ranked PIP/role presets/replay | 12% | P0-09 → M9 |
| M8 Simple Geist/blue theme, optional alert output | 4% | P0-09, voice opt-in only → M9 |
| M9 Integration/CI/perf/fresh demo/access/submission | 10% | P0-11/P0-12/P0-13; O04/O05/O07–O09 |

## Completed research/admin, never product credit

- [x] REF-01 · P0 · done, published source DRAFT · Reference lane: both complete essays archived at cba56a4, [index](docs/references/operational-clarity-index.md) covers 9 retrieved resources/179 raw URL occurrences, not verified full catalog; 0 media imports/app approval.
- [x] PARAM-01 · P0 · done, published unapproved DRAFT · Parameter lane: [contract](docs/specs/simulator-parameter-contract.md) at cba56a4, 14 numeric cases/20 parameters/7 records/10 edge classes, 0 executable schema/test passes.
- [x] SPEC-01 · P0 · done · Coordinator: latest external MVP-SPEC-DRAFT.md (103 lines/14 proposed tests), SIMPLE-UI-DRAFT.md (71 lines), refinement only, 0 adoption/runtime selection.
- [x] PROVIDER-01 · P0 · done · Coordinator: 3 fal analysis schemas researched, SAM separate, Treg role clarified; credits reported/access unverified; pasted Oumi abstract is not submission.
- [x] D01 · P0 · done · Coordinator: 1 kickoff/intake review, 0 implementation approvals.
- [x] D02 · P0 · done · Coordinator: 1 prior repo/baseline identified, 0 imports.
- [x] D03 · P0 · done · Coordinator: 1 architecture/options pass, 0 choices adopted.
- [x] D04 · P0 · done · Coordinator: 1 proposed 90-second story, 0 organizer-limit claims.
- [x] D05 · P0 · done · Coordinator: 3 provider roles researched, 0 inference receipts.
- [x] D06 · P0 · done · Coordinator: 1 weather retrieval/projection boundary, 0 validated forecasts.
- [x] D07 · P0 · done · Coordinator: 1 licensing/rendering/SDK options pass, 0 dependency selection.
- [x] D08 · P0 · done · Coordinator: 2 reference families/UI draft reviewed, 0 adopted design/copied branding.
- [x] D09 · P0 · done · Coordinator: 1 provenance/new-work workflow, 0 fake milestones.
- [x] D10 · P0 · done · Original writer: 37-ID historical board checked, remains untouched.
- [x] A02 · P0 · done · Setup research: 8 organizer pages read, latest crew-updated 1,417-character abstract supplied/pasted; 0 actual registration/API receipts.
- [x] O02 · P0 · done · Nikolas/Git specialist: 1 new private repo, 0 old-repo mutations.

## Draft and owner actions

- [ ] A01 · P0 · draft-ready · Architecture writer/coordinator: external DRONE-ARCHITECTURE-DRAFT.md, 17 proposed tests/13 failure cases/non-goals; needs 1 aligned owner approval, not draft existence.
- [x] SETUP-01 · P0 · done · Docs/Git specialist: initial 4 planning files at 59ee562 remote-blob checked; later docs cba56a4/draft PR1, not app milestone.
- [x] SETUP-03 · P0 · done · Supervised setup: Boxd/Treg scoped read-only auth verified, private configs outside repo, 0 VMs/paid calls/global routing changes; unsafe onboarding rerun skipped.

Next owner decisions (3): **(1)** adopt/adapt PR2 versus rebuild, written V1/region/test/source choices; **(2)** confirm marcseli identity and exact-file handoffs within already assigned teammate/root lanes; **(3)** confirm Oumi/Google access and bounded provider/Boxd budget privately. No keys/login addresses here. Organizer submission confirmation still pending.

- [ ] O01 · P0 · owner-action · Nikolas: 1 explicit foundation/scope/fidelity/authority/provider/test/non-goal decision set, unlock P0-01/P0-12.
- [ ] O03 · P0 · owner-action · Nikolas: 1 region/extent, Caldor placeholder versus Greece case, unlock P0-03/P0-04/P0-08.
- [ ] O04 · P0 · owner-action · Team/Nikolas: registered count = confirmed team size, 100% Oumi access statuses; abstract is 0 receipts.
- [ ] O05 · P0 · owner-action · Team: 1 provisioned Google project/authorized route verified privately; credential presence fails; unlock real P0-07.
- [ ] O06 · P0 · owner-action · Nikolas: 1 approved direction/assets, Geist/#006bff/no orange/no emoji, unlock theme P0-09.
- [ ] O07 · P0 · owner-action · Nikolas/organizer: 1 portal/deadline/video-limit/artifact checklist. Working target 2026-11-15 18:00 Athens unconfirmed; 90 seconds proposed story only.
- [ ] O08 · P0 · owner-action · Nikolas: 1 file-level source/reuse manifest, 100% selected files/assets licensed/attributed, 0 hidden/backdated work.
- [ ] O09 · P0 · owner-action · Nikolas/organizer: 1 entry/reuse-terms confirmation or not-applicable decision, personal details private.
- [ ] SETUP-02 · P0 · owner-action · Nikolas/authorized Git specialist: 1 confirmed handle, authorized/accepted invite if needed, task/branch/files agreed; PR author ≠ confirmed identity/invite. Functional frontend/simulator/design ownership already assigned, not blocked by name.

## Detailed build cards, full acceptance gated

Evidence: static PR2 audit at 6bdb5884 + independent isolated build/typecheck PASS (Node 26.11.1/npm ci --ignore-scripts), **not V1 acceptance**. Each card has 6 ordered checkpoints: named RED cases → minimal implementation → GREEN → review → integrate → proof. None checked. Candidate paths require spec/author reconciliation before claim. E01–E10/P11–P14 refer to parameter DRAFT; numeric targets remain proposed.

- [ ] P0-01 · P0 · gated · Adopt spec/tests/manifest. Owner: Coordinator/root architecture/spec/review lane. Evidence: drafts documented, adoption **absent**. Depends O01/O03/O06/O08/O09 → every build card. Candidate: docs/architecture/v1-approved.md, docs/data/reuse-manifest.md, TASKBOARD.md (coordinator lane).
  - [ ] RED S01: 100% approved requirements mapped to named numeric cases, 0 unresolved architecture choices/undisclosed imports; missing-map fixture fails before impl plan.
  - [ ] Minimal: reconcile drafts/PR2, selected scope/non-goals/authority/providers, pin source licenses/attribution.
  - [ ] GREEN S01: 1 aligned owner-approved spec + 1 complete manifest; runtime cases stay unrun.
  - [ ] Review: owner/coordinator, 0 silent architecture substitutions/unsupported readiness claims.
  - [ ] Integrate: reviewed planning PR, agreed file ownership; no inferred app approval.
  - [ ] Proof: approval/date/spec hash/manifest receipt, 100% adopted/deferred requirements visible.
- [ ] P0-02 · P0 · scoped-active · Contracts/validators/sole authority/CI. Owner: Coordinator/root, Task 1 schema/backend-lock worker claimed above. Approved local subset: protocol validators + immutable received reducer + tests, BP01/BP02/BP03/BP05/BP08, four-task plan Tasks 1/2/4. Evidence: final bounded spec/plan present, 0 backend runtime tests executed; full network/auth/Convex/CI/two-client integration still gated. Depends P0-01/P0-12 for full V1, not approved isolated protocol. Exact current source claims above; future backend/contracts/events.ts, backend/authority/session.ts, backend/transport/websocket.ts and .github/workflows/verify.yml remain unclaimed/gated. All proposal/fcc/** consumers/lock teammate-only.
  - [ ] RED C02/E02: 2 clients/20 approval races → 1 winner each; 20 old-owner approvals → 0 accepts; 24 malformed/cross-run events → 0 mutations.
  - [ ] Minimal: root backend schema/reducer/compare-and-commit + versioned interface; teammate wires frontend transport/store, root never edits it; approved test scripts/CI.
  - [ ] GREEN C02: same authoritative version 20/20 trials, 10 local view changes affect 0 peer selections; real dist imports checked.
  - [ ] Review: contracts/TS/security, 0 blockers; backend prose matches actual reducer/command behavior.
  - [ ] Integrate: single schema/lock/CI owner, 100% signature call sites updated, approved foundation only.
  - [ ] Proof: commit/CI receipt/2-client race traces, not socket-open/mock-only success.
- [ ] P0-03 · P0 · gated · Seeded editable world/fixtures. Owner: Frontend/simulator teammate. Evidence: Caldor world/units **builtwired/unverified**, proposed fixture/editor **absent**. Depends P0-01/P0-02/O03 → P0-04/P0-05/P0-08/P0-09. Candidate: teammate-only proposal/fcc/** world/scenario/parameter modules, exact existing paths teammate claims; root docs/architecture/simulator-boundary.md, docs/contracts/world-observation.md only.
  - [ ] RED W03/E01: exact approved fixture (candidate 2/4/2/2), 10 seeds × 600 ticks × 2 runs → identical canonical hashes, 0 model writes to truth.
  - [ ] Minimal: teammate builds bounded world/editor/presets/thermal camera simulator; root defines coordinate/observation contracts, hidden test truth separate.
  - [ ] GREEN W03: 100% boundaries tested, 0 NaN/Infinity/out-of-tile states; pause/reset logged, 0 skipped ticks.
  - [ ] Review: simulation/source, 0 unsupported reconstruction/fidelity; Caldor/Evia choice explicit.
  - [ ] Integrate: approved contracts/region/manifest, reconcile author world modules, pin scenario version.
  - [ ] Proof: seeds/input/scenario/final hashes + machine/run date, not source existence.
- [ ] P0-04 · P0 · gated · Toy terrain/weather/fuel/fire/smoke. Owner: Frontend/simulator teammate, root data/architecture contract support. Evidence: Caldor layers/cached weather **builtwired/unverified**. Depends P0-03/O03/O08 → P0-05/P0-08. Candidate: teammate-only proposal/fcc/** environment/fire/smoke/render, exact paths teammate claims; root docs/data/case-manifest.md, docs/contracts/weather.md.
  - [ ] RED W04/E01/E09: 10 seeds × 600 ticks → 0 non-finite/out-of-bounds states; 20 weather fixtures → 0 invalid accepts, RH 0/100 accepted.
  - [ ] Minimal: teammate toy wind/moisture/slope/fire/smoke controls; root supplies documented source units/epoch/terrain-fuel proxies, no frontend edits.
  - [ ] GREEN W04: 100% accepted weather source/units/time/geo retained, 0 reanalysis called as-issued forecast, all layers simulated/relative.
  - [ ] Review: weather/source, 0 fire/RF/safety calibration or future burn-context leaks.
  - [ ] Integrate: approved world bounds only, no silent dataset/dependency substitution.
  - [ ] Proof: manifest/6,000-tick state checks/assumptions, screenshots alone insufficient.
- [ ] P0-05 · P0 · gated · Feasible drone/ground routes/reserve/mission state. Owner: Frontend/simulator teammate, root mission/feasibility contract support. Evidence: routes/movement **partial**, cosmetic battery/energy-separation verification **absent**. Depends P0-02/P0-03/P0-04 → P0-06/P0-10. Candidate: teammate-only proposal/fcc/** units/routes/energy/mission simulator, exact paths teammate claims; root docs/contracts/mission-feasibility.md, backend/validation/feasibility.ts.
  - [ ] RED X05/E05: 40 feasible + 40 infeasible routes at 0/6/10 m/s wind, reject 40/40 infeasible; 10 closed bases → 0 false returns.
  - [ ] Minimal: teammate tick-based burn/routes/local failsafe/hold/events; root feasibility/mission/reservation contract and backend validation.
  - [ ] GREEN X05: approved separation/clearance/≥10 battery pp at confirmed return, 0 in-flight energy increases/overlapping assignments.
  - [ ] Review: executor/security, 0 click-driven fake arrival/completion; limits illustrative.
  - [ ] Integrate: authoritative reservation/approval versions, dependents read actual executor events.
  - [ ] Proof: route/energy/distance/speed/dwell traces and transported terminal receipts.
- [ ] P0-06 · P0 · gated · Delivery/ACK/LOS/loss/retry/rejoin. Owner: Coordinator/root backend delivery contract; teammate simulator link/executor adapter. Evidence: mission semantics **absent**, unused WebSocket reconnect is not mission transport. Depends P0-02/P0-05 → P0-10/P0-11. Candidate: backend/transport/messages.ts, backend/transport/reconcile.ts, backend/transport/delivery.test.ts, docs/contracts/delivery.md; proposal/fcc/** simulated link/executor adapter teammate-only.
  - [ ] RED T06/E03–E05: 100 commands/30% loss/20 duplicate injections/0–8 s delay/reorder 5 → 0 fake ACKs/duplicate executes/stale overwrites; ≤2 retries.
  - [ ] Minimal: root separate sent/delivered/accepted/terminal backend contracts/reconcile; teammate seeded link/terrain-shadow simulator and executor adapter.
  - [ ] GREEN T06/E04: 30 s blackout → stale ≤6 s/failsafe ≤11 s; 20 expired/offline intents → 0 reconnect dispatches; unlock after 2 fresh heartbeats.
  - [ ] Review: transport/security, 0 ACK-as-completion/forged receipts/resumed stale approvals.
  - [ ] Integrate: executor revalidates commands, shared UI only transported receipts/last-known state.
  - [ ] Proof: command/transmission IDs/fault draws/receipt clocks/rejoin traces, send ≠ delivery.
- [ ] P0-07 · P0 · gated · Real typed analysis/Google-Iris finite proposals/fallback. Owner: Coordinator/root backend/agents/data integration. Evidence: scripted agents/drafts **builtwired**, actual Google/Iris/fal/Treg **absent**. Depends P0-01/P0-02/P0-08/O04/O05/O08 + authorized spend → P0-10/P0-11. Candidate: backend/providers/google.ts, backend/providers/iris.ts, backend/providers/fal.ts, backend/tools/news.ts, backend/analysis/hypotheses.ts, backend/orchestrator/finite-actions.ts, backend/analysis/hidden-truth.test.ts; docs/contracts/thermal-camera.md, docs/contracts/crew-agent-boundaries.md.
  - [ ] RED A07/E08/P12/P13: 24 invalid/stale + 20 superseded replies → 0 dispatches; 3 planted hazard types/EO-thermal capability cases → 0 answer leaks/invented temperatures; measure detections, no 100% promise.
  - [ ] Minimal: root validated modality-aware pixel/source analysis + finite choices, cheap fallback/server-side keys; verify actual Google/fal thermal capabilities, Treg tools only; teammate provides labelled thermal pixels.
  - [ ] GREEN A07 after authorization: ≥2 genuine typed-analysis/finite-choice decisions with model/route/latency/trace; timeout ≤8 s, ≤2 in flight/≤30 calls per 10 min/queue ≤8; 600 ticks offline.
  - [ ] Review: TS/security/provider, 0 key/source-instruction leaks; Boxd ≤2 CPU jobs/≤30 s each only if approved, 0 VMs/recursive spawn.
  - [ ] Integrate: received evidence/current approval versions, revalidate return/approval/acceptance; fixtures never labelled live.
  - [ ] Proof: genuine receipts/spend cap/failure-fallback runs, credentials/scripted cards count 0 integration receipts.
- [ ] P0-08 · P0 · gated · Media/provenance/clocks/uncertainty/weather/projection/fade. Owner: Coordinator/root data/evidence/projection backend; teammate renders layers. Evidence: cached inputs/age **partial**, full provenance/contradictions **absent**, future-arrival truth projection **invalid evidence forecast**. Depends P0-02/P0-03/P0-04/O03/O08 → P0-07/P0-09. Candidate: backend/evidence/records.ts, backend/evidence/ingestion.ts, backend/evidence/received-clock.ts, backend/projection/relative.ts, backend/evidence/evidence.test.ts, docs/data/source-manifest.md; all proposal/fcc/** UI/simulation teammate-only.
  - [ ] RED E08/E07/E09: 100 evidence + 24 contradiction/injection fixtures → 0 invented pins/confidence/erased contradictions/source executions; 20 weather fixtures → 0 invalid accepts.
  - [ ] Minimal: root source/acquisition/post/retrieve/receive/geo/license/modality/calibration records and relative backend projection; teammate supplies rendered observations; no hidden future arrays/non-radiometric temperatures.
  - [ ] GREEN E08: 100% provenance retained, age 20 unresolved life alerts → 0 silent clearances; 3 sample hazard types synthetic/unverified, 0 future truth reads in analysts/projection.
  - [ ] Review: evidence/source, 0 synthetic/live confusion, identification/forecast claims or invented social author/location.
  - [ ] Integrate: shared receipt reducer/manifest, fading presentation only, unresolved evidence remains.
  - [ ] Proof: source/sample manifest/observation-retrieval receipts/hidden-truth isolation/fade results.
- [ ] P0-09 · P0 · gated · Shared Map/Camera Room/PIP/presets/replay/Geist. Owner: Frontend/simulator teammate, root feed/observation/ranking contract. Evidence: 3D/feeds/ranking/local replay **builtwired/unverified**, dedicated Camera Room/PIP/presets **absent/partial**, required thermal feeds **not demonstrated**, Inter/orange theme noncompliant. Depends P0-02/P0-03/P0-08/O06 → P0-11/P0-13. Candidate: teammate-only proposal/fcc/** Map/Camera Room/PIP/presets/replay/theme/thermal render, exact component paths teammate claims; root docs/contracts/thermal-camera.md, backend/feeds/ranking.ts, backend/feeds/observations.ts.
  - [ ] RED U09/E06/E10/P14: 6 feeds/100 frames → ≤1 owner/feed/100% ticks-clocks-mode; 20 stale choices → 0 promoted current; 3 replay runs → 0 future events/new calls.
  - [ ] Minimal: teammate dedicated Map+Camera/PIP/presets/replay/Geist/thermal render; root feed metadata/ranking/versioned thermal contract, frontend adapters teammate-only.
  - [ ] GREEN U09: 4/4 proposed baseline drone thermal feeds show feed_id/modality/source/synthetic/calibration unknown-or-valid, 0 synthetic temperatures; 2 screenshots/10 changes affect 0 peers; >3 s age stale ≤1 update. Optional approved voice: 20 repeats ≤1/key/cooldown, mute 20/20.
  - [ ] Review: UI/accessibility/source, 0 fake-fresh overlays; ack/mute ≠ incident resolution; no emoji/voice dispatch.
  - [ ] Integrate: approved freshness/rank/contracts, Map retained alongside preview, author components handed off first.
  - [ ] Proof: proposed M3/16 GiB with recorded OS/browser, 2 clients/10 min/1920×1080 each ≥30 FPS/p95 ≤33.3 ms/0 skipped ticks; unrun remains unclaimed.
- [ ] P0-10 · P0 · scoped-active · Chief approval/fault replanning/last-known/reserve/rejoin. Owner: Coordinator/root; Task 3 source owner assigned after Task 2 review. Approved local subset: version-bound approval/reservation/command model + acceptance/replay/fault fixtures, BP04/BP05/BP06/BP07/BP08, four-task plan Tasks 3/4. Evidence: approved boundaries/formal spec, 0 executable backend receipts; local CAS cannot prove Convex/two-browser atomicity. Full feasibility/transport/providers/replan and actual Chief/executor integration remain gated by P0-02/P0-05/P0-06/P0-07/P0-08. Future backend/orchestrator/replan.ts, backend/resilience/replan.test.ts and crew-contract revisions unclaimed; all proposal/fcc/** simulator/runtime changes teammate-only.
  - [ ] RED R10/E02–E05/E08/E10: 20 races/20 old-owner approvals → 0 duplicate/stale accepts; 10 revised ground placements → 10 current Chief approvals/0 fabricated user approvals.
  - [ ] Minimal: root proposal/approval/revalidation/backend replan; teammate removes scripted autoapproval via reviewed contract revision, implements simulator local holds/reserve/rejoin.
  - [ ] GREEN R10: all 10 E01–E10 + trace/overload classes recorded; 20 replay/offline approvals → 0 dispatches/fake completions; reconcile bound approved after 2 fresh heartbeats.
  - [ ] Review: safety/TS/security, 0 real orders/unbounded autonomy/stale intent revived.
  - [ ] Integrate: approval shared-file owner only, transport/executor factual state, 0 conflicting schema owners.
  - [ ] Proof: Chief/race/blackout/rejoin traces; scripted demo is not human-approval evidence.
- [ ] P0-11 · P0 · gated · E2E/security/CI/visual/performance verification. Owner: Coordinator/root integration/review, teammate UI/simulator proof. Evidence: numeric/E2E/CI **absent**, isolated build/typecheck **passed**, V1/shared-client/browser/perf **unrun**. Depends P0-02–P0-10 + foundation phase P0-12 → P0-13. Candidate: backend/tests/integration/approval.test.ts, backend/tests/integration/providers.test.ts, docs/verification/v1-receipts.md; teammate owns proposal/fcc/** browser/sim test files, CI coordinator-owned.
  - [ ] RED V11: enumerate 100% approved cases, reproduce autoapproval/future-truth/cosmetic-energy gaps before trusting fixes.
  - [ ] Minimal: root backend/integration/security harness/receipts, teammate browser/sim/thermal fixtures; ≥1 non-mocked external/dist check per integration package.
  - [ ] GREEN V11: 100% applicable named tests pass/0 blockers; proposed M3/16 GiB, 2 clients/10 min/1080p ≥30 FPS/p95 ≤33.3 ms/0 skipped ticks, OS/browser recorded.
  - [ ] Review: independent TS/security/UI reviewers, skipped/live-fixture distinctions visible, 0 operational/inference overclaims.
  - [ ] Integrate: exact candidate commit/CI/coordinator review, 0 unresolved merge/lock/schema conflicts/stale-server results.
  - [ ] Proof: commands/exit codes/commit/environment/seeds/perf/trace location + actual authorized provider receipts, push ≠ deployment.
- [ ] P0-12 · P0 · gated · Adopt/reconcile foundation, genuine working PR milestones. Owner: Coordinator/root Git integration; teammate source review/handoff. Evidence: submitted source **present**, adoption/integration **absent**, board-only conflict/0 checks. Depends O01/P0-01 → P0-02–P0-11; final closure after P0-11. Candidate: TASKBOARD.md/AGENTS.md (coordinator docs), docs/verification/foundation-receipt.md; author-approved exact proposal/fcc/** subsets teammate-only, no wildcard edit grant to root.
  - [ ] RED I12: 1 adoption/author ownership decision, 0 board conflicts; retain 44 IDs + PROP-01 = 45 after approved merge, 100% selected sources attributed; fresh build/typecheck exposes failures first.
  - [ ] Minimal: reconcile planning board/base with author, preserve prototype, correct unsupported claims, real reviewable slices not fake commit tasks.
  - [ ] GREEN I12: retain independent isolated install/build/typecheck PASS on 6bdb5884/Node26.11.1/npm ci --ignore-scripts; add preview/real-browser/thermal receipts on exact adopted commit. Whole checkpoint incomplete, provider/approval acceptance 0.
  - [ ] Review: coordinator/TS/security after conflict settled, 0 blockers; independent isolated build/typecheck passed; screenshots/browser/acceptance unverified.
  - [ ] Integrate: genuine working milestone PRs with receipts, count by real boundaries not arbitrary quota; docs worker never pushes/merges.
  - [ ] Proof: base/head/review/check/merged-state per milestone, 100% prior/adapted/new disclosed; planning PR earns 0 product milestone credit.
- [ ] P0-13 · P0 · gated · Honest fresh demo/backup/submission. Owner: Coordinator/root demo/integration, teammate visual/sim demo, Nikolas submission. Evidence: author-scripted ~185 s demo **present/unverified**, team fresh demo/submission **absent**. Depends P0-11/P0-12/O04/O05/O07–O09. Candidate: docs/demo/runbook.md, docs/demo/attribution.md, docs/verification/submission-receipt.md; teammate proposal/fcc/** visual/sim changes, approved recording outside source.
  - [ ] RED D13: 1 confirmed portal/deadline/video/artifact checklist, 0 unlabeled synthetic/recorded/live/prior claims; 90 s story only if allowed.
  - [ ] Minimal: evidence → analysis → reviewed placement → factual delivery/acceptance → blackout/rejoin/replay; explicit fallback/source attribution.
  - [ ] GREEN D13: 1 fresh-session demo + 1 backup within actual limit; mode/unverified labels on 100% shown decisions.
  - [ ] Review: owner, 0 false operational/provider/new-work claims, complete materials/permissions.
  - [ ] Integrate: final verified commit/assets locked, submission only after authorization; deploy/provision separately gated.
  - [ ] Proof: actual submission before confirmed deadline/receipt/demo commit/run date/backup link; abstract or PR is not submission.

## Deferred scope, excluded from estimate

- [ ] P1-01 · P1 · deferred · Voice input, owner unassigned. Candidate teammate-only proposal/fcc/** push-to-talk file, exact path teammate claims after opt-in/P0-11. Test: 10 ambiguous commands → 0 unconfirmed dispatches, 1 push-to-talk control, 0 always-listening/bypass. Optional output belongs P0-09.
- [ ] P1-02 · P1 · deferred · Generated fal exercise media, owner unassigned. Candidate docs/provenance/generated-media.md after opt-in/O08/authorized spend. Test: ≥1 synthetic asset/100% provenance/license/0 imagery presented real. Actual sample analysis core P0-07, not optional generation.
- [ ] P2-01 · P2 · deferred · Resident read-only view, owner unassigned. Candidate teammate-only proposal/fcc/** resident view, exact path teammate claims after opt-in/P0-11. Test: 10 attempted mutations rejected, 0 fleet commands/public alarms; reports moderated/unconfirmed.

## Status/receipt rules

Done requires scoped evidence. Builtwired means connected source, not runtime-tested; partial/unwired/absent unfinished. 6 checkpoints/P0 card = 78 workflow steps, not 78 new cards. Claimed thermal/crew contract planning docs remain pending, not checked app completion. Unknown never checked. Preserve 44 IDs, reconcile 45 only with approved PROP-01 merge, update counts.

Protocol-only code gate opened by USER-GO-2026-11-14 and exact four-task plan; full V1 gate remains. Exact-file/branch claims before work; preserve peers/reviewed PRs. Board authorizes no provider calls/VMs/invites/deploy/submission. Credentials stay outside. Critical chain: **local protocol validation/received reducer → current approval/fault tests → separately approved shared Convex/frontend integration**, then genuine providers/camera/fault/demo gates. No full product checkbox earned here.
