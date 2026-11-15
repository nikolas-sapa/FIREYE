# backend-bridge.v1, EXERCISE diagnostic contract

Local, disposable received-state authority around `backend-protocol.v1`. Convex remains eventual canonical authority. No distributed durability, verified human authentication, simulator execution, media or provider proof.

## Test plan (acceptance targets)

B01: two HTTP clients,20 commits,20 identical snapshots;10 local selections,0 writes. B02:20 concurrent distinct approvals,1 winner/19 conflicts/1 command;10 identical retries,0 added revisions. B03:100 malformed/foreign/body-role cases +20 missing/expired/non-Chief cases,0 commits. B04:24 stale proposals,0 actions;10 telemetry/frame interleaves,10 acceptance rejects. B05:10 rejoin reads,0 regressions/duplicates;>5s heartbeat absence,freeze within1s,10 reconnects,0 dispatch. B06:20 frames (10 unknown clocks/geography),0 invented metadata;10 duplicates,0 revisions;10 critical hypotheses survive aging. B07:1 actual HTTP proposal→approval→read→sent→delivered→check→accepted→frame→two snapshots,0 fabricated completion/provider calls. Existing71 core tests plus bridge tests,0 failures,typecheck0.

## Exported seam

`createBridgeAuthority(seed: IncidentSeed, clock: () => TrustedClock): BridgeResult<BridgeAuthority>` in `backend/integration/session.ts`. `TrustedClock` contains server UTC `received_at` and configured exercise `sim_tick`. Authority methods: internal `read()`, `now()`, synchronous `ingest(input,actor)`, `approve(input,actor)`, `pending(actor)`, `check(input,actor)`, `heartbeat(actor)`, `expireProducer()`. No await inside compare-and-commit. ActorContext is a server argument, never body privilege. No takeover endpoint.

`createReceivedView(state: IncidentState, cutoff: string): Result<BridgeView>` in `received-view.ts`. Validates complete canonical log using `selectReceivedSnapshot`, replays selected contiguous prefix, never pulls future review options. DTO fields: protocol identity; `bridge_version='backend-bridge.v1'`, `mode='EXERCISE'`; incident/input/plan/reservation/Chief revisions; authority_active; as_of_received_at; `media_verified=false`, `coordinate_frame=null`; registered feeds; telemetry/frames/hypotheses rows exactly `{incident_revision,received_at,payload}`; current proposals/candidates; commands exactly command_id/command_version/asset_id/mission_id/mission_version/approval_id/proposal_id/status. No seed, canonical actor/session/trace, provider raw output or private world. Latest frame per feed mirrors core, not a full media history.

`startLocalBridge(authority, {port,allowed_origin,fixture_sessions})` returns `{url,close()}`. Port0 permitted. Fixture map values `{actor,expires_at}`, immutable copied at startup; expiry ≤30minutes from startup. Registry credentials are local test capabilities, not human-auth proof. Origin must be one exact http loopback origin. Host always exact bound `127.0.0.1:port`, bind127.0.0.1 only. Every request requires configured Origin; no wildcard CORS. Authorization bearer header only, no URL credentials. Browser preflight permits only GET/POST with Authorization/Content-Type; OPTIONS never grants role or mutates authority.

## HTTP resources

| Resource | Input | Permission/result |
|---|---|---|
| GET /incidents/:id/snapshot | after_revision integer≥0,wait_ms integer0–10000,optional received_at explicit UTC (historical requires no polling arguments) | Fixture member, BridgeView; no-change204. Local lens/pin/selection are not endpoints. |
| POST /incidents/:id/events | Exact EventInput | Producer telemetry/frame/receipt; analyst hypotheses/proposals; current Chief proposals. Server events forbidden. Mutation result is BridgeView, never raw IncidentState. |
| POST /incidents/:id/approvals | Exact ApprovalRequest | Current Chief, enqueued intent only; BridgeView. |
| GET /incidents/:id/commands | No query/body | Current designated producer, eligible nonterminal canonical commands only. No receipt fabricated. |
| POST /incidents/:id/command-checks | Exactly command_id,expected_incident_revision | Producer, current revision +real acceptance guard. Checked command, not durable execution grant/ACK. |
| POST /incidents/:id/producer-heartbeats | Empty body | Producer, private server liveness only, null result. |

Success `{data:...}`, error `{error:{code,reason}}`, no stacks/input/token echo. Missing/expired capability401,role/Host/Origin403,resource404,invalid schema/time400,stale/expiry/frozen/conflict409,body>64KiB413,>60 mutation attempts/session/min429,16 pending polls maximum429,1000 revisions/run503. Reserve revision1000 for fail-closed freeze after999 ordinary commits. Timer checks liveness every250ms; failed heartbeat cannot revive freeze. Reads trigger expiry too. At most10s poll; credential expiry rechecked after wait. Shutdown cancels polls/timers/connections.

## Mapping/non-goals

Unknown captured_at/source_position/geography/calibration/model_score remain null. Coordinates have no approved Geo mapping, never fabricate(0,0),AGL,Celsius or confidence. Every observation keeps feed/evidence/source IDs and original capture/receipt clocks. Hypotheses remain unverified; aging never resolves critical hypotheses. Registered feed metadata proves no rendered thermal camera. Opaque media_ref is not a fetched URL or browser blob transport.

Strict current core input_revision rule remains: observation between approval and acceptance invalidates intent. Receipt facts do not confer new acceptance authority. Crew reads never instantiate simulator Runtime. Teammate owns producer executor and crew adapters, all proposal/**; needs reviewed coordinate frame/origin/units/altitude datum before console mapping. Non-goals: cloud/deploy/Convex SDK/new vendor/production auth/providers/media decoding/physics/real orders/public alerts. Saved/replay facts are not fresh calls or new execution.
