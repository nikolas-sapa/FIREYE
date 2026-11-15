# Sponsor jobs v1

Status: bounded dormant implementation contract, issue #10. Not live readiness or whole-product acceptance. Internal server function arguments, not a public endpoint or authentication layer.

## Test plan, numeric targets before implementation

| Test | Pass criteria |
|---|---|
| SP01 | 4 default-disabled adapters and absent/zero/negative/nonfinite authorization ceilings: 0 transport calls. 1 positive fixture per adapter; 10 malformed replies per adapter reject 40/40. |
| SP02 | 20 stale/cross-run/epoch/superseded replies: 0 accepted outputs. 20 unknown Iris IDs/nonfinite scores: 0 rankings. Outputs expose 0 approval/reservation/execution operations. |
| SP03 | 20 duplicate submissions: 1 invocation identity. At most 2 physical in-flight transports, 8 queued jobs, 1 attempt/job, positive whole-call/total reservations and deadline. 600 disabled submissions allow independently advancing 600 deterministic ticks, 0 provider calls. |
| SP04 | 20 hostile provider errors: 0 raw strings or secrets in output/receipts. 20 closed model inputs: 0 hidden labels/masks/target coordinates/future facts. Unknown input fields reject before transport. |
| SP05 | Treg 1 attempt, 0 retry/waterfall, deadline <=10,000 ms, TTL <=60,000 ms, response <=262,144 bytes, <=5 unique safe HTTPS navigation links. Redirect, oversize, stale/unknown schema reject. Empty list means 0 sources, not absence of incident. |
| SP06 | Provider smoke separately gated: <=1 call/approved adapter, <=4 total, exact positive per-call/total caps before dispatch. Fixture/local HTTP provenance never counted as genuine calls. Missing approved spend or enforceable provider ceiling: 0 calls. |

## Implementation sequence

1. Claim exact paths; publish these tests/non-goals; inspect public official schemas without inference calls.
2. Land RED native Node tests against actual exported functions; no invented mocked package exports.
3. Implement shared closed immutable received-snapshot validation, bounded single-attempt transport and server-created receipts. Implement fixed adapter requests and semantic result guards.
4. Add <=2 physical transports/<=8 queued local scheduler, dedupe and currentness checks both before dispatch and result acceptance. Hold reservations after errors/timeouts, never assume cancellation/free upstream work.
5. Run focused tests, all 71 baseline tests, typecheck and non-mocked loopback HTTP per adapter. Publish honest receipts; public live smokes remain skipped absent positive caps.

## Data/authority boundary

Review correction v1: every job requires exact closed `task_input`: Iris `{candidate_ids}`, Gemini/fal `{evidence_id,png_base64}`, Treg `{query}`. Callback signature is `(signal, reservation, boundInput)`, where boundInput is the frozen owned complete client input `{snapshot,...task_input}`. Consume boundInput, not different closure arguments. Identity includes its SHA256 plus adapter/task_version/model. Changed candidates/query/evidence produce separate identities; same job ID with changed input conflicts. Issued receipt input hash/model/adapter must match bound job, result evidence/candidate IDs must match task. Cache lookup and every Promise read recheck trusted currentness; stale cache returns STALE without a new call. Strict string enums reject array coercion; arrays require Array.prototype and dense own numeric data properties, proxies/accessors reject without execution.

Snapshot contains incident/run/authority epoch/input revision/snapshot ID and UTC-millisecond acquisition/receipt/currentness clocks, evidence IDs, source IDs, exact source kind, rights-manifest IDs, modality and explicit synthetic/radiometric/calibration flags. Input fields are closed. Unknown acquisition time fails fresh analysis. Currentness callback is trusted server code, never a body assertion. Every evidence receipt must precede snapshot cutoff. Rights-manifest ID is a server-trusted eligibility reference, not license proof supplied by a browser.

Media input is server-resolved PNG bytes, hash/byte/dimension matched against received metadata (<=256 KiB, <=1024 each dimension). No arbitrary URLs, automatic uploads, decoder claims or hidden evaluator truth. PNG structural checks are not full image decoding. EO-only Gemini/fal; thermal rejected pending genuine modality/task approval. Iris receives whitelisted metadata and registered finite candidate IDs, not simulation truth or model-invented options.

Outputs are finite rankings or evidence-linked **unverified** kinds/synthesis codes. No free-form raw captions, rationale, title, snippet, query, provider errors, coordinates, temperatures, calibrated probability or field actions. fal caption keyword normalization is a local unverified transformation, not a verified detection result. Source kind and call provenance are distinct. Configuration, credentials, request bodies and raw responses never belong in DTOs or receipts.

## Server-owned configuration and cost

Factories default disabled. Trusted injection supplies enabled flag, authorization ID, exact provider/model, positive deadline/per-call cap, shared positive total-call/total-spend budget and currentness callback. No environment reading or inferred variable names. `fixture` and `local-http` are explicitly non-provider transport modes; injected transports cannot produce genuine receipt provenance. Only fixed built-in transport can issue provider requests.

Iris/Gemini/fal built-in provider modes are unsupported until independently verified enforceable price ceiling exists. Exact request shapes can still be tested locally. No guessed `max_cost` request fields. Treg documents whole-route ceiling header; send positive ceiling, waterfall `0`, exact request `{q, limit:5, contents:false}`. Its upstream hard-settlement guarantee is provider-dependent; absent owner approval, keep disabled. No config DTO authenticates a browser or grant to spend.

Budget reserves the full approved per-call ceiling atomically before transport, never refunds on failure/timeout/missing usage. Scheduler callback receives an opaque one-use server reservation as its second argument; supply this as client config `reservation` with the same budget and exact cap. Client consumes prepaid reservation without incrementing calls/spend twice. JSON/body cannot forge reservation. Direct clients acquire/reserve normally. Local scheduler is not distributed rate limiting. Entries retained up to 256 identities/aliases, then fail closed; dedupe identities are never silently evicted into re-execution. Scheduler preserves only receipts issued by actual client code in this process, never model/body forged provenance.

## Treg metadata-only links

Fixed POST `https://treg.to/call/treg.web.search`. Catalog uses `q`, not `query`. Response `output.results` is provider-native. Accept only rows with string `url`; unsupported row schemas fail closed, never guess alternate nested keys. Drop query/fragment, reject credentials/IP/local names/unsafe schemes/ports/secret-like paths; <=5 unique links. Syntax guard is not DNS safety proof. These links are navigation metadata only, never automatically fetched. Preserve finite allowlisted serving-provider metadata and optional bounded call/cost headers; unknown cost remains null.

## Non-goals

No provider calls without separate approval/caps, secrets/account searches, purchases, retries/fallback/vendor/dependency changes, deploy/provision/VMs, public route/auth/database/schema integration, teammate simulator/UI changes, real victim identification, calibrated thermal claims, field orders or upstream cancellation guarantees. Timeout never means free or cancelled. Local receipts prove function/HTTP paths, not provider access/accuracy.
