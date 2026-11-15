# Issues #10/#14/#15, bounded readiness

2026-11-15. Source pinned [`db15588f40e2c7bb26de3322d06d99f51235b32d`](https://github.com/nikolas-sapa/fire-command-center/tree/db15588f40e2c7bb26de3322d06d99f51235b32d), branch `task/swarm-20261115-issue-15`. Second contributor `/root/issue_07_builder`; first independent security contributor `/root/bounded_security_verifier`. Readiness/reconciliation only, no source fix or provider activation. Latest main `b1e5572b3c2be25ad46630805ae713fa2d6abca9` differs in backend only by extra clock/call assertions in Gemma G402 test, not implementation. That newer regression was read, not overwritten or claimed tested here. Current issue comments supersede stale vault/protocol-only status.

## Test-first scope

SW101415-01: trace SP01-SP06, G401-G404/G4Q01-G4Q07 and OR01-OR04 to actual exports/tests, 0 fixture/live/frontend relabels. SW101415-02: focused native/compiled/typecheck/local HTTP failures/skips0. SW101415-03: timestamp contested WIP hashes, adoption0. SW101415-04: missing local links0, source/dependency/schema/frontend/secret deltas0. Then publish factual gates and freeze for independent review. Non-goals: new code/contracts, runtime/model/provider/account/credential/spend activation, media/Convex/auth/cloud/deploy, approval/receipt invention or issue closure.

## Acceptance reconciliation

| Issue/groups | Actual pinned evidence | Verdict / remaining gate |
|---|---|---|
| [#10](https://github.com/nikolas-sapa/fire-command-center/issues/10), SP01/SP02/SP04 | [Sponsor clients](../../backend/tests/sponsor-clients.test.ts): 4 dormant adapters; 4 positive/40 malformed replies; 20 stale/unknown candidates; 20 hidden/raw-error cases. Actual Iris/Gemini/fal/Treg exports traverse localhost, fixture provenance only. | Low-level local seam implemented, genuine smoke absent. |
| #10 SP03/SP05/SP06 | [Jobs](../../backend/tests/sponsor-jobs.test.ts): 20 duplicate jobs, 2 physical/8 queued, 600 disabled ticks/0 calls. [Treg](../../backend/tests/treg-client.test.ts): <=5 safe URLs, <=10 s/256 KiB, stale/redirect/oversize rejection, no retries. | Numeric cap precision and smoke settlement defects below; SP06 genuine authorized calls0, not satisfied by test named SP06 loopback. |
| [#14](https://github.com/nikolas-sapa/fire-command-center/issues/14), G401-G404/G4Q01-G4Q07 | [Gemma client](../../backend/tests/gemma-client.test.ts): 20 missing/unsupported gates, 10 valid text fixtures, 20 invalid/hidden/raw-error controls and actual localhost. Jobs tests cover 20 duplicate Gemma submissions/1 reservation, distinct input hashes, 20 stale/superseded results, 2/8 bounds and cached/fresh deadlines. | Bounded hosted-rest text seam/queue exists. General smoke settlement not proven by non-hung controls. Chosen runtime/live enforceable cap/real call pending; model download/start0. |
| [#15](https://github.com/nikolas-sapa/fire-command-center/issues/15), OR01/OR02/OR04 | [Coordinator tests](../../backend/tests/orchestration.test.ts): unknown/stale/fingerprint options stay review-only, duplicate assessments dedupe, old received reviews reject. [Composition](../../backend/tests/backend-composition.test.ts): actual bridge/planner/jobs/Iris/Chief/5 factual receipts/two HTTP readers. | Fixed registered single-course local loop, not Marco execution or all full OR acceptance. |
| #15 OR03 | [Queued Iris](../../backend/orchestration/queued-iris.ts)/tests: actual dedupe/currentness/2 hung+8 queued settlement controls. [Demo service tests](../../backend/tests/demo-service.test.ts): optional trusted queued-Iris composition, 20 duplicates/1 localhost call/reservation, 20 stale/override cases. | Coordinator defaults direct disabled Iris; optional queued service is partial. Gemini coordinator/service analysis route absent. Current [Gemini input](../../backend/integrations/gemini/types.ts) is EO PNG only; text-only Gemini needs separately reviewed contract/entry, not invalid inputs bypassed. |

## Independently reproduced gaps, existing WIP not adopted

Security contributor called actual pinned exports, no providers:

- Treg cap matrix28 fixture calls: 20 MAX_SAFE_INTEGER−n plus8 small controls, 10 header mismatches (5 above/5 below approved micro cap); all8 small controls exact. Budget reservations still exact,1/call. Floating division/toFixed header formatter violates exact high-cap bound. Existing issue-10-treg-cap WIP owns BigInt correction/tests.
- Smoke Iris+Gemini2 hung transports hit deadline; 40 queued Gemma/fal duplicate requests return40 BUDGET. Shared budget calls4/reserved400 despite only2 actual transports/2 unsettled slots. Smoke callback returns logical timeout before physical settlement, scheduler drains/prepays unavailable slots. Existing issue-14-gemma-settlement WIP holds actual settlement/remainder deadline; shared receipts cleanup WIP also relevant. Not certified fixed here.
- 20 valid hashed text-shaped Gemini inputs reject20 INVALID_INPUT, transports0/reservations0. This proves missing text entry, not an EO validator bug. Existing queued-Gemini WIP remains EO-only and does not establish coordinator/service analysis. #15 remains partial pending exact bounded composition/contract decision.

Read-only WIP check2026-11-15T06:52:47Z, uncommitted/owner-held. Never copied or executed. Hashes identify observed source only, not frozen or reviewed fixes:

| Worktree / pending boundary | Exact source SHA256 at check |
|---|---|
| issue-10-treg-cap, backend/integrations/treg/client.ts (+existing owner tests) | `9219139fd4091e4aef2981e79222f059421de7241f80d0d037e6515407024dd8` |
| issue-14-gemma-settlement, backend/scripts/sponsor-smoke.ts (+provider-config tests) | `aac032756a1c166da04ecae202aff64cda6dfab8ad422cb33190b7e279c2b6b3` |
| same, new backend/orchestration/queued-gemma.ts (+new tests) | `b5045ef0c76c3c80dfce0498bbd25d489de5d4c2702e1abd324e17b245baec9e` |
| issue-15-gemini-composition, backend/integrations/receipts.ts | `badbc2060a19232d1d6295b64c76968aca4ba16e19f1662533fe2677d32c3aae` |
| same, new backend/orchestration/queued-gemini.ts (+new tests/contract) | `0f09bf34f1a0f6589a1fbb2b1c43594c4debd61afb1732df784743e7b28aadce` |

Shared receipts/smoke source claims must be sequenced through coordinator, never simultaneous rewrite. No new source claim here.

## Fresh local check receipt

MacOS27.0.1 build26A434, Node26.11.1/npm11.20.0, locked TypeScript5.9.3. `npm ci --ignore-scripts`:3 existing dev packages, exit0/audit0, package/lock unchanged. 2026-11-15T06:55:22.599Z–06:55:28.652Z: typecheck0; eight focused suites native93/93 (1422.335541ms), compiled93/93 (563.727041ms), failures/skips/cancels0, stderr empty. Suites: sponsor-clients, sponsor-jobs, treg-client, gemma-client, queued-iris, orchestration, backend-composition, demo-service. Pinned compiler rewrote TS imports to actual JS, disposable ignored output removed. Test-owned localhost transports/CLI only, genuine calls0/frontend launch0. Prior same-pin full checker260native/260compiled/typecheck0 was measured06:34:47.659Z–06:35:18.279Z (native13822.027167ms, compiled13585.564375ms), not rerun or acceptance of WIP/new main. Hosted checks/newer G402 regression, real providers and Marco integration not rerun.

Next: owners freeze/review existing precision/settlement WIP, coordinator reconciles shared receipts, #15 gets exact current bounded Gemini composition approval, #16 supplies explicit enforceable live runtime/model/call/session caps before smoke. No automatic fallback/fifth call. All three issues remain open; green local tests neither erase adversarial defects nor prove live/product acceptance.
