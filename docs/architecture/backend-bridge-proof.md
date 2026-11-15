# Bounded backend bridge proof

2026-11-15. Base `4748ee8`, branch `task/backend-bridge-v1`. Local in-memory EXERCISE diagnostic, not console/Convex/production-auth acceptance. Latest owner direction defers Convex and login/signup; fixture role capabilities remain wiring checks, not an authentication product. No deployment, provisioning or sponsor/provider calls.

## Actual receipts

macOS27.0.1 build26A434, Node26.11.1, npm/native tests, TypeScript5.9.3. Node24 floor untested. Tests have no viewport or browser acceptance. Deterministic `seed()` fixture, incident i1/run r1, configured sim_tick1 for HTTP harness.

| Command | Actual result |
|---|---|
| npm ci --ignore-scripts | exit0,3 existing dev packages,0 reported vulnerabilities; no package/lock edit |
| node --test tests/integration-session.test.ts tests/received-view.test.ts tests/integration-http.test.ts (before modules) | RED exit1,3 missing-module failures,0 successful suites |
| node --test tests/integration-session.test.ts tests/received-view.test.ts | GREEN11/11,0 failures |
| node --test tests/integration-http.test.ts | GREEN8/8 before2 additional TTL/shutdown tests,0 failures |
| npm test (final source) | GREEN92/92:71 original +21 bridge,0 fail/skip/cancel,6183.04525ms |
| npm run typecheck | exit0 |
| git diff --check | exit0 |
| real TypeScript dist/native import check | exit0,TypeScript5.9.3 +node:http createServer present |

B01 uses two independent native HTTP Agent clients on actual127.0.0.1 sockets,20 commits/20 matching revision+record rounds. Ten local selections produce0 writes. B02 runs20 trials,each20 simultaneous real HTTP approval requests:1 winner,19 conflicts,1 command;10 winning retries/trial produce0 additional revisions. B03 rejects100 invalid wire events plus20 missing/expired/wrong-role approvals,0 commits. Exact Host uses native request (fetch ignores supplied Host in this runtime). Missing/wrong Origin,oversized declared/chunked requests,60-attempt bound and malformed polling queries reject. Fixture expiry during poll returns401,>30min startup rejects.

B04:24 obsolete proposals produce0 executable outputs;10 telemetry/frame interleaves produce10 current acceptance rejects and0 fabricated acceptance. B05:10 rejoin reads preserve latest revision; real no-heartbeat timer produces canonical freeze after5036.976417ms in final full suite (within6s),10 old producer command reads reject; one shutdown poll stopped within1s. Poll suite:16 pending,17th429. No takeover endpoint or automatic producer restart.

B06:20 successive frame snapshots preserve IDs/source flags/acquisition and receipt clocks,including10 unknown clocks/geography;10 duplicate frames add0 revisions. DTO mirrors core latest-per-feed state,not20 simultaneous stored media objects. Ten critical unverified hypotheses survive historical aging,unknown geography/score staysnull. Two cutoffs hide future proposal/current stale options,corrupt future suffix rejects. Full canonical log/seed/actor/session/trace never serialized to crew.

B07:actual fixture driver creates proposal p1,Chief approval a1,producer reads command:a1,then emits factual sent/delivered receipts. Current command check returns delivered intent only. Driver emits accepted receipt,then frame1. Both snapshots equal at revision6,command remains accepted,0 completed status. Observation interleave then invalidates check. No model,media decoder,Marco Runtime or sponsor call involved.

## Boundaries and review handoff

Existing core/protocol exports unchanged. Authority compare-and-commit synchronous. Rate/size/poll/revision controls deliberately local; revision1000 reserved for canonical freeze after999 ordinary commits. No genuine identity proof,network durability,distributed race guarantee,thermal pixel proof or operational safety claim. Heartbeat uses configured server UTC,not body-supplied timestamps.

Read seam: `createReceivedView(state,cutoff)`. Mutation seam: `createBridgeAuthority(seed,clock)`, methods ingest/approve/pending/check/heartbeat/expireProducer. Transport seam: `startLocalBridge(authority,options)`, no default launcher. Explicit contract: [backend-bridge.v1](../contracts/backend-bridge.v1.md).

Frontend producer/executor and crew-consumption changes remain teammate-owned,unimplemented here. Coordinate frame/origin/units/altitude datum must be reviewed before Geo mapping; unknowns staynull. Strict current input_revision equality preserved. Sponsor orchestration,Convex,login/signup,deployment deferred or separately scoped. Independent TypeScript/security review and root verification pending at worker freeze. Worker performed0 stage/commit/push operations.
