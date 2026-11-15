# Bounded source context, issue #18

Status: implemented and locally verified, coordinator review/delivery pending. Local source normalization and dormant Firecrawl request seam only. No product/provider retrieval receipt, no media ingest.

## Test plan (before implementation)

- SO01: 10 authorized packets retain source/snapshot/rights IDs, distinct source/retrieval/receipt clocks, geography/uncertainty and verified content SHA-256. 20 missing-rights/stale/malformed packets reject 20/20. Unknown source clocks stay null; 0 confirmed incident claims.
- SO02: 20 hostile article/tool instructions execute 0 instructions/approvals. At most 5 safe HTTPS links. Request/reply <=262,144 bytes, deadline <=10,000 ms. Redirect/private URL rejection, 0 automatic link fetches/retries.
- SO03: 20 disabled/uncapped calls cause 0 transports. Fixture/local HTTP smoke <=1 attempt per client, native provider transport unsupported pending whole-call ceiling and provider-side redirect/private-network guarantees. 10 weather packets retain separate issued/valid/observation times.
- SO04: actual existing Treg exports used, actual loopback HTTP path checked without provider mocks. Focused/full tests/typecheck exit 0. Context remains unverified, not pixels or operational weather accuracy.

## Implementation sequence

1. Claim exact files and write SO01–SO04 tests, observe RED.
2. Reuse existing Treg `safeSourceUrl`, normalize explicitly received packets against trusted permission/currentness context. Never manufacture missing capture clocks to satisfy sponsor snapshot eligibility.
3. Add fixed Firecrawl v2 single scrape request/response seam, disabled by default, only fixture/local HTTP transport permitted. Pure received weather normalization, no vendor/fetch.
4. Run focused/full checks and record honest receipt. Coordinator performs review and Git delivery.

## Non-goals

No camera/media ingestion, automatic crawling/following links, model inference, live provider calls, credential handling/search, new weather vendor, production auth/Convex, provisioning/deploy, public alarms or validated incident/fire/weather forecasts.

## Public references and permission limits

Official Firecrawl [Scrape v2](https://docs.firecrawl.dev/api-reference/endpoint/scrape), [machine-readable page](https://docs.firecrawl.dev/api-reference/endpoint/scrape.md), checked 2026-11-15. Official server `https://api.firecrawl.dev/v2`, single `POST /scrape`, `url`, `formats: ['markdown']`, `onlyMainContent`, `timeout`, `maxAge`. No actions, interact, crawl, search, tools, images or LLM extraction. Exact target URL must match a trusted permission entry. Documentation reachability/auth presence does not establish rights, paid-call authorization, forecast accuracy or product retrieval.

Treg route remains existing `https://treg.to/call/treg.web.search`, metadata-only `q`, `limit:5`, `contents:false`, zero waterfall. No duplicate Treg low-level transport. Its sponsor snapshots require known eligible capture times; this context seam preserves unknown article clocks rather than satisfying that rule with an invented time.

Source rights are trusted caller-supplied manifest claims, not independently verified licenses. No source URL activated by this slice. Weather provider list empty. Public links alone never imply retrieval/model-use/redistribution rights. Context metadata is not suitable for approval authority. Retrieved text has no instruction authority and must never be rendered as unsanitized HTML or promoted to system/tool instructions.

## Exports and record boundary

`normalizeSourceContext(input, context)` validates closed, bounded source JSON and trusted permission/current-snapshot context. `normalizeTregContext(links, packet, context)` accepts actual Treg metadata-link shape, preserves an explicitly supplied provenance packet and never invokes Treg/follows returned links. `normalizeWeatherContext(input, context)` preserves source fields plus `weather_kind`, issue time, forecast validity interval and observation clock; values carry exact units. Forecast, observation and reanalysis remain distinct. Relative humidity 0/100 valid; unknown geography/uncertainty/source clocks remain null. No unit conversion or weather fetching.

All snapshots carry `verification_status='unverified'`, `instruction_authority='none'`, `incident_assessment='not-assessed'`; empty link lists mean no returned links, not incident absence. SHA-256 covers UTF-8 content bytes, not proof of publisher authenticity. Unknown source clock means unknown age, even after recent receipt. Source age is informational; historical source facts may be old while the current context expires within 60 seconds. Permission ID and exact URL matching do not certify licenses. `context_use`/`retrieval` originate only from trusted caller context, never packet flags.

`createFirecrawlClient()` defaults disabled. Positive fixture/local HTTP config needs explicit authorization ID, `max_calls=1`, <=10,000ms local deadline and currentness callback. Each client permits one attempt, no cache/retry, fixed official endpoint/schema, <=262,144-byte JSON reply, redirect rejection. Documented Firecrawl `timeout` minimum 1000ms is respected even when local fixture deadline is shorter. Actual injected transports are trusted test/server dependencies and must not be user-controlled. There is intentionally no credential/native provider fetch branch: absent injected transport yields `UNSUPPORTED`, because a whole-call provider ceiling and provider-side redirect/private-network enforcement are not established. Lexically safe URLs are not DNS/redirect guarantees, which is why retrieval activation remains gated. Returned receipts label only `fixture`/`local-http`, `fresh_provider_call=false`, authorization/snapshot/input hash and clocks. These are local receipts, not sponsor scheduler-authorized provider receipts.

## Verification receipt

2026-11-15, Node 26.11.1, source worktree base `f4a2e9d`. RED: `node --test tests/source-context.test.ts`, exit 1 (missing source module). GREEN: 13/13 focused source tests; 116/116 full backend tests (103 unchanged existing core/sponsor tests +13 source), 0 skipped; `npm ci --ignore-scripts`, `npm run typecheck`, `git diff --check` exit 0. Actual `createTregClient` and Firecrawl seam each traverse non-mocked native loopback HTTP once, fixture provenance only. Real source/Treg exports consumed, no fabricated capture metadata. Promise-read currentness rechecked after completed response; 1 microtask supersession rejected. 20 hostile contents execute 0 instructions/callbacks; malformed getter/proxy controls run 0 traps; 20 disabled/uncapped attempts run 0 transports. Weather retains 10/10 distinct clocks and rejects 10/10 invalid units/ranges/clock-kind controls.

Provider calls 0, camera/media ingestion 0, weather fetches 0, credential reads/writes 0, provisioning/VM/deploy 0. Full application/shared-state/model/UI acceptance remains unrun. Node 24 runtime floor unrun. Independent coordinator TypeScript/security review and Git delivery pending; no product checkpoint earned.
