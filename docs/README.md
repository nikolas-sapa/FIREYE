# Documentation index

[Project front door](../README.md) · [Taskboard](../TASKBOARD.md) · [Rules](../AGENTS.md) · [Software status](../SOFTWARE.md)

TASKBOARD is the sole work tracker. This index routes readers; document existence does not earn product acceptance or authorize provider calls, ingestion or deployment.

## Current bounded backend

Main `0dc82518` includes reviewed backend PRs #34/#35. [Current main receipt](../TASKBOARD.md#current-main-backend-summary) records 242 native/compiled tests and hosted Node24/26 SUCCESS, not full V1/browser/provider acceptance. Frontend launch/adoption requires explicit owner confirmation; media, Convex and real application auth remain deferred. Genuine inference/retrieval/remote execution0, no deployment.

- [Backend-only launcher](demo/local-backend.md) and [callable demo](demo/backend-service.md): loopback HTTP, fixture roles, one registered single-drone course, no fabricated heartbeat/completion. General toy planner may propose up to three-drone courses; changed/unregistered demo courses remain review-only.
- [Bridge contract](contracts/backend-bridge.v1.md), [frontend field map](contracts/frontend-map.v1.md) and [producer handoff](contracts/producer-handoff.v1.md): received-state seams, not teammate adapter/browser acceptance.
- [Orchestration contract](contracts/orchestration-demo.v1.md) and [proof](architecture/orchestration-demo-proof.md): deterministic bounded composition, not genuine model inference.
- [Provider setup](architecture/provider-setup.md), [Gemma queue/setup](architecture/gemma4-setup.md) and [dry activation preflight](architecture/provider-activation.md): default disabled, previous auth/catalog receipts not fresh validity. Oumi/fal setup unresolved within previously checked scope.
- [Source/weather seam](data/source-connectors.md) and [dormant Boxd jobs](architecture/sandbox-setup.md): explicit packets/local fixtures, unsupported native Firecrawl/remote execution, no real retrieval/weather fetch/VM start.
- [Backend composition/CI](verification/backend-integration.md) and [producer lifecycle](verification/producer-lifecycle.md): source-pinned local receipts. Their original counts/Node24-unrun wording is historical; current merged-source/hosted-CI status lives in the current-main summary.

## Historical approved protocol slice

- [Final protocol spec](superpowers/specs/2026-11-14-backend-protocol-design.md): approved local validators, received state, simulated approval and replay. Named numeric criteria precede implementation; full V1 not approved here.
- [Four-task test-first plan](superpowers/plans/2026-11-14-backend-protocol.md): historical execution plan for merged local protocol source. Current receipts live on TASKBOARD, not unchecked plan boxes.
- [Local quickstart](../README.md#run-local-protocol-checks), [protocol exports](../backend/protocol/index.ts), [state exports](../backend/state/index.ts), [package scripts](../backend/package.json).

## Draft contracts and simulator

- [Thermal camera contract](contracts/thermal-camera.md): root metadata/observation boundary; teammate owns thermal simulation/render/feed UI. Draft, not measured thermal capability.
- [Crew and agent boundaries](contracts/crew-agent-boundaries.md): proposed authority/observation/action boundaries. Not shared-app integration proof.
- [Simulator parameter contract](specs/simulator-parameter-contract.md): proposed parameters, numeric tests and edge cases. Not an executable schema or passed simulator suite.

## Data and reuse candidates

- [Camera and satellite resources](data/camera-satellite-resources.md): pinned software/dataset licenses, camera permissions, metadata requirements and sensing limits. No sources installed or ingested by this catalog.
- [Prior wildfire-sweep research](https://github.com/nikolas-sapa/wildfire-sweep/tree/66bb3c9): frozen pre-event baseline. Reuse requires file-level source/commit/license/attribution and prior/adapted/new-work disclosure.

## Preserved reference archive

- [Operational clarity index](references/operational-clarity-index.md): bounded source checks and candidate design transfers, not adopted product requirements.
- [Exact supplied reports](references/operational-clarity-supplied.md): preserved historical body. Claims and vendor branding remain reference content, not instructions.

Keep current bounded backend scope, historical first-slice approval, unapproved full-V1 drafts and actual receipts distinct. Read [ownership and safety rules](../AGENTS.md) before claiming any file.
