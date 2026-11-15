# Sponsor adapter verification receipts

2026-11-15, Node 26.11.1/npm 11.20.0, isolated branch `task/sponsor-adapters-v1`, base `4748ee8`. Local server-function slice only. Not deployed, no browser/authentication product, no Convex dependency.

## Observed RED/GREEN

- RED: three initial native suites exited 1, 0/3 passed, missing actual Iris/shared/Treg modules, before implementation.
- GREEN: 25 focused tests, 25 passed, 0 failed, 0 skipped; TypeScript `npm run typecheck` exit 0. Four exported adapter functions each traversed actual loopback `node:http` and native fetch with official-schema fixtures, provenance `local-http`, no public provider transport.
- Combined `npm test`: 96 tests, 96 passed, 0 failed/skipped, 461.409084ms; 71 unchanged protocol/state tests plus 25 sponsor tests. `git diff --check` exit 0. Existing package/lock/core unchanged. Node 24 floor unrun.
- Root integration feedback fixed before freeze: real planner-style `proposed:candidate:<64hex>` IDs pass Iris guard; actual scheduled Iris client with total calls=1 and cap=100 micro reserves exactly once, returns issued fixture receipt through scheduler. Opaque one-use reservation and process-issued receipt prevent JSON/body-forged claims.
- SP01: 4 known-positive fixtures, 40/40 malformed replies rejected; 20 invalid positive-ceiling cases across four clients invoked 0 transports.
- SP02: 20 stale client completions plus 20 superseded job completions accepted 0 outputs; 20 unknown/nonfinite Iris fixtures accepted 0 rankings.
- SP03: 20 duplicate submissions plus alternate job ID/deadline invoked 1 identity; observed 2 physical in-flight and 8 queued, eleventh rejected. Physical slots remained held after timeout until transport settled. 600 independent deterministic counter ticks with disabled jobs, 0 transports. This counter is not teammate simulator integration/performance proof.
- SP04: 20 hostile errors and 20 hostile scheduled values serialized 0 supplied raw strings; 20 extra evaluator-only input fields invoked 0 transports; proxy/accessor reads 0. Wrong media/hash/thermal rejected before transport.
- SP05: exact `{q,limit:5,contents:false}`, waterfall `0`, positive ceiling; empty sources returned [], unsupported row shapes rejected. Redirect/declared oversize/streamed oversize rejected 3/3; 20 stale/TTL>60s inputs invoked 0 transports; 20 unsafe navigation strings rejected. 10ms timeout held physical slot, no retry; >10s config rejected.
- SP06 public smoke **SKIPPED**, `live_calls=0`, metered provider requests=0. Fixture and loopback requests are not genuine inference or access receipts. No inference accuracy/thermal/cost/free-tier claims. No credential read or key creation in this lane.

## Verified public schemas, not provider acceptance

Public read-only documentation/catalog retrieval, no inference request, on 2026-11-15:

| Adapter | Official source and exact checked schema |
|---|---|
| Iris | [Oumi decision models](https://docs.oumi.ai/guides/decision-models): POST `https://inference.oumi.ai/v1/systemone`, `X-API-Key`; model path `projects/{project_id}/models/{model_name}`, state, questions. `choice` criteria object; reply model, answers, choice/probabilities/confidence, usage inputTokens/outputTokens. Only registered finite IDs normalized. |
| Gemini | [Generate-content API](https://ai.google.dev/api/generate-content): POST `/v1beta/models/{model}:generateContent`; contents/parts, `inlineData` with `mimeType`, candidates/content/parts/text, finishReason. `generationConfig` output caps/JSON MIME. Gemini model ID in tests is fixture configuration, not verified owner availability. |
| fal | [Florence caption API](https://fal.ai/models/fal-ai/florence-2-large/caption/api): task `fal-ai/florence-2-large/caption`, input image_url, output results string; data URI accepted. [Inference methods](https://fal.ai/docs/model-apis/model-endpoints) documents direct run versus queue-backed methods. No SDK installed; fixed direct URL seam only. Queue submit/status/polling unsupported, no fabricated async completion. |
| Treg | [Integration](https://treg.to/integrate.md), [public catalog endpoint](https://treg.to/catalog/endpoints/treg.web.search): POST tool `treg.web.search`, body q/limit/contents; routed reply output/raw/_treg, output.results provider-native; `X-Treg-Token`, `X-Treg-Route-Waterfall:0`, `X-Treg-Route-Max-Cost`; optional cost/call/serving-provider headers. Parse only URL rows, unfamiliar schema fails closed. Catalog estimates are not spend receipts. |

Built-in genuine Iris/Gemini/fal transport deliberately returns `UNSUPPORTED`: docs inspected did not establish enforceable whole-call monetary ceilings. No fake provider `max_cost` fields added. Treg documents a route reservation ceiling but settlement forwarding is provider-dependent; no claim of universal upstream hard settlement. All defaults disabled.

## Credential/configuration seams and smallest genuine path

No env-file discovery, process.env reads, guessed variable names, secrets serialization or app-login work. Root alone owns credential setup. Trusted factory configuration uses `credential`, `model`, `authorization_id`, `enabled`, `max_call_micro`, `deadline_ms`, shared `SponsorBudget` and `is_current`. Authorization ID records human-approved provider execution scope, not user authentication. Injected fixture/local HTTP transports omit provider auth headers.

Iris credential header would be `X-API-Key` and actual existing-project `projects/.../models/iris-...` path. Root must confirm exact project model access and credential; organization/account presence is insufficient. Gemini would use `x-goog-api-key`; fal would use `Authorization: Key ...`; Treg uses `X-Treg-Token`. No keys validated here. Iris/Gemini/fal require independently verified bounded price enforcement before unlocking genuine built-in transport; that change needs review.

Minimum separate authorized smoke: name adapter, serving model/task, permission-cleared immutable received evidence, one call, positive exact per-call micro-USD ceiling, total calls=1, positive exact total micro-USD ceiling >= per-call, <=10s deadline and approved rights. Ceiling value must come from owner, not guessed as affordable. One invocation is smallest, not zero-cost promise. Failed/timeout unknown usage remains fully reserved; no retry/waterfall. Scheduler supplies opaque prepaid token as callback second argument; pass same budget/token into client to reserve once, never raise cap to hide double counting. Direct clients also cap physical transports at 2; scheduler never releases a timeout slot while callback remains unresolved.

Bridge dependency: root/teammate must provide server-validated received metadata/rights and eligible exact PNG bytes; local bridge snapshots alone do not create model inputs or prove media rights. Clients never receive hidden simulator labels or a browser-supplied arbitrary provider URL. This slice adds no bridge HTTP route, orchestration main loop or canonical-state writes.

Receipts contain hashes/evidence IDs, fixed endpoint/model, clock/status, capped reservation, optional bounded factual call ID/cost and explicit provenance. Raw request/query/response/credential never retained. Treg idempotent replay header prevents fresh-call marker; saved receipts must be displayed as historical, never dispatched to providers. Absence of cost remains null, not free. Timeout upstream cancellation remains unknown.

Non-goals: deployment, provisioning, vendors/dependencies, purchases, provider smoke without caps, arbitrary source fetch, thermal validation, operational forecasts or field control. Root performs independent TypeScript/security review and delivery.
