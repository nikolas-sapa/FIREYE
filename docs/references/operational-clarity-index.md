# Operational clarity: reference index

[Exact supplied reports](operational-clarity-supplied.md). Archived 2026-11-14. Two essays, 151,481 UTF-16 code units / 152,092 UTF-8 bytes of supplied body. Preservation does not endorse the report's claims or make its imperatives requirements.

## Evidence labels and coverage

- **Fact:** retrieved official documentation or publisher/registry text supports the narrowly stated claim. Vendor capability claims remain vendor claims, not independent field validation.
- **Interpretation:** possible Fire Command Center design transfer, subject to owner approval and tests.
- **Unchecked:** not established by this bounded pass, even if the supplied report calls it “DOCUMENTED FACT”.

Coverage: 2 essays archived; 179 `http(s)://` occurrences in the original body, counted with `/https?:\/\/[^\s]+/g`. Many URLs run directly into descriptions or access dates, so this is **not a count of clean or verified links**. Nine unique official/registry resources were successfully retrieved for this bounded pass: Blueprint core package metadata, npm latest metadata and license; Palantir Map styling and tracks; Anduril C2, Mission Autonomy, entities and the dated public-safety article. An additional attempted `/map/tracks/` path resolved to Palantir's 404 page and is not a reference. Video IDs/timestamps, imagery, blog/book citations and the full catalog were not audited. No media copied, dependencies installed or paid/inference calls made.

## Five starting links

| Resource | Fact from this check | Interpretation for this project |
|---|---|---|
| [Blueprint core package](https://github.com/palantir/blueprint/blob/develop/packages/core/package.json) | Official source and [npm latest](https://registry.npmjs.org/@blueprintjs/core/latest) both report `6.23.0` on 2026-11-14. Source declares Apache-2.0; [LICENSE](https://github.com/palantir/blueprint/blob/develop/LICENSE) checked. | Study compact controls and density. Do not install Blueprint or adopt its font/colors without a separate dependency/design decision. |
| [Palantir Map: tracks](https://www.palantir.com/docs/foundry/map/visualize-tracks/) | Distinguishes linear interpolation from “last known”; maximum time gaps mean missing data and unconnected track lines. Breadcrumbs represent recorded positions and appear on the timeline. [Map styling](https://www.palantir.com/docs/foundry/map/visualize-objects/) exposes time-based fading. | Distinguish observed, interpolated, stale and unknown state. A gap is not proof an asset stopped or disappeared. |
| [Anduril Mission Autonomy](https://www.anduril.com/lattice/mission-autonomy) | Official page describes coordinated autonomous systems and a single-human-operator capability. This is a vendor product claim. | Adapt goal/task orientation to a **small human crew**, not a mandatory single-operator workflow. |
| [Anduril entities overview](https://developer.anduril.com/guides/entities/overview) | Documents composable, possibly incomplete entities, lifecycle events and source-update provenance. It documents expiry, `noExpiry`, and a five-minute republishing condition on service restart. | Preserve partial state and freshness explicitly. These vendor lifecycle rules do not define incident/evidence retention in our prototype. |
| [Anduril public-safety article, 2023-07-31](https://www.anduril.com/news/anduril-s-lattice-a-trusted-dual-use-commercial-and-military-platform-for-public-safety-security) | Vendor describes wildfire-detection applicability, XPRIZE participation and search/rescue task planning/resource assignments. | Useful civilian-domain context. Not proof of wildfire deployment, validated response performance or a September 2026 XPRIZE win. |

Additional checked context: [Anduril C2](https://www.anduril.com/lattice/command-and-control) describes battle-management integration. Its marketing page and text extraction do not prove production UI CSS, exact pane sizes, camera layout or classified deployment behavior.

## Corrections and unchecked claims

- **Fact, version correction:** The catalog calls the live Blueprint gallery v5; the second essay calls current core v6.22.0. Retrieved repo/npm current metadata is **6.23.0**. Version-specific screenshots/tokens need a pinned version before reuse.
- **Fact, bounded lifecycle support:** Anduril entity docs support expiry and restart wording, including the `noExpiry` exception. **Interpretation, rejected transfer:** automatic deletion of unresolved human-life alerts is not a safe/default Fire Command Center requirement. Fade stale reports, retain uncertainty and unresolved status; retention policy needs approval.
- **Unchecked:** “both reject light mode”, identical classified/unclassified frontends, universal mandatory HITL approval, immutable logs for every action, exact fonts/pane widths, all video IDs/timestamps and >10:1 contrast. Public marketing visuals do not establish these universal or implementation-specific claims.
- **Unchecked:** Anduril winning the XPRIZE Wildfire Autonomous Response track in September 2026. The checked 2023 article states participation, not that result. No competition-result source was checked.
- **Unchecked:** a universal rule that every data pixel maps to an executable action, all claimed time thresholds, and precise field/deployment/safety outcomes. Source assertions are not implementation tests.

## Candidate transfers, not an approved build

1. **Shared work, local views:** small human crew shares incident, evidence, task and event state. Each member keeps local navigation; one explicit approval owner per simulated action.
2. **Two pages remain:** Map plus Camera Room, as requested. Co-locate selected-camera preview on Map for context, without banning the dedicated camera page. No vendor layout or pane width mandated.
3. **Observation is not world truth:** keep source, observation/retrieval time, geography, uncertainty and contradictions. Label live, recorded/replay and synthetic material visibly; missing/stale evidence must not look current.
4. **Honest action state:** distinguish proposed, approved, actually sent, delivered, accepted and completed/failed. A delivery ACK does not prove task acceptance or completion. Fire-chief review applies to **exercise actions**, never field orders or real drone control.
5. **Readable incident focus:** restrained density, spatial/evidence context, freshness badges, task review and debrief/event history. No weapons targeting, kill-chain symbology or military identification claims.

## Resident rules take precedence

[Repository rules](../../AGENTS.md) and [brief/non-goals](../../README.md) remain authoritative: **Geist Sans**, accent **#006bff**, **no orange**, **no emoji**. The supplied native/Roboto stacks, Blueprint blues and tangerine recommendations are reference content only. No application source, manifests, dependencies, schema or CI added. Blueprint licensing does not grant reuse permission for company screenshots, logos or videos; selected reused code/assets still need source/commit/license/notices/attribution records and approval.

Application implementation remains **not started**; design, scope, simulator/runtime and numeric test-plan approval remain gated. Archiving these reports does not open that gate.
