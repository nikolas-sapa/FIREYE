# Provider setup, issue #16

Owner `/root/provider_setup`, branch `task/provider-setup-v1`, baseline `2155c52`, reviewed sponsor prerequisite `83ddcb8`. Exact files: `backend/setup/provider-config.ts`, `backend/scripts/sponsor-smoke.ts`, `backend/tests/provider-config.test.ts`, this document, append-only `TASKBOARD.md` SETUP-01. No package, client, jobs, receipt or frontend edits.

## Test plan first

- SS01: 5 explicit slots (Iris, Gemini, fal, Treg/Firecrawl context, Gemma), each with disabled/configured/unsupported, endpoint/model/caps/rights status. 20 missing/invalid approval or cap cases invoke 0 transports.
- SS02: 20 duplicate actual job→client compositions reserve exactly 1 call/cost and invoke exactly 1 loopback transport. Stale/auth/cap failures invoke 0 fallback transports.
- SS03: default CLI/import genuine calls=0. Explicit current approval must bind each adapter/model/task/rights, positive per-call/per-adapter/session caps, ≤1 call/adapter and ≤4 total current sponsor smokes. Gemma cannot become an automatic fifth call. No actual paid smoke authorized yet.
- SS04: actual config/client exports pass; 20 credential sentinel fixtures leak 0 secret values through public status/CLI/results. Focused tests/typecheck/diff check exit 0. Fixture and loopback results never labelled genuine inference.

## Implementation plan

1. Inventory only repository env names, named installed provider connector artifacts and status. Store no raw key in tracked source or output. Record actual access versus unknown validity.
2. Implement closed server config with explicit fixed routes, disabled defaults, public status allowlist, exact positive approval and deadline guards. Preserve existing hard-cap unsupported Iris/Gemini/fal transports, no substitution/fallback.
3. Compose existing actual job/client APIs behind one bounded session; enforce approved task input/model/rights and duplicate identity before spending. CLI is dry status by default, live mode requires separate private approval/job files, no startup inference.
4. RED/GREEN actual-export tests, non-mocked loopback check, typecheck and independent root review. Genuine smoke stays blocked until exact monetary ceilings are authorized and supported.

## Non-goals

App auth/login, frontend launch, purchases/top-ups, new projects, VM start/provisioning, deploy, arbitrary fallback/vendor substitution, media ingestion, Gemma fifth smoke, modifying sponsor adapter API, claiming credentials prove inference. Coding worker does not stage/commit/push.

## Setup facts

2026-11-15, Node 26.11.1. Scoped repository `.env*` files absent. These new explicit server config names were selected after that inventory; they are not claims of pre-existing project names: `IRIS_API_KEY`, `IRIS_MODEL`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `FAL_KEY`, `TREG_TOKEN`, optional `GEMMA_MODEL`. Existing session environment has `GEMINI_API_KEY` and `FIRECRAWL_API_KEY`; other named sponsor keys absent. Neither account-wide history nor unrelated project credentials searched.

| Provider / requested name | Actual access evidence | Product boundary |
|---|---|---|
| Oumi / Iris | No installed native connector/key found in exact repo/session inventory. Prior org/project verification not repeated. | Disabled, model/project not configured. Final browser key creation needs action-time confirmation under CUA policy; browser host unavailable during this task. |
| Gemini / Google | Existing env credential; read-only `GET /v1beta/models`, `x-goog-api-key`, HTTP 200. Gemini models listed. | Key can list models, not proof of inference/quota. Disabled; genuine hard monetary-ceiling transport unsupported. |
| Gemma 4 / Google | Same official model catalog lists `models/gemma-4-26b-a4b-it`, `models/gemma-4-31b-it`. | Separate adapter owner. This setup slot explicitly adapter-unavailable until integration; not silent Gemini substitution or automatic fifth call. |
| fal | Native CLI absent, exact repo/session key absent. | Disabled. Fixed existing Florence route is EO caption only, not thermal verification; genuine hard monetary-ceiling transport unsupported. |
| Treg | `/Users/nikolassapalidis/.treg/fire-command-center/config.json`, directory 700/file 600, token present; scoped `/auth/me`, `X-Treg-Token`, HTTP 200. | Auth verified, token not copied into app config or printed. Product search disabled until exact smoke approval. Tool registry, not model router. |
| Firecrawl (user “fireclaw”) | Installed CLI 1.14.9, existing `FIRECRAWL_API_KEY`; read-only CLI status authenticated and quota returned. Stored CLI credential file absent, environment provides auth. | Direct Firecrawl adapter unavailable in approved four-adapter slice. Treg search is not silently presented as direct Firecrawl. No retrieval performed. |
| Boxd (sandbox context) | Installed CLI, documented macOS credential artifact, `boxd auth --json` verified; `boxd machine get long-glen --json` says hibernated. | Execution disabled, no machine start/wake/connection, no new VM/key. Not another vendor named Sandbox. |

No keys created, no private credential file created/copied, no inference/source retrieval/VM startup/deploy. Existing credentials remain at original private paths/session environment. No available quota authorizes paid work.

## Configuration and CLI

`createProviderSetup(env, approval, now)` captures secrets in a server closure. Enumerable object/status excludes raw keys, authorization IDs, headers, arbitrary user strings and exception text. `status()` always reports construction/status genuine calls=0, not historical provider usage. `createSmokeSession(...).usage()` reports the process-local actual reservation counts. Nothing starts an application or calls a provider at import.

An approval is a closed record with `authorization_id`, future `expires_at_ms`, `max_calls` (1–4), positive `max_total_micro`, and 1–4 unique `adapters`. Each adapter binds exact `model`, `task_version`, allowed `rights_manifest_ids`, positive `max_call_micro`, `deadline_ms` (1–10000). Sum of per-adapter ceilings must fit session total. Exact job caps and deadlines cannot exceed allowance/expiry. Session is process-local, not persistent/distributed accounting; rerunning a CLI starts a new local session, not authorization for extra calls.

`node backend/scripts/sponsor-smoke.ts --status` (or no args) prints safe disabled status only. Live form is `node backend/scripts/sponsor-smoke.ts --live <private-approval.json> <private-jobs.json>`, with explicit environment loading such as Node's `--env-file=<ignored-backend-env>` when required. No automatic `.env.local` discovery, generic credential search, CLI auth fallback, retry or VM startup. Genuine checks were not run: no approved positive caps supplied.

Jobs use existing `SponsorJob` closed input including `task_input`. Existing `SponsorJobs` supplies bound immutable input and one branded reservation; smoke composition shares it with the actual client, avoiding double charge. At most one distinct immutable task per approved adapter/process; 20 duplicates share one invocation. Stale/auth/rights/cap failure never calls another provider. Null/primitive evidence rejects before rights access, no coercion/getter/proxy trap access.

Live Iris/Gemini/fal retain deliberate `UNSUPPORTED`: local token/output/count/deadline guards do not establish a provider-enforced money ceiling. A future bounded estimate/token-cap approach requires explicit scope/budget choice, not bypassing this guard. Treg is the only existing genuine transport, with fixed `X-Treg-Route-Max-Cost` and waterfall=0. Firecrawl and Boxd are separately reported, never substitutes. Thermal/vision need cleared pixels; text eligibility is independent of media ingest.

## Verification receipts

- Initial actual-export RED: `node --test tests/provider-config.test.ts`, missing `setup/provider-config.ts`, exit 1.
- Root-identified malformed null evidence regression reproduced RED before guard fix: typed rights access threw. Added 20 malformed job/evidence cases, now 0 throws/calls/reservations.
- GREEN focused: 9/9 tests, 0 skipped, exit 0. Actual Iris/jobs through non-mocked local HTTP gives exactly 1 reservation/1 call for 20 duplicates, `provenance='local-http'`, `fresh_provider_call=false`. Four approved slots expose 3 unsupported monetary ceilings/1 configured Treg, Gemma never fifth; expired approval gives 0 calls, hostile env accessor gives 0 getter reads.
- GREEN whole backend: `npm test`, 112/112 tests, 477.849792 ms, 0 skipped, exit 0. Includes unchanged protocol plus reviewed sponsor prerequisite.
- `npm run typecheck`, exit 0; actual smoke CLI status exit 0, disabled 5 slots; `git diff --check`, exit 0. Initial typecheck lacked local `tsc`; `npm ci --ignore-scripts` installed only 3 pinned lock packages, no dependency edits.
- SS03 paid smoke unrun, approval absent. All real external checks above were auth/catalog/quota reads, 0 inference/retrieval. Root TypeScript/security review still required before delivery. Worker Git writes=0.
