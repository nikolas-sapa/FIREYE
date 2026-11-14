# Thermal camera contract

Status: **v0, UNAPPROVED DRAFT**, 2026-11-14. Planning only, no executable schema, provider calls or passed product tests.

Interpretation: every simulated drone supplies a distinct thermal channel; optional EO remains a separate channel. Teammate owns simulated pixels/render/UI, root owns metadata, evidence and analytical boundaries.

Basis: [taskboard P0-07/P0-09](../../TASKBOARD.md), [repository rules](../../AGENTS.md), [simulator parameter draft](../specs/simulator-parameter-contract.md) and [crew contract](crew-agent-boundaries.md). Proposed numbers remain unmeasured; region/Caldor versus Greece and runtime remain owner decisions.

## Numeric test plan first

Six checks here plus six in the crew contract = 12 proposed checks, **0 executed**. Pin source, run/seed, contract/parameter versions and receipts for later acceptance.

| Test | Proposed numeric pass criteria |
|---|---|
| T01, fleet channels / honest temperature | Baseline 4/4 drones have thermal capability and unique thermal feed metadata; add EO to 2 drones: 2/2 retain both distinct channels. Across 100 non-radiometric frames: 0 Celsius values or measured-heat claims. |
| T02, malformed frame | 100 invalid fixtures, 25 each for invalid UTC, NaN/Infinity, unknown modality and missing required identity: reject 100/100 with reasons. Accept 10/10 valid fixtures, including explicit unknown capture time and geography. |
| T03, duplicate / stale source | Submit each of 20 frames twice under the same analysis contract: exactly 20 jobs, 0 duplicate analyses. Disconnect 20 feeds: 0 fake-fresh frames; age >3 sim s becomes stale within 1 UI update, 0 stale feeds ranked current. |
| T04, masked pixels / uncertainty | 10 masked or occluded exercise frames: 10/10 replies remain unverified hypotheses or explicit unknown, 0 confirmed identity or temperature claims. Record actual matches/misses, not a 100% detection target. |
| T05, hidden-truth isolation | Inspect 20 serialized model inputs and referenced media metadata: 0 planted labels, answer boxes/masks, true target coordinates or future-world fields; 20/20 retain source snapshot/evidence IDs. Test-only evaluator may hold truth separately. |
| T06, bounded analysis | 600 sim ticks with providers disabled: 0 model calls/CPU jobs/VMs, simulation still advances 600 ticks. Approved 10-minute fixture run: ≤2 in-flight analyses, ≤8 queued jobs, ≤30 calls; optional approved Boxd ≤2 CPU jobs concurrent, ≤30 wall s/job. |

## Records and field ownership

All records carry `contract_version: thermal-camera.v0`, `incident_id`, `run_id`, `authority_epoch`, stable record ID and revision. Required identities are nonempty strings; all numeric values must be finite. Unknown is explicit null/status, never zero or guessed confidence.

| Record | Sole field writer / responsibility |
|---|---|
| Asset capability + feed registration | Teammate sensor/simulator producer declares physical/fixture channel, source and camera metadata; root validates/registers immutable identities and revision. |
| Frame acquisition | Teammate capture producer writes pixels, `frame_id`, backing tick, capture pose/time and display transform. Uploaded/live adapter later preserves actual source facts. |
| Receipt + evidence | Root ingestion writes actual receipt time/sequence, media validation, access policy and evidence IDs; cannot relabel synthetic pixels real. |
| Analysis + hypotheses | Root validated analyst writes input snapshot/model/task, analysis time, unverified claims and rejection reasons; cannot modify frame or sensor facts. |
| Feed ranking | Root/Iris proposes ordering of finite validated feeds; teammate presents ranking, preserves each person's pinned choice. |

### Asset and feed

- Asset: `asset_id`, `capabilities` containing canonical `thermal` (display label THRM), `thermal_feed_id`. Optional `eo_feed_id` has different identity. Capability means camera equipped, not camera currently available.
- Feed: `feed_id`, `asset_id`, `modality: thermal | eo`, `source_kind: simulated | uploaded | live`, `synthetic: boolean`, `radiometric: true | false | unknown`, `calibration: object | null`, `source_id`, `source_revision`, `capture_owner_id`, `capture_epoch`, `status: available | paused | stale | unavailable`.
- `feed_id` identifies one modality throughout a run. Switching display/palette does not switch modality. Replacing source/sensor requires a revised registration, never silent identity reuse.
- `calibration`, when supplied, preserves `calibration_id`, source/sensor identity, source-provided method/units/time, `verified_source` reference and `verification_status: verified | unverified | unknown`. Missing metadata remains null, not a fabricated calibration record.
- Simulated false-color defaults: `source_kind=simulated`, `synthetic=true`, `radiometric=false`, `calibration=null`. A preview running in real time is not `source_kind=live` evidence.

### Frame, clocks and media

- Frame: `frame_id`, `feed_id`, `asset_id`, `evidence_id`, `source_snapshot_id`, `stream_sequence`, `sim_tick` (nonnegative integer for simulation, null otherwise), source/calibration registration revision and capture owner/epoch.
- `captured_at` is source UTC ISO 8601 ending `Z`, or null with `capture_time_status=unknown`; `received_at` is required actual ingestion UTC. Analysis records carry required `analysis_at` UTC on completion. Validate calendar/time syntax, not just string shape. Never substitute receipt/analysis time for unknown capture time.
- Simulated acquisition UTC derives from declared scenario epoch/tick; receipt/analysis use actual wall UTC. Different clocks need not sort chronologically. Freshness uses approved sim age or declared source clock domain/uncertainty, not arrival alone. Replay preserves original clocks, does not renew freshness.
- Media: `mime_type`, `byte_length`, `media_ref`, `content_hash`, `width_px`, `height_px`, `media_limits_version`. Decode dimensions/MIME, enforce approved positive byte/dimension/clip-duration caps before queueing. Missing limits reject analysis; parameter-draft preview defaults are ≤320×180/1 fps, active ≤640×360/10 fps, not inference cadence.
- `media_ref` is an authorized server-managed reference or scoped expiring HTTPS URL; no secrets in records/logs. Local `blob:` URLs stay preview-only. No arbitrary client URL fetch/provider forwarding; future upload/fetch adapters validate rights, MIME, bytes and every redirect, reject private/loopback/link-local destinations and unsafe schemes.
- Acquisition geometry: `source_position` (declared coordinate frame, units, altitude datum, capture orientation) or null; `location_uncertainty_m` or null; `view_frustum` (horizontal/vertical FOV, near/far distance with units and provenance) or null. A camera footprint is not a detected target pin.
- Quality: `occlusion_status`, `smoke_status`, `fov_quality`, `calibration_confidence` and `clock_uncertainty_ms` are source-reported or explicit unknown. Finite source values retain their scale/method; no invented range, confidence, GPS or field of view.

## Pixels are not temperature truth

`display` holds `palette` (e.g. Ironbow), gain/contrast, transform version and `display_only=true`; retain original media reference. Colorization/classification provenance remains separate from sensor calibration.

Temperature samples exist only when `radiometric=true`, verified source-linked calibration and source-supplied calibrated pixels/units all exist. Preserve calibration validity/uncertainty and pixel mapping. Otherwise omit temperature samples/min/max/Celsius overlays entirely; model captions and colors cannot manufacture them. Toy scene temperature, if later approved, is separate exercise truth, not a camera measurement.

## Analysis and Iris boundary

Analysis: `analysis_id`, `job_id`, exact `frame_ids`/`evidence_ids`/`source_snapshot_id`, input content hashes, feed modality, source kind, calibration status, provider/model/task/contract version, `analysis_at`, input revision, status/rejection reason and `hypotheses`.

Each hypothesis: `hypothesis_id`, `kind: human | animal | fire | gas_canister | other`, `verification_status=unverified`, evidence IDs, optional normalized pixel region, geography/uncertainty or explicit unknown, contradictions, returned `model_score` plus actual scale or unknown. Model score is **not calibrated probability**; a gas-canister appearance does not establish contents or explosion risk. Captions are not corroboration.

Only delivered eligible pixels and allowed metadata enter analysis. Hidden exercise labels, planted masks/boxes and future world truth stay evaluator-only. External text and model output are untrusted data. Analysts cannot create simulator truth or silently clear unresolved alerts by aging.

RGB caption/detection on false-color images needs separately tested modality/task input/output contracts. Researched fal Florence, Video Understanding and SAM3 schemas establish catalog shape, not thermal capability, accurate victim finding or radiometric support. Genuine approved receipts and measured case results are still required; no provider calls in this draft.

Iris ranks only finite registered, available, valid and fresh feed IDs against received evidence and capability. Unknown age cannot rank as fresh. Reject unknown IDs/non-finite scores/stale replies; no candidates means explicit unavailable. Iris cannot overwrite temperatures, calibration, physics, delivery facts or personal camera selection.

## Compatibility, handoff and non-goals

Pinned PR2 `6bdb5884`, static read: `proposal/fcc/src/console/world/feeds.ts` creates one channel/drone; even IDs use Ironbow, odd IDs EO, drone 3 says EO/IR but `fx=eo`. `stage3d/fx.ts` colorizes scene pixels. This does **not** satisfy every-drone thermal, radiometry or genuine detection. Build/typecheck receipts prove none of T01–T06.

Future teammate adapter maps existing `id→feed_id`, `unitId→asset_id`, `fx→display.palette`, preserving explicit new modality/source/calibration/clocks. Do not derive thermal capability from label or `live` flag. Root publishes a reviewed contract revision; teammate alone changes `proposal/fcc/**` capture/render/store/UI, then supplies pixel/metadata fixtures for joint tests.

Non-goals: real thermal hardware/calibration, verified human/animal/hazard identification, calibrated wildfire prediction, flight/RF certification, field dispatch/control, controller training, new providers/dependencies or paid requests. Approval of this document is not approval to implement.
