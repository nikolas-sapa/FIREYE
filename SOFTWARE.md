# Software and integration status

Snapshot: 2026-11-15, main `0dc82518`, merged backend PRs #34/#35. [Front door](README.md) · [Current main receipt](TASKBOARD.md#current-main-backend-summary) · [Docs](docs/README.md)

TASKBOARD owns work/receipt status. Installed tools, signed-in accounts and reported credits are not product API receipts. No live-provider or deployed/shared-application acceptance claimed below.

| Component | Verified or reported state | Product boundary / source |
|---|---|---|
| Bounded backend | Main: protocol/state/replay, received-state HTTP bridge, toy planner, coordinator and callable demo. 242 native/compiled tests reviewed on Node26.11.1; hosted Node24/26 SUCCESS. Dev TypeScript5.9.3, `@types/node`24.10.1, runtime dependencies0. | One registered single-drone demo course, planner up to3 drones; no dynamic registry/calibrated physics. [Manifest](backend/package.json), [local checks](README.md#run-local-protocol-checks), [service](docs/demo/backend-service.md), [CI receipt](https://github.com/nikolas-sapa/fire-command-center/actions/runs/43674391602). |
| Frontend/simulator console | [PR #2](https://github.com/nikolas-sapa/fire-command-center/pull/2), draft/unmerged, current source `c2682d4` per coordinator. Historical isolated install/build/typecheck passed at `6bdb5884`, not current-head acceptance. | Marco-owned prototype; separately authorized #8/#9 work unchanged. Launch/adoption requires owner confirmation, current browser/shared-backend acceptance unverified. [TASKBOARD](TASKBOARD.md). |
| Convex | Historical eventual-authority direction, currently deferred/unimplemented. | No SDK, provisioning or Convex distributed/two-client transaction proof; bounded local authority is not a replacement decision. [Historical spec](docs/superpowers/specs/2026-11-14-backend-protocol-design.md), [official docs](https://docs.convex.dev/). |
| Treg | Dormant client/source seam implemented; prior scoped auth/account check, not refreshed here. Genuine retrieval0. | Tool registry/source retrieval, not model gateway or current identity/validity proof. [Source seam](docs/data/source-connectors.md), [official overview](https://treg.to/llms.txt). |
| Oumi / Iris | Dormant finite-ranking client/jobs implemented; prior organization/project receipt. Credentials missing within previously checked scope, setup unresolved. Genuine inference0. | Account/project presence is not inference access. [Setup](docs/architecture/provider-setup.md), [decision-model docs](https://docs.oumi.ai/guides/decision-models). |
| fal | Dormant client implemented; credits owner-reported, scoped credential missing in prior check, setup unresolved. Genuine inference0. | Thermal/task capability and API access unverified. [Official docs](https://fal.ai/docs/). |
| Google / Gemini / Gemma | Dormant clients plus Gemma queue/smoke setup implemented. Prior authenticated Gemini catalog included Gemma; not current validity/quota/inference proof. Genuine inference0. | Default disabled; live hard-ceiling restrictions unchanged, no local/on-device Gemma claim. [Gemma setup](docs/architecture/gemma4-setup.md), [official API docs](https://ai.google.dev/gemini-api/docs/). |
| Firecrawl / weather | Dormant retrieval schema/context seam; native Firecrawl route unsupported. Explicit validated weather packets only, no fetch. Prior CLI auth/quota checked, not refreshed here. | Genuine retrieval/weather fetch0, no media ingestion or calibrated forecast. [Source seam](docs/data/source-connectors.md), [official docs](https://docs.firecrawl.dev/). |
| Provider preflight | Dry sanitized setup/activation report and explicit account/catalog-check opt-in implemented. Default active/genuine_calls/read_only_attempts0. | No automatic key discovery or spending authority. [Preflight](docs/architecture/provider-activation.md). |
| Boxd | Dormant finite local jobs; remote execution unsupported. Prior scoped auth and existing hibernated VM receipt, no VM started/created by backend. | Remote execution0; auth/VM presence is not wake/provision permission. [Sandbox setup](docs/architecture/sandbox-setup.md), [official docs](https://docs.boxd.sh/). |
| Camera/satellite sources | Research candidates only, not installed or ingested. | Separate transport code, media rights and sensing claims. [Pinned resource catalog](docs/data/camera-satellite-resources.md). |

## Reading the boundaries

Native/compiled tests exercise real exports, loopback HTTP clients and disposable CLI fixtures, not field observations or verified human identity. Local compare-and-commit does not prove Convex atomicity. Frontend launch/adoption awaits explicit owner confirmation; media, Convex and production auth remain deferred. No deployment receipt exists.

Versions above come from current tracked package metadata. Unpinned external tools/providers have no guessed version here. No root application manifest or environment-variable names invented. Private logins, keys, balances and auth-storage paths stay outside repository docs.

Live provider calls, source ingestion, VMs and deployment require separate scope/permission/budget approval and genuine receipts. Future thermal support must preserve source modality, radiometric/calibration status and uncertainty; no false-color-to-temperature claim.
