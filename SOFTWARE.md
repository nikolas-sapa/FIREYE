# Software and integration status

Snapshot: 2026-11-15. [Front door](README.md) · [Taskboard](TASKBOARD.md) · [Docs](docs/README.md)

TASKBOARD owns work/receipt status. Installed tools, signed-in accounts and reported credits are not product API receipts. No live-provider or deployed/shared-application acceptance claimed below.

| Component | Verified or reported state | Product boundary / source |
|---|---|---|
| Backend protocol | Merged into main, 71 local tests passing; Node ≥24 declared, tested on 26.11.1. Dev TypeScript 5.9.3, `@types/node` 24.10.1; 0 runtime dependencies. | Pure validators/reducer/approval/replay, not a server. [Manifest](backend/package.json), [lock](backend/package-lock.json), [exports](backend/state/index.ts), [local checks](README.md#run-local-protocol-checks). |
| Frontend/simulator console | Submitted in [PR #2](https://github.com/nikolas-sapa/fire-command-center/pull/2), draft/unmerged. Isolated install/build/typecheck passed at pinned source `6bdb5884`. | Teammate-owned prototype, not adopted, browser-verified or shared backend integration. Exact source/receipt on [TASKBOARD](TASKBOARD.md). |
| Convex | Approved eventual canonical authority, unimplemented. | No SDK, provisioning or distributed/two-client transaction proof. [Bounded spec](docs/superpowers/specs/2026-11-14-backend-protocol-design.md), [official docs](https://docs.convex.dev/). |
| Treg | Locally installed and scoped authentication verified. Product retrieval adapter remains DRAFT, not implemented or called. | Tool registry/source retrieval, not a general model gateway. [Official overview](https://treg.to/llms.txt), [integration docs](https://treg.to/integrate.md). |
| Oumi / Iris | Club Oumi organization and existing project verified; API key setup and genuine Iris call pending. | Account/project presence is not inference access. [Decision-model docs](https://docs.oumi.ai/guides/decision-models). |
| fal | Credits ready per owner report; product API unverified. | Analysis route selection and thermal capability need genuine authorized receipts. [Official docs](https://fal.ai/docs/). |
| Google / Gemini | Project, key and authorized access unconfirmed. | No product call or model capability asserted. [Official API docs](https://ai.google.dev/gemini-api/docs/). |
| Firecrawl | Planned news/article retrieval; no connector confirmed. | No product retrieval/ingestion receipt. [Official docs](https://docs.firecrawl.dev/). |
| Boxd | Local scoped authentication verified; 0 VMs created. | No product compute/provisioning receipt. [Official docs](https://docs.boxd.sh/). |
| Camera/satellite sources | Research candidates only, not installed or ingested. | Separate transport code, media rights and sensing claims. [Pinned resource catalog](docs/data/camera-satellite-resources.md). |

## Reading the boundaries

Local protocol tests exercise real public package exports with fixtures, not field observations or actual auth. Local compare-and-commit does not prove distributed atomicity. PR submission does not establish adoption or deployment.

Versions above come from current tracked package metadata. Unpinned external tools/providers have no guessed version here. No root application manifest or environment-variable names invented. Private logins, keys, balances and auth-storage paths stay outside repository docs.

Live provider calls, source ingestion, VMs and deployment require separate scope/permission/budget approval and genuine receipts. Future thermal support must preserve source modality, radiometric/calibration status and uncertainty; no false-color-to-temperature claim.
