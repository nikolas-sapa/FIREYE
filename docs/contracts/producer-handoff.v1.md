# producer-handoff.v1, backend-only handoff checklist

2026-11-15. Document/checklist only, not a wire schema change or accepted Marco mapping. Backend source pinned to `67495775edcdd3b122dac96d1b599f24710988c1`: [seed](../../backend/config/local-demo.ts), [authority](../../backend/integration/session.ts), [HTTP bridge](../../backend/integration/local-http.ts), [received DTO](../../backend/integration/received-view.ts), [core types](../../backend/protocol/types.ts). Teammate reference: draft [PR #2 source `c2682d4e`](https://github.com/nikolas-sapa/fire-command-center/tree/c2682d4e855b8daf76e297315a63b86e58ce43ff/proposal/fcc), existing [frontend mapping analysis](frontend-map.v1.md). No frontend source changed/launched. No owner answers inferred from source names.

## Three-asset declaration, not three-drone execution

| Backend asset | Thermal feed | Source ID | Candidate / action / mission / version / route | Marco unit / feed / route mapping |
|---|---|---|---|---|
| `d1` | `t1` | `exercise-source:d1` | `c1` / `inspect` / `m1` / `1` / `declared-route1` | Unknown, owner answer required |
| `d2` | `t2` | `exercise-source:d2` | `c2` / `inspect` / `m2` / `1` / `declared-route2` | Unknown, owner answer required |
| `d3` | `t3` | `exercise-source:d3` | `c3` / `inspect` / `m3` / `1` / `declared-route3` | Unknown, owner answer required |

All three are generic bridge seed declarations: thermal, simulated, synthetic=true, radiometric=false, calibration=null, source_revision=0; owner is fresh run's designated producer, capture_epoch=1. IDs do not prove cameras/trajectories exist. `createDemoScenario` used by `--demo` deliberately slices to `d1/t1` and replaces candidates with one planner-generated reviewed single-assignment course. Do not substitute generic `c1..c3` into that service or claim it executes three drones. PL01 uses generic three-asset seed, unknown telemetry and a test heartbeat driver, not Marco's executor.

## Required fields and unknowns

| Boundary | Required preservation |
|---|---|
| Event envelope | `contract_version`, `incident_id`, `run_id`, `authority_epoch`, unique `event_id`, `stream_id`, contiguous `stream_sequence`, `trace_id`, nullable `causation_id`, exact `kind/payload`. Not frontend BusEvent `{type,at}`. |
| Feed registration | Exact asset/feed/modality/source ID/revision, capture owner/epoch, source_kind/synthetic/radiometric/calibration/status. Palette `fx` is not modality. Every drone needs separate thermal feed; EO separate optional channel. |
| Telemetry | asset, mission/null and mission_version, producer/epoch, sim_tick, original captured_at/status, position/null, battery_percent/null. Known battery percent may divide by100 for fractional UI field, null never becomes0. |
| Frame | frame/feed/asset/evidence/source_snapshot IDs, source_revision, capture owner/epoch, captured_at/status, sim_tick/null, source_position/null, location_uncertainty_m/null, MIME/bytes/media_ref/hash/dimensions/media_limits_version. Metadata alone does not verify pixels or permission. |
| Crew received row | Exactly `incident_revision`, `received_at`, `payload`. Preserve receipt clock independently from capture clock. Current projection has `coordinate_frame=null`, `media_verified=false`. |
| Hypothesis | Evidence/source-snapshot links, input revision, unverified status, contradictions/critical flag, geography/null, uncertainty/null, model_score/null or exact value+scale. No invented confidence, live boolean or required finding position. |
| Command/receipt | Producer-only full command binds command/version, transmission, asset, mission/version, candidate/action/route, Chief approval, epochs/revisions/deadlines. Receipt separately preserves receipt ID, those command/mission/transmission IDs, actual stage/sim_tick, producer/epoch, capture clock/status, reason/null, evidence IDs. Crew DTO omits receipt detail, never fabricate timeline. |

Unknown source clock: `captured_at=null`, `capture_time_status='unknown'`; no substitute receipt time. Unknown telemetry position, frame source_position, hypothesis geography, uncertainty, calibration or score stay null. Source sim-tick → UTC relation currently unknown. Backend metre-named coordinates do not supply a map origin, axis, CRS or altitude datum. Frontend Geo/AGL requirements cannot manufacture WGS84, `(0,0)`, AGL, temperature or calibrated probability. Invalid missing required fields reject, they are not null defaults.

## Currentness and lifecycle

Only designated producer gets producer capability. Crew readers never start simulator Runtime or receive producer/Chief write capabilities. Credentials stay private local handoff, never document/log/commit them.

HTTP paths under `/incidents/:incident_id/`: producer `POST events`, `GET commands`, `POST command-checks` with exact `{command_id,expected_incident_revision}`, empty-body `POST producer-heartbeats`; crew `GET snapshot`; current Chief `POST approvals`. Preserve backend-protocol.v1 / backend-bridge.v1 / EXERCISE identity and revision fields, exact configured Origin and loopback Host. See [bridge contract](backend-bridge.v1.md).

Heartbeat is private liveness, zero shared revisions, no observation/ACK/movement/completion proof. Silence >5,000ms freezes through existing250ms timer. Late heartbeats cannot revive; explicit reconciled new-run/takeover policy required, no automatic reader election. Observations do not renew heartbeat. `command-checks` success is only instantaneous validation, not a durable execution grant; an observation changing input_revision invalidates prior approval before acceptance. PL02 proves rejection10/10, not recurrent mission execution.

Existing caps unchanged: 60 producer mutation attempts/session/min includes heartbeats/events/checks; 999 ordinary commits plus fail-closed revision1,000. Three drones x1Hz x600s =1,800 observation revisions before commands/receipts. Proposal for owner review: heartbeat every2s, per-asset telemetry every10s gives48 requests/min and180 observations/600s, leaving12 attempts/min for checks/receipts and819 ordinary revisions for other events. This is arithmetic only, not approved scheduling, batching implementation, loss tolerance under overload, or a measured ten-minute run. Approval→observation currentness remains unchanged; any batching/new schema is a separate reviewed contract decision.

## Exact questions for Marco

1. At pinned PR #2 source, what exact three `Unit.id` values map to `d1,d2,d3`, and what exact three thermal feed IDs map to `t1,t2,t3`? Which optional EO channels are separate? Supply mapping3/3 or mark each unsupported, never infer from display names/palette.
2. Who owns the single producer Runtime, how does it acquire designated producer/run/capture_epoch context, and can two crew readers consume snapshots while starting zero Runtime instances and holding zero producer capabilities?
3. What reviewed CRS/origin, axis orientation, units and altitude datum convert backend positions to console Geo/AGL? Where is source georegistration/uncertainty recorded? Until supplied, can reader show unknown location without creating a pin?
4. What exact source sim-tick/scenario UTC relation is approved? Which capture clock is known versus unknown? How will original captured_at remain distinct from server received_at and receipt-stage clocks?
5. What exact frontend frame/evidence/source-snapshot IDs map to backend IDs/source_revision, and which permitted pixels/rights/calibration manifest (if any) supports each feed? False-color simulation stays non-radiometric, no Celsius claim.
6. Which reviewed candidate/action/mission/version/route IDs does producer resolve for each asset? Can it report unsupported generic declarations and distinguish single-course `--demo` from three-asset bridge seed? Route geometry is absent from crew DTO, no generated map origin/trajectory substitution.
7. Can producer recheck current incident/input/plan/reservation/Chief/authority/capture versions immediately before simulated acceptance, reject observation-interleaved intent, and emit factual sent/delivered/accepted/running/terminal receipts only when each happened?
8. What bounded heartbeat/telemetry/receipt cadence fits both60/min and999-ordinary-revision caps, including retry/check budget? Is proposed2s/10s cadence acceptable, or is reviewed batching needed? No existing ceiling changes authorized.
9. After >5s loss/freeze, who explicitly reconciles next run/epoch and discards stale pending intent? Ten late heartbeats must revive zero times. Agree recovery protocol before any real-client600s acceptance run.

Acceptance still pending owner answers: mapping3/3, clock/geography unknowns preserved, zero crew Runtime/write leakage, agreed bounded cadence and factual receipts. [PL01](../verification/producer-lifecycle.md) is backend fixture proof only. No PR comment/message, provider call, VM, frontend launch, deployment or operational order performed.
