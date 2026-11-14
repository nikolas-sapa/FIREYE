# Fire Command Center shared taskboard

Snapshot: 2026-11-14, Europe/Athens. This repository board is the shared truth for future task claims and status updates. It preserves the 37 original task identities, adds 3 setup cards and updates stale administrative facts. The earlier local board remains an untouched historical snapshot.

41 cards: 14 done, 1 draft-ready, 1 active, 9 owner-action, 13 gated, 3 deferred. Application implementation completed: 0. New private repositories created: 1. “Done” below includes completed research/admin work, not a built application.

[Brief and non-goals](README.md) · [Resident collaboration rules](AGENTS.md)

Working submission target: Sunday 2026-11-15, 18:00 Athens. Actual portal, organizer-confirmed deadline, required artifacts and video limit still need confirmation. The proposed 90-second story is not an organizer limit.

## Scope and approval boundary

Candidate: incident intelligence for firefighters/first responders. Firecrawl retrieves recent web news/articles; open satellite imagery, authorized ground/relevant public social video, weather API data and terrain provide additional typed inputs. Analysts surface unverified humans/animals/vulnerable objects/possible fuel hazards. A projection agent models possible paths; the orchestrator fuses relative area danger (including terrain, houses and animals) and proposes drone/ground-team placement for human review. Execution is simulated, not field orders.

Greece 3D mountains/forest/smoke/weather/comms simulation remains a candidate. Exact region, bounded prototype scope, full PX4 versus browser fidelity, runtime/database/dependencies, Google/Iris routes and cloud logical contexts versus actual edge inference are not selected. fal credit readiness is owner-reported, not API-call verified. No application code, copied components, provider inference or deployment is claimed by this planning PR.

Architecture draft exists outside this repository, updated to this brief but unapproved. All open-card acceptance numbers are proposed targets, not measured results. Test plan must precede implementation plan; explicit non-goals and permissions/reuse gates remain mandatory.

Prior [wildfire-sweep](https://github.com/nikolas-sapa/wildfire-sweep/tree/66bb3c9), baseline `66bb3c9` (2026-11-10), is pre-event research. Frozen outputs remain untouched. Reuse needs source files/commits, licenses, notices, attribution and an honest prior/adapted/new-work split.

## Current ownership claims

| Lane | Accountable owner | Branch / exact file boundary |
|---|---|---|
| Shared planning receipts | Planning docs worker | `chore/hackathon-planning`: `TASKBOARD.md` and ignored `.scratch/planning-pr-body.md` only; other planning files already published |
| Repository delivery | Git specialist | Git/GitHub operations only on the planning branch; explicit approved paths, coordinator review before integration |
| Scoped backend setup | Backend setup agent, coordinator supervised | Local Boxd/Treg auth/config only, outside this repository; exact private paths belong in the setup handoff, no repository file claim |
| Teammate application work | Unassigned, GitHub handle unknown | No app files or branch claimed; invitation and file ownership still pending |
| FCC console proposal (PROP-01) | marcseli (Droid agent) | `proposal/fcc-console`: `proposal/**` only, plus this claim row and card PROP-01. Submitted for owner review; not merged into `main` |

No application role below is assigned. App file boundaries will be set in the approved spec. Any later worker must claim a task, exact files and branch before coding.

## Done research and administration

- [x] D01 · P0 · Status: done · Kickoff rules and project intake
  - Owner: coordinator. Receipt: 1 rules/intake review completed; 0 implementation approvals inferred.
- [x] D02 · P0 · Status: done · Prior-repo provenance
  - Owner: coordinator. Receipt: 1 prior repository and 1 baseline commit identified; 0 components copied.
- [x] D03 · P0 · Status: done · Architecture options
  - Owner: coordinator. Receipt: 1 browser/heavier-simulation and agent-boundary options pass completed; 0 options approved.
- [x] D04 · P0 · Status: done · Proposed 90-second demo outline
  - Owner: coordinator. Receipt: 1 new-work/fallback story prepared; 0 claims that 90 seconds is the organizer's limit.
- [x] D05 · P0 · Status: done · Google, Iris and fal role research
  - Owner: coordinator. Receipt: 3 provider roles reviewed; 0 live inference runs or final provider selections claimed.
- [x] D06 · P0 · Status: done · Weather retrieval boundaries
  - Owner: coordinator. Receipt: 1 retrieval/projection distinction recorded, including timestamp/unit/source requirements; 0 validated forecast claims.
- [x] D07 · P0 · Status: done · OSS rendering and SDK options
  - Owner: coordinator. Receipt: 1 license-aware rendering/SDK review completed; 0 dependencies chosen or components imported.
- [x] D08 · P0 · Status: done · Command-center visual references
  - Owner: coordinator. Receipt: 2 reference families reviewed (Anduril/Palantir); current Anduril mission cycle checked. One-screen UI draft refined with objective/rehearsal strip and debrief, still outside this repository and unapproved. 0 copied branding or approved prototype/UI choices.
- [x] D09 · P0 · Status: done · Fact-check and provenance workflow
  - Owner: coordinator. Receipt: 1 attribution/new-work workflow defined; 0 fabricated milestones.
- [x] D10 · P0 · Status: done · Original taskboard document
  - Owner: original board writer. Receipt: 1 historical board with 37 unique tasks prepared and structurally checked; that receipt is not application implementation.
- [x] A02 · P0 · Status: done · Local Google instructions and Oumi registration draft
  - Owner: setup research role. Receipt: all 8 pages of local organizer instructions read; 1 registration abstract written and verified at 1,137 characters. No Google/Oumi account registration or API calls; access confirmation remains pending. No credentials/private account details copied into shared docs.
- [x] O02 · P0 · Status: done · New-repo identity and creation
  - Owner: Nikolas, Git specialist. Receipt: `nikolas-sapa/fire-command-center`, private visibility and new project location chosen; private repo created and fresh planning branch checked. No old-repo mutations or application code implied.

## Active proposal

- [ ] PROP-01 · P0 · Status: active · FCC console proposal for owner review
  - Owner: marcseli with Factory Droid agent. Branch: `proposal/fcc-console`. Files: `proposal/**` (app in `proposal/fcc/`, `proposal/HANDOFF.md`, `proposal/AGENT_PROTOCOL.md`). Receipt: `npm run build` in `proposal/fcc` passes with 0 TypeScript errors; 6 demo beats screenshot-reviewed at 1920 × 1080 on a MacBook (darwin 25.2), Chromium headless, seed 20210816, run 2026-11-14. The team's numeric acceptance tests have not been run. Execution is simulated; 0 provider inference calls. Pushed with marcseli's explicit instruction ahead of the planning gate; adoption, merge and architecture approval remain with Nikolas (O01). Agent messages follow `proposal/AGENT_PROTOCOL.md`.

## Drafting and setup

- [ ] A01 · P0 · Status: draft-ready · Latest architecture draft, approval pending
  - Owner: architecture draft writer, coordinator review. Scope: architecture note outside this repository only. Receipt: latest incident-intelligence draft written with 16 named proposed numeric tests and non-goals. Completion gate: 1 owner-approved product/fidelity/runtime decision set and test plan; draft is not an approved implementation spec.
- [x] SETUP-01 · P0 · Status: done · Publish shared planning board and governance
  - Owner: planning docs worker; delivery by Git specialist. Receipt: 4 reviewed planning files published at `59ee562` in private [draft PR #1](https://github.com/nikolas-sapa/fire-command-center/pull/1); all 4 remote file blobs verified exactly, main unchanged. 37 original IDs plus 3 setup cards preserved; local links checked; 0 app source or credential artifacts included. Later receipt updates still require Git-specialist delivery.
- [x] SETUP-03 · P0 · Status: done · Scoped local backend access setup
  - Owner: backend setup agent, coordinator supervised. Receipt: Boxd v0.3.5 live authentication verified behind a read-only guard; Treg v0.30.0 scoped authentication and CLI identity verified for the intended team. Private local configuration stays outside this repository, directories `0700` and files `0600`. Unsafe onboarding rerun skipped. 0 global MCP/skill/model-routing changes, paid model calls or VM creation. Authentication checks do not verify application/provider inference; no private paths, balances, team IDs or credentials published.

## Owner actions

- [ ] O01 · P0 · Status: owner-action · Approve design and numeric test plan
  - Owner: Nikolas. Acceptance: 1 explicit approval covering latest product boundary, simulator fidelity, region/fixture, cloud-logical versus edge cognition, provider roles, test criteria and non-goals; 0 silent architecture choices.
- [ ] O03 · P0 · Status: owner-action · Choose Greece demo region
  - Owner: Nikolas. Acceptance: 1 named region and 1 approved map extent; no country-wide fidelity implied.
- [ ] O04 · P0 · Status: owner-action · Confirm every teammate's Oumi registration
  - Owner: each teammate, Nikolas coordinates. Use [official Oumi registration](https://labs.oumi.ai/hackathon-village/genai-summit-athens-2026). Acceptance: registered count equals confirmed team size; access status recorded for 100% of teammates, with no credentials copied here.
- [ ] O05 · P0 · Status: owner-action · Confirm provisioned Google access
  - Owner: Nikolas/team. Follow organizer instructions through private access channels. Acceptance: 1 provisioned project and 1 approved API/access route confirmed; status only, no login addresses, keys or auth bundles on this board. Credential presence alone does not pass.
- [ ] O06 · P0 · Status: owner-action · Select UI reference and authorized assets
  - Owner: Nikolas. Acceptance: 1 reference direction plus asset/source/license choices, following Geist Sans and blue `#006bff`, no orange/emoji. Reference selection does not assign frontend ownership or approve app implementation. No further deck research required.
- [ ] O07 · P0 · Status: owner-action · Confirm submission mechanics
  - Owner: Nikolas/organizer. Acceptance: 1 actual submission URL, 1 confirmed deadline/video limit and 1 required-artifact checklist before the working deadline.
- [ ] O08 · P0 · Status: owner-action · Approve disclosed reuse and source permissions
  - Owner: Nikolas, organizer clarification if needed. Acceptance: 1 approved manifest covers 100% of proposed reused files/assets and source permissions; licenses/notices/attribution retained; 0 hidden or backdated prior work.
- [ ] O09 · P0 · Status: owner-action · Confirm applicable entry and reuse terms
  - Owner: Nikolas/organizer. Acceptance: 1 current confirmation or “not applicable” decision for any remaining entry/reuse condition. Keep personal eligibility and account details in private channels, not this shared board.
- [ ] SETUP-02 · P0 · Status: owner-action · Identify and invite teammate
  - Owner: Nikolas; Git specialist performs only explicitly authorized invitation. Acceptance: 1 confirmed GitHub handle, 1 authorized invite and accepted collaboration access; 1 agreed task/branch/exact-file claim before teammate edits. Unknown handle remains unassigned.

## Approval-gated P0

All 13 cards remain gated, roles unassigned. Dependencies below describe approval/work boundaries, not permission to start. Proposed fixture numbers are not selected architecture or performance evidence.

- [ ] P0-01 · P0 · Status: gated · Freeze approved spec, tests and reuse manifest
  - Owner: spec/review role, unassigned. Requires: latest draft, owner approval and reuse/source choices. Acceptance: at least 16 named numeric tests; 1 approved spec with non-goals; 1 manifest covering 100% of reused files/assets; 0 mid-plan architectural substitutions.
- [ ] P0-02 · P0 · Status: gated · Typed contracts and verification pipeline in new repo
  - Owner: contracts/pipeline role, unassigned. Repo already exists; contracts and CI do not. Requires: approved spec and single-owner file claims. Acceptance: typed evidence/proposal/world/action/event contracts and 1 passing approved pipeline; 100% copied files attributed; 0 prior-repo mutations. Runtime/schema/dependencies remain unchosen.
- [ ] P0-03 · P0 · Status: gated · Seeded world and incident fixtures
  - Owner: simulation role, unassigned. Requires: approved contracts, region and simulator choice. Proposed acceptance: 2 bases, 4 drones, 2 fires, 16 observation regions and 2 synthetic ground-team markers; 3/3 identical-input runs yield identical event/state hashes; models never write simulation truth.
- [ ] P0-04 · P0 · Status: gated · Toy environment, fire and smoke
  - Owner: environment role, unassigned. Requires: approved world/parameters. Proposed acceptance: 10 seeds × 600 ticks, 0 NaN/Infinity or out-of-range state values; 100% parameter boundaries covered; every path/fire/smoke layer labelled simulated, not calibrated forecasting.
- [ ] P0-05 · P0 · Status: gated · Drone battery, routes and missions
  - Owner: drone executor role, unassigned. Requires: approved world/flight bounds. Proposed acceptance: 40/40 infeasible route/energy cases rejected; all 4 baseline drones respect selected battery/separation bounds; 0 overlapping assignments or false return/completion claims.
- [ ] P0-06 · P0 · Status: gated · Transport, line of sight, ACK and retry
  - Owner: transport role, unassigned. Requires: approved executor/message contracts. Proposed acceptance: 100 unique commands with 30% loss, 20% duplicate injection and 0–8-second latency; 0 false acceptance ACKs, duplicate executions or stale telemetry overwrites; retries bounded by approved limits. ACK is never completion.
- [ ] P0-07 · P0 · Status: gated · Typed analysis, fusion and reviewed proposals
  - Owner: agent integration role, unassigned. Requires: approved evidence/proposal contracts, source permissions and provider access/budget. Proposed acceptance: 24 invalid/stale outputs rejected with 0 dispatches; unverified detections retain source/geo/time/uncertainty; at least 2 genuine authorized provider decisions, including 1 typed-analysis and 1 finite-action receipt if Google/Iris roles are selected. No invented provider route or unrestricted source-driven tools.
- [ ] P0-08 · P0 · Status: gated · Evidence, weather, projection and relative danger layers
  - Owner: evidence/weather/projection role, unassigned. Requires: selected region, source permissions and spec. Proposed acceptance: 20 weather fixtures with 0 invalid inputs accepted and 100% accepted units/time/source retention; 24 missing-geo/contradiction/stale/injection fixtures with 0 exact placements from missing geography, erased contradictions or executed source instructions. Relative danger/path outputs remain unvalidated prototypes.
- [ ] P0-09 · P0 · Status: gated · 3D command-center UI
  - Owner: frontend role, unassigned. Requires: approved design/assets, contracts and module claim. Proposed acceptance: all 4 drones/2 bases visible; sourced-evidence, relative danger/path, unverified exposure, review and event layers; 2 checked viewport screenshots. Target average ≥30 FPS and p95 frame time ≤33 ms at 1920×1080 on a named machine, measured later, not achieved now.
- [ ] P0-10 · P0 · Status: gated · Fault reconciliation and replanning
  - Owner: resilience role, unassigned. Requires: reviewed transport/agent/UI contracts. Proposed acceptance: 12 documented fault classes pass; 0 false completions or stale approvals reused; 10/10 simulated ground placements require matching current human approval; 0 actual ground-team orders. Numeric convergence limits must be approved in spec.
- [ ] P0-11 · P0 · Status: gated · Integration, security and visual/performance verification
  - Owner: verification/review roles, unassigned. Requires: integrated candidate and approved tests. Acceptance: 100% applicable named tests pass; 0 blocking review findings; at least 1 non-mocked external/dist check per integration package; genuine provider receipts distinguished from replay; 2 checked screenshots; proposed 10-minute 1080p average ≥30 FPS/p95 ≤33 ms measured on named machine. Untested is not done.
- [ ] P0-12 · P0 · Status: gated · Genuine working PR milestones and new-work receipts
  - Owner: delivery/review roles, unassigned. Requires: approved spec, ownership and working changes; final closure requires verification. Proposed acceptance: at least 3 independently working milestone PRs with test receipts, count subject to approval; 100% reuse attributed; 0 fake/backdated progress history. This planning PR is not a working application milestone.
- [ ] P0-13 · P0 · Status: gated · Demo, backup video and submission
  - Owner: demo/submission role, unassigned; Nikolas submits. Requires: verified candidate, new-work receipts and confirmed submission/entry rules. Acceptance: 1 fresh-session demo, 1 fallback recording within actual organizer limit and 1 submission receipt before confirmed deadline; visibly distinguish prototype/synthetic/recorded/live and prior/new work.

## Deferred scope

- [ ] P1-01 · P1 · Status: deferred · Push-to-talk voice commands
  - Owner: voice/UI role, unassigned. Requires: core P0 verification and owner opt-in. Proposed acceptance: 10 ambiguous commands yield 0 unconfirmed simulated dispatches; 1 explicit push-to-talk control; 0 always-listening or validator-bypass paths.
- [ ] P1-02 · P1 · Status: deferred · Optional fal exercise media
  - Owner: media role, unassigned. Credits owner-reported ready; task/model/API contract and real access unverified. Requires: meaningful approved media task, permissions and owner opt-in. Proposed acceptance: at least 1 labelled synthetic asset, 100% provenance/license records, 0 generated imagery promoted to real incident evidence.
- [ ] P2-01 · P2 · Status: deferred · Resident read-only view
  - Owner: frontend/access role, unassigned. Requires: core P0 verification and owner opt-in. Proposed acceptance: 1 read-only view, 10 attempted mutations rejected, 0 fleet commands or automatic public alarms; any reports remain moderated/unconfirmed evidence.

## Status and claim rules

- Checked cards require actual research/admin/runtime receipts appropriate to their scope. `draft-ready` means written but unapproved, not done application work.
- Move gated work only after dependencies and owner approvals; move to active only with concrete owner, branch and exact files. No implicit assignment to a friend or another agent.
- Shared contract/schema/lock/CI files have one designated owner. Preserve teammate edits and integrate through reviewed PRs.
- Record provider access as reported, installed, present, verified or untested precisely. Store no credentials, personal contact details or raw auth/browser logs here.
- Update summary counts with every status change. This repository supersedes the local snapshot for future work, not pre-event history.
