# Dormant Gemma 4 text adapter

Issue [#14](https://github.com/nikolas-sapa/fire-command-center/issues/14), 2026-11-15. Local implementation only, genuine Gemma calls = 0. Backend completion/review and explicit owner confirmation still precede frontend launch.

## Scope and official identity

Coordinator checked official [Gemma via Gemini API](https://gemma.ai/deployment/gemini-api/) on 2026-11-15. Hosted IDs: `gemma-4-31b-it`, `gemma-4-26b-a4b-it`. Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/models/{exact_id}:generateContent`. Shared hosting transport does not rename Gemma as Gemini. Receipt adapter is `gemma`, model remains exact selected Gemma ID. Smaller hosted IDs, Gemini IDs and local model aliases reject.

Approved implementation choice: dormant hosted REST compatibility only. Native request contains `contents` with one user/text part and `generationConfig.maxOutputTokens=512`. JSON requested in prompt, strictly validated locally. `responseMimeType`, tools, media, system-instruction support and server-enforced JSON capability are not claimed verified. Public documentation is schema evidence, not credential/API acceptance or hard spend-cap proof.

## Public local API

`createGemmaClient(config?: GemmaConfig): GemmaClient`, exported from `backend/integrations/gemma/client.ts`. `analyze(input: unknown)` returns shared `Result<GemmaAnalysis>`. No application endpoint, launch script or runtime process added.

Config uses existing `ClientConfig` fields: `enabled`, `authorization_id`, `max_call_micro`, `deadline_ms`, `budget`, `is_current`, optional `now`, `transport`, `transport_mode`, `reservation`, `model`. Gemma additionally requires `runtime: 'hosted-rest'`. Defaults disabled. Enabled local checks require explicit authorization ID, positive cap, `SponsorBudget`, currentness callback and deadline 1–10,000 ms. Only injected `fixture` or `local-http` transport runs. Without injected transport, `UNSUPPORTED` before budget reservation/fetch, even if a credential is supplied. No env-variable contract invented; no key requested or read by this slice.

Input exact fields: `{ snapshot, evidence_id, text }`. Snapshot must contain exactly one known/current received text evidence record, matching evidence ID, no image dimensions. Text is nonblank, round-trip valid UTF-8, at most 16,384 bytes, exact declared byte length/SHA256. Shared snapshot guards require known capture time, capture <= receipt <= received cutoff, acquisition age <=60 seconds and snapshot expiry in the next <=60 seconds. Unknown/stale/malformed facts reject, rather than inventing metadata. Rights/source/synthetic/clocks remain in the prompt and input hash; rights ID presence is not permission verification. Producer must supply permission-cleared received source text, never hidden evaluator labels or future facts disguised as prose.

Output exact fields: `kind='evidence-analysis'`, `verification_status='unverified'`, locally bound `evidence_ids`, unique `hypotheses` (0–5 from human/animal/fire/gas_canister/other), `synthesis` (`review-required` or `insufficient-evidence`). Native response must have one STOP candidate and one text-only part. Decoded extra fields, tool calls, unknown hypothesis/synthesis values and model-supplied evidence IDs reject. No free-form provider output, coordinates, identity, temperatures, approvals or executable commands exposed. Text prompt injection may affect model judgement, but cannot grant tool/approval/execution authority.

## Bounds and current limitations

Reuses actual `perform`, `SponsorBudget`, snapshot/JSON guards and server-issued receipts. At most two active invocations per shared budget, no adapter queue, one transport attempt per invocation, deadline <=10 seconds, response <=262,144 bytes. Currentness checked before dispatch and after reply, caller input cloned/frozen, raw failures sanitized. Deadline abort cannot prove provider cancellation; receipt says `upstream_cancelled='unknown'`. The third concurrent invocation rejects `BUDGET`, not queued.

Gemma is not composed into `SponsorJobs`: existing job task-input allowlist has no text analysis shape. Thus no Gemma eight-slot queue, per-job identity/deduplication or scheduler composition acceptance claimed. Shared jobs extension requires its own sequenced owner handoff/review. Standalone repeated invocations may each consume a reservation; this is not once-per-job execution. Genuine hosted calls remain unsupported until provider capability, effective hard cost ceiling, source permissions and <=1-call smoke authorization are independently established. Local fixtures cannot establish model quality, access, cost or hosted support.

## Test plan before implementation

- G401: 20 missing/invalid gates and 20 unsupported IDs, 0 transports. Disabled/no-transport provider modes fail closed.
- G402: 10 valid text fixtures, typed unverified outputs with exact identity/provenance; 20 malformed/tool/unknown-ID/superseded replies, 0 accepted results.
- G403: 20 hidden/unknown input fields, 0 transports; hostile accessors/proxies, 0 reads; 12 text/hash/modality/time input failures, 0 transports; 20 raw-error controls, 0 leaked strings. Two active/zero queued/one attempt, bounded response/redirect/deadline rejection.
- G404: focused/existing tests, 0 failures; TypeScript exit 0; actual exported client makes >=1 non-mocked loopback HTTP request labelled `local-http`, fresh provider call false. Pinned real TypeScript dist invoked by typecheck, not a mocked compiler.

Implementation sequence: missing-export RED, minimal validators/client/parser reusing shared foundation, focused/core/typecheck/export GREEN, coordinator review/delivery. Non-goals: frontend launch, Convex/auth, vendor switch, paid/provider calls/key requests, purchases/top-ups/VMs/deploy, dependencies/model download/quantization/runtime start/training, image/media ingestion, automatic tools/routes/approvals, validated operational claims.

## Verification receipt

RED: `node --test tests/gemma-client.test.ts`, exit 1, actual `gemma/client.ts` absent. Initial GREEN: 8/8 focused, 111/111 combined, 0 failures (527.39 ms), TypeScript exit 0. Coordinator caught synthesis enum coercion; fixed with 3 array/nested-array regressions, final focused/typecheck rerun below. Actual compiled Gemma-export check and independent TypeScript/security review remain coordinator gates, not claimed completed by the worker. Node 26.11.1/npm 11.20.0; Node >=24 declared, Node 24 unrun. `npm ci --ignore-scripts` restored existing pinned dev tooling, 0 new dependencies, audit 0 vulnerabilities. Local HTTP output is test data, never a genuine Gemma reply. Provider calls, keys, deployments and frontend launches = 0.

Final worker rerun after coercion fix: 9/9 focused, 0 failures (194.953125 ms); `npm run typecheck` exit 0, `git diff --check` exit 0. Full suite after this one regression addition remains coordinator rerun gate. Owned files frozen for handoff; no worker Git delivery.
