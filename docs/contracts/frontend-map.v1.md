# frontend-map.v1, local EXERCISE consumer contract

Issue #17, 2026-11-15. Mapping only, no frontend implementation/launch/acceptance. Teammate owns every `proposal/fcc/**` change. Source of truth: actual `BridgeView` in `backend/integration/received-view.ts`, `backend-protocol.v1` in `backend/protocol/types.ts`, [bridge HTTP contract](backend-bridge.v1.md). Reject unsupported versions rather than guessing an adapter. No simulator Runtime starts inside a crew reader.

## Identity, versions and revisions

| Wire field | Consumer rule |
|---|---|
| `contract_version` | Exactly `backend-protocol.v1`. |
| `bridge_version` | Exactly `backend-bridge.v1`. This document is `frontend-map.v1`, not a new wire field. |
| `mode` | Exactly `EXERCISE`. Internal control mode `live` does not mean real footage/inference. |
| `incident_id`, `run_id`, `authority_epoch` | Opaque identity. New run/epoch invalidates pending intents and old cached role setup. Never join unrelated runs. |
| `incident_revision` | Monotonic shared received revision. `after_revision=N&wait_ms=10000` returns changed DTO or no-change HTTP 204. Reject future-cursor 409; do not reset backend from a browser. |
| `input_revision`, `plan_revision`, `reservation_revision`, `chief_epoch` | Separate approval/feasibility freshness clocks, not display counters. Copy current values only after explicit human review. |
| `authority_active` | False means freeze, last-known display only, zero auto-dispatch/revival. Reads still available while frozen. |
| `as_of_received_at` | Requested receipt cutoff, not source acquisition time, provider execution time or server-health heartbeat. |

Opaque IDs preserve exact strings: asset/feed/frame/evidence/source snapshot/source revision/mission/version/route/candidate/proposal/approval/command. No trimming, numeric conversion or inferred equivalence. Launcher's default bridge-only seed declares `d1..d3`, thermal feeds `t1..t3`, current fixture candidates `c1..c3`, missions `m1..m3`, no rendered media/trajectory. Those are disposable synthetic declarations, not generated planner courses or execution proof. Optional `--demo` uses only `d1/t1` and replaces generic candidates with one registered planner-generated single-drone course; see [producer handoff distinction](producer-handoff.v1.md#three-asset-declaration-not-three-drone-execution). Neither seed establishes Marco's asset/feed/route mapping or three-drone execution.

## Coordinates, clocks and media

| Source field | Exact mapping / unknown handling |
|---|---|
| `coordinate_frame` | Currently always null. Global origin, orientation, CRS/georegistration and altitude datum unknown. No map transform approved. |
| `telemetry[asset_id].payload.position` | Null stays null. Non-null `{x_m,y_m,z_m}` has lexical metre field names but no approved origin/orientation/altitude datum. Retain raw values, never map to longitude/latitude or AGL/MSL. |
| `frames[feed_id].payload.source_position` | Null stays null. Otherwise retain its exact `coordinate_frame`, `units`, `altitude_datum`, `x/y/z`; no conversion without reviewed source registration. This is camera/source position, not target location. |
| `hypotheses[hypothesis_id].payload.geography` | Null stays null. Non-null position does not establish WGS84/target confidence. Never fabricate `(0,0)` or place target at drone/source position. |
| `location_uncertainty_m` | Null means unknown, not zero. No guessed accuracy circle. |
| Each row's `incident_revision`, `received_at` | Receipt metadata, preserve separately from original source clock. Rows are exactly `{incident_revision,received_at,payload}`. No canonical actor/session/trace metadata in crew DTO. |
| Telemetry/frame `captured_at`, `capture_time_status` | Known clock must stay original UTC; unknown means null plus `unknown`. Receipt time is not a substitute capture time. |
| Telemetry `sim_tick`, frame `sim_tick` | Source exercise clock; frame null stays null. Not UTC or authoritative arrival/completion time. Launcher trusted tick advances monotonically from elapsed server seconds, not simulator physics. |
| `frames[feed_id]` | Latest actually received frame per feed at cutoff, not future producer frame or full media archive. Keep `frame_id`, `feed_id`, `asset_id`, `evidence_id`, `source_snapshot_id`, `source_revision`, owner/epoch. |
| `media_ref`, `content_hash`, MIME, bytes, dimensions, `media_limits_version` | Opaque metadata, no automatic URL fetch/blob decode. `media_verified=false`; metadata hash/bytes do not prove actual pixels, ownership or content verification. Media endpoint absent. |

Null is explicit unknown. Missing required wire fields/malformed enum means invalid snapshot, not a default. No invented Geo, temperature, range, confidence, calibration or source time.

## Feeds, evidence and review

Feed `modality`: `thermal | eo`, joined by exact frame `feed_id`. Feed `source_kind`: `simulated | uploaded | live`; `synthetic`: explicit boolean; `radiometric`: `true | false | unknown`; `calibration`: exact object or null. Calibration `verification_status`: `verified | unverified | unknown`. Feed status: `available | paused | stale | unavailable`. Preserve source ID/revision and capture owner/epoch. A declared available thermal feed is not a rendered camera, temperature measurement or verified thermal model capability. Do not infer modality from filename/MIME/palette. Launcher seeds thermal/simulated/synthetic=true/radiometric=false/calibration=null only.

Hypotheses: kinds `human | animal | fire | gas_canister | other`, verification status always `unverified`. Preserve evidence IDs, source snapshot ID, input revision, contradictions and critical flag. `model_score=null` is unknown; otherwise `{value,scale}` is not necessarily a probability or operational confidence. Aging/fading never silently resolves critical evidence. Replay cutoff only exposes what arrived then, not future truth or a fresh call.

Proposals and candidates in `BridgeView` are filtered current review options. Candidates remain **proposed**, including `feasible=true` fixture declarations. They are not approved/registered physical trajectories, durable commands or safety guarantees. Candidate row has IDs, plan revision, feasibility snapshot and tick expiry, no waypoint coordinates. Pure planner-generated SHA IDs are proposed/unregistered until separately reviewed orchestration registers valid current candidates; never substitute them into bridge approvals blindly. A proposal disappearing through expiry/freeze does not mean completed. Store local selection/pins/camera/replay cursor locally, never mutate peers or autoapprove.

## Approval and factual receipt stages

Chief POST body is exact `ApprovalRequest`: `contract_version`, `incident_id`, `run_id`, `authority_epoch`, `approval_id`, `proposal_id`, `proposal_revision`, `candidate_id`, `expected_incident_revision`, `input_revision`, `plan_revision`, `reservation_revision`, `chief_epoch`, `expires_at_sim_tick`. No body Chief identity/role/session grants authority. POST uses private current-Chief bearer capability selected by explicit local role setup, not a login account or model decision. Stale requests fail, never queued for later retry as new approval.

| State / source | Meaning |
|---|---|
| Proposed candidate/proposal | Finite review option only, no command. |
| Successful approval | Creates one reservation and `enqueued` command. No transport/ACK/executor completion. |
| `sent` | Actual simulated transport receipt arrived. |
| `delivered` | Actual receipt says delivery, not executor acceptance. |
| Successful producer `command-checks` | Current acceptance validation only, no receipt/revision/movement generated. Recheck before execution; observations can invalidate approved intent. |
| `accepted`, `running`, `completed` | Separate actual producer receipts, never inferred from elapsed time/check/snapshot. |
| `failed`, `cancelled`, `rejected` | Separate factual terminal receipts with reason/evidence where supplied. |

Crew command DTO exposes only command ID/version, asset ID, mission ID/version, approval ID, proposal ID and status (`enqueued` plus receipt enums). It does not expose receipt capture clocks/reasons/history or transmission ID; do not invent those details in a crew receipt timeline. Producer-only `GET commands` returns full eligible commands; never bundle producer capability/full command responses into a read-only crew provider.

## Local HTTP and handoff

Backend binds `127.0.0.1`, default port8787, exact Origin `http://localhost:5173`. Every request needs that configured Origin and `Authorization: Bearer <process-local-role-capability>` header. No URL credentials, wildcard CORS, app login/signup, production auth claim or public server. Private CLI handoff file stores endpoint/identity/Origin/expiry and reader/Chief/analyst/producer capability setup, permissions0600 in a unique ignored0700 directory. Treat capabilities as private local write authority, do not publish/log/commit/place in durable browser storage. Owner separately chooses any frontend handoff/launch after backend completion confirmation.

Resources: `GET snapshot`, `POST events`, `POST approvals`, producer-only `GET commands`, `POST command-checks`, empty-body `POST producer-heartbeats`, each under `/incidents/:incident_id/`. Success `{data}`, error `{error:{code,reason}}`. Missing/expired role401, wrong role/Host/Origin403, stale/frozen/conflict409. OPTIONS preflight grants zero role authority. Snapshot polling <=10s/16 pending polls; producer loss >5s freezes, no automatic takeover or simulator restart. Full details in linked bridge contract.

Non-goals: frontend source changes/launch, public hosting, Convex/session persistence, actual georegistration, media transport, provider calls, physical flight, automatic approvals, fabricated observations/receipts. This map proves no Runtime/crew adapter or browser acceptance.
