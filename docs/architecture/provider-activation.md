# Provider activation preflight, issue #16

Owner `/root/activation_setup`, branch `task/provider-activation-v1`, base `67495775`. Own new `backend/setup/activation-status.ts`, `backend/scripts/provider-preflight.ts`, `backend/tests/provider-preflight.test.ts`, this document, append-only TASKBOARD ACT-01. Preserve other workers. Coordinator alone handles Git delivery.

## Test plan first

- ACT01: 20 disabled/default/unknown checks invoke 0 transports. CLI default and `--status` each emit 1 sanitized report, genuine paid calls 0.
- ACT02: 20 secret/malformed/accessor/proxy fixtures produce 0 leaks, 0 throws, 0 getter reads. Unknown CLI inputs echo 0 input strings.
- ACT03: fixed GET catalog/account routes only, redirects rejected, credential headers never URL/output. One actual native localhost health path returns local-check-only, current provider auth verified count 0.
- ACT03 deadline: one hung transport resolves failed in <5500 ms, 0 verified results; response body <=65,536 bytes, 0 retries.
- ACT04: actual setup monetary-ceiling guard unchanged, 3 hard-ceiling-unsupported slots; full native tests, existing typecheck, compiled tests and diff-check each exit 0.

## Implementation plan

1. Reuse actual provider setup status, retain credential/model/cap distinctions and paid disabled state.
2. Add dry standalone preflight report and explicitly selected read-only check for already established Gemini models / Treg auth routes only. Other health endpoints unavailable, never guessed.
3. Add CLI, named numeric tests and exact receipt. No automatic env/config search.

## Non-goals

No inference/retrieval, approvals to spend, key creation/copy/search, dashboard loop, arbitrary URL, fallback, credential file edits, VM wake, frontend/backend launch, provisioning, deploy or Git delivery. Budget not required for dry work.

## Report and CLI

`createProviderActivation(env, approval, now)` reads actual `createProviderSetup` status. `status()` is dry. `check(provider, {enabled:true})` alone enables the fixed native account/catalog GET. Injected test transports are always `local-check-only`, never current provider authentication proof. Nothing sets `active=true`, modifies setup authorization or invokes inference.

CLI: `node backend/scripts/provider-preflight.ts --status` (also no args). Optional `--check gemini` or `--check treg` is explicit network opt-in, no automatic `.env` discovery or private credential file reads. Native CLI returns 1 for missing/failed credentials, 2 for unknown arguments (input not echoed). Approval parameter belongs to server API only; CLI cannot authorize spending.

Six rows: Iris, Gemini, fal, Treg, Gemma and Firecrawl. `counts.configured` means credential present plus configured model (or model-free Firecrawl), not ready/connected. `auth_verified` means successful current native Gemini catalog schema, never prior reports or local tests. `cap_missing` counts null monetary caps, including adapter-unavailable slots. `live_unsupported` counts underlying unsupported paid transports, independent of missing credentials. Rows carry explicit endpoint/model/budget gaps. Firecrawl remains separate from Treg. Boxd always execution-disabled.

| Check | Fixed route | Honest proof |
|---|---|---|
| Gemini | `GET https://generativelanguage.googleapis.com/v1beta/models`, `x-goog-api-key` | Authenticated native model catalog only, not inference/quota/paid access. Exact configured Gemini/Gemma ID may become catalog-listed, never inferred from names. |
| Treg | `GET https://treg.to/auth/me`, `X-Treg-Token` | Valid JSON object/200 gives account-read-succeeded, NOT identity-verified (official identity schema unavailable). |
| Iris/fal/Gemma/Firecrawl | No new health endpoint | Unknown endpoints null, no guessed probes or silent vendor substitutions. Gemma may share Gemini catalog listing, never an extra call. |

Native checks require response URL exact match, HTTP200, no redirects, finite deadline/body. Credentials stay closure/header-only. Account bodies, balances, IDs, raw model lists, errors and headers never serialized. Historical Gemini/Treg/Firecrawl auth receipts remain in [provider setup](provider-setup.md), explicitly not current preflight verification.

Public docs checked with agent-reach/Jina on 2026-11-15: [Gemini models reference](https://ai.google.dev/api/models), [Treg published catalog guide](https://treg.to/llms.txt), [fal auth](https://fal.ai/docs/documentation/setting-up/authentication), [fal platform APIs](https://fal.ai/docs/api-reference/platform-apis), [Firecrawl credit usage](https://docs.firecrawl.dev/api-reference/endpoint/credit-usage). Account/catalog availability is not enforceable whole-call monetary ceiling. Existing Iris/Gemini/fal `UNSUPPORTED` guard retained; Treg product call still needs current exact approval + model/task/rights/positive caps and fixed whole-route max-cost/waterfall0. No paid fallback policy adopted. Firecrawl account usage endpoint not added without established scope/schema.

## Owner-action brief

No input needed for completed dry work. Activation still needs:

- Iris: accessible browser host plus action-time key-creation confirmation, exact existing Oumi project/model. No raw key requested.
- fal: existing project-scoped credential made available server-side through approved auth path, no account-wide search or key mint.
- Exact catalog-listed Gemini/Gemma model selection and applicable local runtime/adapter availability. Presence/catalog is not inference proof.
- Future paid work only: explicit provider/model/task/rights, one-call/session positive monetary ceilings and expiry; provider-enforced hard ceiling (or separately approved policy change). Current hard-ceiling-unsupported transports stay blocked.
- Frontend launch remains separate explicit confirmation. Boxd wake/new VM not in scope.

## Verification receipt

Node26.11.1, 2026-11-15. RED missing actual activation module, exit1. GREEN focused6/6, 0 skipped. Twenty disabled/unknown + twenty unsupported/missing checks invoke0 transports; twenty secret/malformed env/options fixtures leak/throw/read0. One native localhost `/health` GET gives local-check-only/auth_verified0. Hung check fails at5001–5002ms (<5500ms). Whole native226/226 (7141.962584ms) and compiled226/226 (6796.894042ms), typecheck/compiler exit0. Initial `tsc` absent, existing pinned `npm ci --ignore-scripts` installs3 packages, audit0, no package changes. Final diff-check exit0. Actual dry CLI six rows, genuine_calls0/read_only_attempts0/active0/auth_verified0. No native provider health flags invoked, account network calls0, paid/retrieval/VM/frontend/deploy/Git writes0. Generated check directory cleaned by existing script. Coordinator independent TypeScript/security review, cross-worker Gemma composition and Git delivery pending.
