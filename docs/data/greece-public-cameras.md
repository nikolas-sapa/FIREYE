# Greece public camera sources, research only

Issue [#23](https://github.com/nikolas-sapa/fire-command-center/issues/23), claim `ISSUE23-GC`. Source baseline `db15588f40e2c7bb26de3322d06d99f51235b32d`. No source activated. This document and [machine-readable catalog](greece-camera-catalog.json) are research artifacts, not an ingestion allowlist.

## Preserved research delivery, issue #23

Delivery claim `BATCH-20261115-23`, assigned base `b1e5572`. Restored offline from the previously reviewed research artifacts, not newly checked sources. Original research baseline, preparation time, all 15 records and 18 response receipts remain unchanged. Original SHA-256 pins: Markdown `27c1cda1f4fe24d7d433fde85e53be9cfcacab80474792cc04207eeb35f177ff`, JSON `2c41c6a46612a685f39173f3f613c56a8d72c2a869e867941325b3f3ac5b0e1f`. Those pins identify the preserved inputs, not these delivery-edited artifacts or historical response-body authenticity.

Delivery tests, before restoration: **GC23-01**, exactly 15 ordered unique IDs, schema/required fields/counts/references valid, 0 missing local links. **GC23-02**, original entries/evidence/clocks/rights unchanged, ingestion-eligible 0, playback proofs 0, original GC03 Skyline automation-terms caveat retained. **GC23-03**, independent documentation-only source/rights reader review before coordinator PR, 0 new external/source/media/provider requests.

Delivery implementation: restore via apply_patch, add provenance/current boundary links only, validate locally and freeze both hashes for independent reader and coordinator delivery. Non-goals: new research or rights conclusions, source/media activation, runtime/frontend/dependency changes, TASKBOARD edits, Git actions, deployment or issue closure.

Current boundaries: [repository evidence/camera rules](../../README.md#evidence-inputs-and-source-age), [camera/satellite resource candidates](camera-satellite-resources.md), [bounded source context](source-connectors.md), [thermal contract](../contracts/thermal-camera.md), [batch ownership/test plan](../../TASKBOARD.md#batch-20261115-23-independent-scoped-continuation). Existing dormant source/backend seams do not authorize this catalog, media ingestion or model use. The research plan, operation counts, routing notes and receipts below describe the original research run, not operations performed during offline delivery. Independent review of these restored hashes remains required; prior review is not a new use-permission or operator-terms certification.

## Test plan, before findings

| Test | Numeric acceptance |
|---|---|
| GC01 | Inspect at least 10 official public catalog/operator candidates. Every retained JSON entry has official URL/operator, geography and uncertainty, published access/API schema or explicit unknown, reuse status and UTC check time. Missing rights never become permission. |
| GC02 | Every claimed playable/live entry has at least 1 permitted actual playback/API response with check time, stream type and currentness evidence. Embed/iframe presence alone proves 0 playback. No unverified entry described as live. |
| GC03 | 0 private/unauthorized endpoints, auth bypasses, host/stream enumeration, credentials, recordings/media downloads, provider spend or source activation. 0 webcam-to-thermal/radiometric/incident-detection claims. |
| GC04 | At least 1 known-positive official public catalog/API control or explicit factual failure. Compare publication, capture and check clocks on 100% of retained entries; unknown clocks and geography remain unknown. |

## Non-goals

No camera activation, media ingestion, player launch, continuous monitoring, recording, identity inference, private CCTV investigation, guessed streams, accounts/credentials, provider calls, spending, package changes, frontend/runtime changes, operational incident claims, deployments or Git delivery. No imports from prior `wildfire-sweep`. A public webpage or software license does not grant footage reuse, embedding, automated sampling, retention or model use.

## Bounded research plan

1. Read official/operator catalog pages and linked rights/API documentation. Use search only to discover published URLs, never hosts or streams.
2. Inspect at least 10 candidates using public metadata reads. Separate catalog accessibility from media availability; perform playback checks only if clearly permitted within scope.
3. Preserve factual publisher/capture/check clocks, modality, geography uncertainty and rights. Keep unresolved candidates inactive.
4. Validate both artifacts against GC01–GC04. Freeze for coordinator source/rights review. No issue closure or runtime authorization claimed.

## Findings

Checked 2026-11-15 UTC. Retained **15 candidates: 12 named cameras, 3 catalog/API candidates, 10 distinct candidate page URLs**. Eligible for ingestion **0/15**, verified playable/live **0/15**, camera API/media requests **0**, playback attempts/proofs **0/0**. Two actual official HTML catalog controls succeeded; one official API-documentation control succeeded, not an API response. All 15 rows preserve unknown capture/publication times. This is a bounded shortlist, not an exhaustive Greece camera inventory.

## Candidate map

Rows below have available source metadata, not verified media. IDs map exactly to JSON. NOA rows identify the official catalog publisher, not a proven individual camera operator. No inferred owner, GPS point, stream or capture time.

| JSON ID | Official source / geography | Published access evidence | Rights and currentness |
|---|---|---|---|
| GR-NOA-KARYSTOS | [NOA Central Greece catalog](https://www.meteo.gr/webcameras.cfm?ProvinceID=5), Karystos, Evia | Named entry, published HTTP JPEG pointer, not fetched | Individual owner unresolved, no reuse clearance; capture unknown |
| GR-NOA-PAXIMADA | Same official catalog, Paximada Karystou, Evia | Separate named entry/HTTP JPEG pointer, not fetched | Same unresolved owner-rights boundary |
| GR-NOA-OREOI | Same official catalog, Oreoi, North Evia | Separate entry/HTTPS JPEG pointer, not fetched | Same boundary; North Evia label not calibrated footprint |
| GR-NOA-PENTELI-DOME | [NOA Attica catalog](https://www.meteo.gr/webcameras.cfm?ProvinceID=12), Penteli dome | Distinct published JPEG pointer, not fetched | Owner unresolved; dome label not sensor/calibration proof |
| GR-NOA-PENTELI-ATHENS | Same official catalog, Penteli toward SW Athens | Separate JPEG pointer; approximate viewing label | No media rights/current capture/field-of-view proof |
| GR-NOA-PENTELI-PARNITHA | Same official catalog, Penteli toward Parnitha | Separate JPEG pointer; approximate viewing label | No wildfire coverage or detection inferred |
| GR-NOA-NOESIS | [NOA Macedonia catalog](https://www.meteo.gr/webcameras.cfm?ProvinceID=2), Thessaloniki Noesis | Actual catalog 200, named entry/JPEG pointer | Positive metadata control only, individual owner unresolved |
| GR-KOS-PORT-1 | [Municipality of Kos](https://kos.gov.gr/en/kos-live-streaming/), main port | Port 1 heading and YouTube iframe pointer, player not opened | No substantive media grant found; capture unknown |
| GR-KOS-PORT-2 | Same official municipal page, main port | Second location-selector item only | No distinct second stream verified; never duplicate Port 1 iframe |
| GR-KALAVRITA-CATALOG | [Kalavrita Ski Resort](https://kalavritaski.gr/en/live-cameras/), Helmos, Achaea | Weather/camera tabs, chalet/park labels, lazy player placeholder | All-rights-reserved notice, no retained-media grant; April weather text not November capture |
| GR-METEOCAM-MARMARI | [MeteoCam/Cybex](https://www.meteocam.gr/eviamarmari), Marmari harbor, Evia | Official camera description and published map parameters | Map pin not georegistration; informational notice not media license |
| GR-METEOCAM-SCHINIAS | [MeteoCam/Cybex](https://www.meteocam.gr/schiniasfirecam), Schinias, Attica | Camera name, map parameters and historical weather context | “Fire Cam” name and July 2018 history prove no present incident or thermal capability |
| GR-WINDY-API | [Windy Webcams v3 documentation](https://api.windy.com/webcams/docs), Greece-capable country filter | Published OpenAPI schema, key required, API not called | Conditional API contract, no Greek coverage/retained-media/model-use clearance |
| GR-WEBCAMERAS-CATALOG | [webcameras.gr / mykosmos.gr](https://www.webcameras.gr/?lang=en), Greece-wide catalog | Public catalog/classification labels only | Individual owners retain rights; no blanket reuse license or playback verification |
| GR-SKYLINE-ACROPOLIS | [SkylineWebcams](https://www.skylinewebcams.com/en/webcam/ellada/atiki/athina/acropolis.html), Grand Bretagne view of Athens Acropolis | Initial public page metadata only, no player or streams | Fresh terms restrict extraction/retention; not eligible |

## Rights, separate from visibility

NOA's [official About page](https://www.meteo.gr/about-meteo.cfm) identifies the National Observatory of Athens publisher. Its camera-catalog footer assigns camera rights to individual owners and excludes intended processing of people/plates/personal data. [NOA terms](https://www.meteo.gr/terms.cfm) require consent and source attribution for reproducing site information. Camera-owner permission remains separate and unresolved; existing public JPEG links authorize nothing in this application.

[webcameras.gr](https://www.webcameras.gr/?lang=en) likewise disclaims camera ownership and says it maintains no image/video/timelapse archive. That statement describes its practice, not permission for our retention. [Kos English terms](https://kos.gov.gr/en/terms-of-use/) returned a title/shell and rights-reserved footer but no substantive footage reuse grant. Public municipal status is not a public-domain license. [Kalavrita's camera page](https://kalavritaski.gr/en/live-cameras/) reserves rights; e-shop/facilities links were not treated as media/API licenses.

[MeteoCam Marmari](https://www.meteocam.gr/eviamarmari) and [Schinias](https://www.meteocam.gr/schiniasfirecam) describe informational/weather-only viewing and no intentional personal-data processing. Their live-only/no-storage wording describes operator behavior, not a downstream storage grant. The linked Weewx GPLv3 concerns weather software, not camera footage. Embedding controls and timelapse labels do not establish retained-media/model-input permission.

[Skyline terms](https://www.skylinewebcams.com/en/terms-of-use.html), updated **4 November 2026**, allow strictly personal official-player viewing and unmodified supplied Embed code. Recording, copying, screenshots, republication/commercial use, automated extraction and outside-player stream access require written authorization. Initial camera-page metadata read preceded evaluating these freshly retrieved terms; no subsequent automated camera-page/stream read, player, screenshot or media request occurred. No general exemption claimed for this catalog.

Windy publishes a [conditional API-use contract](https://api.windy.com/webcams/terms) and [full terms](https://account.windy.com/agreements/windy-webcams-api-terms-of-use). API images require supplied URLs, source/player linkage and Windy courtesy. Full terms restrict intensive automated use, substantial continuous scanning/history downloads, identifying individuals, graphics publication and redistribution. Certain app-image use is documented, but proposed retained evidence/dataset/model use remains unresolved. No key, account or API call attempted. Earlier full-terms read returned 200 at **05:28:24.488Z**; bounded follow-up returned **429 at 05:31:52.491Z**, stopped without retry/bypass. Earlier evidence is retained with its actual time, not presented as successful later verification.

## API and playback evidence

Only Windy supplied a camera API contract in inspected pages: embedded **OpenAPI 3.0.0**, GET `/webcams/api/v3/webcams` and `/webcams/api/v3/webcams/{webcamId}`, header `x-windy-api-key`, filters including `countries`, `bbox`, `nearby`, `include`, `limit`, `offset`. List fields include `total`, `webcams`; required webcam fields include `webcamId`, `title`, `status`, `viewCount`, `lastUpdatedOn`. These are published schema facts, **not responses obtained from a camera API**. Docs state image URL tokens expire after 10 minutes (free) or 24 hours (professional), then return 401; token expiry and `lastUpdatedOn` are not authenticated sensor capture times. List limit 0–50 is page size, not request-rate permission. [Official documentation](https://api.windy.com/webcams/docs).

Other rows explicitly record API/schema/rate limits as unknown. Their named HTML entries, JPEG pointers, iframe or player placeholders prove only publication. HTTP media MIME, stream continuity, acquired pixels, source timestamps, SLA and permitted application use remain unverified. No media playback attempted because extraction/retention authority was absent or restricted. Zero playback results are a factual outcome, not an outage claim.

| Control | Actual response / check UTC | Proves |
|---|---|---|
| GC-C01 / GC-E01 | NOA Macedonia, 200 `text/html;charset=UTF-8`, 2026-11-15T05:31:53.363Z | Named Noesis camera metadata and image pointer, no JPEG fetched |
| GC-C02 / GC-E02 | NOA Central Greece, 200 `text/html;charset=UTF-8`, 2026-11-15T05:31:53.368Z | Three separately published Evia camera entries |
| GC-C03 / GC-E12 | Windy docs, 200 `text/html;charset=utf-8`, 2026-11-15T05:31:52.438Z | Official published API schema only, no authenticated API/Greece result |

JSON contains 18 timestamped metadata/terms response receipts, including the earlier Windy 200 and later 429. Fifteen final bounded HTML reads used 25-second request timeouts, 1,250,000-byte body ceiling and no subresources: 14 returned 200, one 429. Successful final bodies have SHA-256 digests; raw pages/media not saved. Earlier Skyline/Windy receipts explicitly have null hashes rather than fabricated digests. HTTP metadata evidence is not media ingestion.

## Publication, capture, check clocks

All **15/15** entries contain explicit clock comparison, UTC check and uncertainty. Publication/capture times are null/unknown, no check clock substituted for capture. Two MeteoCam entries publish map-coordinate parameters, but CRS, accuracy, sensor-position semantics and footprints are unknown. Other rows retain locality labels without guessed coordinates.

Kalavrita's HTTP page modification is **2026-11-13T08:14:07Z**, whereas visible weather text includes **19/4/2026** and malformed **20/4/2/2026**. Both are preserved as non-capture context. Windy documentation modification is **2026-11-12T09:45:30Z**, not any webcam's capture. Schinias's **23/7/2018** Mati weather history is historical explanatory text, not a current fire. Skyline's displayed clock is webpage time, not source acquisition. Kos homepage advertises ten spots; inspected location page lists two ports, so ten available streams is not claimed.

## Validation and handoff

Local field/cross-reference validation: **15/15** URL/publisher, geography uncertainty, API-or-unknown, rights, check UTC and clock-comparison records present; unique IDs **15/15**, evidence references resolved, eligibility **0**, playback/live claims **0**, thermal/radiometric/detection claims **0**. GC04 achieved through actual official catalog controls, not iframe proof. JSON parse and whitespace checks pass; source/rights review remains coordinator-owned.

GC03 safety-operation counts are zero for private access/bypass, media, credentials, spend and activation. **Strict operator-terms conformance is not certified**: the initial Skyline HTML metadata request preceded evaluating its newly retrieved automation prohibition. No retrospective exemption inferred. Retain this caveat for coordinator review; do not report all GC criteria unconditionally passed or close the issue on this receipt.

Research only. No credentials, private endpoints, stream/host enumeration, player/media calls, recordings, provider spend, packages, runtime/frontend changes, prior-project imports, Git delivery or activation. Existing coordinator TASKBOARD change preserved untouched. agent-reach used for `gh` and public reader routing; Exa backend unavailable, native public search used for URL discovery. Firecrawl billed fallback skipped under zero-spend constraint. General research-reference and global reference paths absent, issue-specific numeric method used, no HTML/PDF extras.

Next authorized step: coordinator source/rights/privacy review and Git delivery of these two files. Any future source selection requires explicit owner/access authority, exact use/retention/model permission, fresh permitted playback/capture evidence and separately approved integration. This catalog closes no issue and activates no source.

## Additive reconciliation, RGC23

Current combined catalog: **20 candidates, 15 distinct official candidate URLs, 7 publisher networks, 36 timestamped HTML receipts, 11 controls**. Ten controls are official catalog metadata responses, one API documentation only. **Ingestion eligible 0/20, playable/live 0/20, playback proofs 0**. Historical sections above remain the exact published PR #47 text, describe its original15-record research/restoration, not the combined counts or current capture. JSON top-level counts are combined; `additive_reconciliation.prior_counts` preserves the old counts.

Root exact claim `RGC23`, branch `task/swarm-20261115-camera-reconcile`, base `5d8724bab0f11e9c0cc0b158cea2cbcb5aea5928`. Tests before edits: **RGC01** all15 prior entries/18 receipts/3 controls unchanged and original Markdown/TASKBOARD exact prefixes; **RGC02** append13 fresh candidate-page check mappings,18 HTML receipts,8 NOA controls,5 missing regional records with original UTC checks,0 invented playback; **RGC03** duplicate IDs/missing refs/rights upgrades0,20/20 publication/capture unknown and playable/eligible false; **RGC04** JSON/local links/5 secret-pattern scans/diff-check errors0. Then append only independently reviewed SW23 metadata using existing catalog record schema, validate preservation and freeze for new independent rights review.

Non-goals: any new network/media/player/API request, catalog-schema redesign/full replacement, source activation/retention/model permission, recordings/identification, provider/account/credential/spend/inference, backend/frontend/package/CI/vault/frozen-output changes, worker Git actions, deployment or issue closure. This offline reconciliation performed **0 new requests**. User-authorized coordinator alone delivers reviewed branch/PR.

Published inputs retained: Markdown SHA256 `811945336a6e8d22bb360d097d1b5f2300c9e9e028484bb1e9ca551689d31212`, JSON `68d86ac814be799665bb71a42758fa992fb6f810d52fe04b21865b7128da66b2`. Reviewed additive inputs: held [PR #44](https://github.com/nikolas-sapa/fire-command-center/pull/44), source commit `cc18052`, Markdown `6805ed1b14984d34786cd1e15966cebdadc52d4b168d849a6f6d512fcd4e30b6`, JSON `05c5cde9a91ccc8287b1682f236d7357942531830741b061d637106d803ecf55`. Input pins are not hashes of these newly appended artifacts. Original15 entry objects,18 old receipts,3 controls, preparation/clocks/rights/delivery provenance preserved verbatim in JSON. New evidence stays separately identified and never backdates capture.

### Fresh metadata additions, checked 2026-11-15 UTC

The SW23 run checked **13 distinct candidate pages, five publisher networks**, with **18 HTML receipts** including five rights/operator reads. Its eight NOA regional catalog controls were200 `text/html;charset=UTF-8`; no JPEG/player/API/recording request. All receipts retain original check times, body byte counts and available SHA256. Raw pages are not included. These are historical fresh-source checks from06:19–06:34Z, **not newly executed during reconciliation**.

| Fresh official page | Retained entry mapping | Check UTC / evidence |
|---|---|---|
| [NOA Central Greece](https://www.meteo.gr/webcameras.cfm?ProvinceID=5) | Existing Karystos/Paximada/Oreoi | 06:32:58.771Z / `GC-M-NOA-CENTRAL` |
| [NOA Attica](https://www.meteo.gr/webcameras.cfm?ProvinceID=12) | Existing three Penteli entries | 06:33:00.141Z / `GC-M-NOA-ATTICA` |
| [NOA Macedonia](https://www.meteo.gr/webcameras.cfm?ProvinceID=2) | Existing Noesis | 06:33:01.206Z / `GC-M-NOA-MACEDONIA` |
| [NOA Thrace](https://www.meteo.gr/webcameras.cfm?ProvinceID=1) | New `GR-NOA-THRACE` catalog, Alexandroupoli/Didymoteicho labels | 06:33:02.249Z / `GC-M-NOA-THRACE` |
| [NOA Epirus](https://www.meteo.gr/webcameras.cfm?ProvinceID=3) | New `GR-NOA-EPIRUS` catalog, Metsovo/Papigko/Parga labels | 06:33:03.311Z / `GC-M-NOA-EPIRUS` |
| [NOA Thessaly](https://www.meteo.gr/webcameras.cfm?ProvinceID=4) | New `GR-NOA-THESSALY` catalog, Volos/Kalambaka/Pertouli labels | 06:33:04.372Z / `GC-M-NOA-THESSALY` |
| [NOA Peloponnese](https://www.meteo.gr/webcameras.cfm?ProvinceID=7) | New `GR-NOA-PELOPONNESE` catalog, Kalamata/Mystra/Patra labels | 06:33:05.435Z / `GC-M-NOA-PELOPONNESE` |
| [NOA Ionian Islands](https://www.meteo.gr/webcameras.cfm?ProvinceID=6) | New `GR-NOA-IONIAN` catalog, Marathias/Petaleia labels | 06:33:06.491Z / `GC-M-NOA-IONIAN` |
| [Marmari](https://www.meteocam.gr/eviamarmari) | Existing `GR-METEOCAM-MARMARI` | 06:33:30.214Z / `GC-M-METEOCAM-MARMARI` |
| [Schinias](https://www.meteocam.gr/schiniasfirecam) | Existing `GR-METEOCAM-SCHINIAS` | 06:33:30.607Z / `GC-M-METEOCAM-SCHINIAS` |
| [Kalavrita](https://kalavritaski.gr/en/live-cameras/) | Existing `GR-KALAVRITA-CATALOG` | 06:33:30.910Z / `GC-M-KALAVRITA` |
| [Kos](https://kos.gov.gr/en/kos-live-streaming/) | Existing two port-selector records, not proof of two streams | 06:34:13.118Z / `GC-M-KOS-CATALOG` |
| [Windy docs](https://api.windy.com/webcams/docs) | Existing `GR-WINDY-API`, no API/Greece result | 06:34:13.396Z / `GC-M-WINDY-DOCS` |

Fresh receipts mapped separately in JSON `additive_reconciliation.fresh_page_checks`; original15 entry clocks/fields remain unchanged. New regional catalog records use existing field/schema shape, null geometry/CRS/uncertainty/publication/capture and unresolved individual-owner rights. NOA's eight regional pages share **one** publisher, not eight verified camera operators. Sample labels never counted as newly playable cameras.

Rights/capture boundary unchanged. [NOA terms](https://www.meteo.gr/terms.cfm) fresh read `GC-R-NOA` at06:19:27.341Z; [About](https://www.meteo.gr/about-meteo.cfm) `GC-O-NOA` at06:18:48.508Z. [Kos terms](https://kos.gov.gr/en/terms-of-use/) `GC-R-KOS` at06:18:48.625Z still no substantive grant. [Windy short terms](https://api.windy.com/webcams/terms) `GC-R-WINDY` at06:18:47.650Z and [full terms](https://account.windy.com/agreements/windy-webcams-api-terms-of-use) `GC-R-WINDY-FULL` at06:19:27.684Z200 do not activate registration/API or retained-evidence/model rights. The prior429 remains prior; no inferred outage or bypass. Documentation update/camera status/image token expiry still not capture.

**Skyline and webcameras.gr published records/rights remain retained, no fresh requests for either.** The existing Skyline initial-HTML-before-restrictive-terms concern remains explicit and unchanged. Excluded from SW23 fresh checks is not deletion, clearance or retrospective exemption. No blanket operator-terms/privacy certification; no public visibility-to-permission upgrade.

Combined publication/capture unknown20/20, clocks compared20/20; media/API/playback/ingestion eligibility0. Source age cannot be calculated from retrieval clock. Original Kalavrita April-weather/November-HTML, Schinias2018 and Windy-document clocks remain source context, not current media. Issue #23 stays partial/open; renewed independent additive preservation/source-rights review required before coordinator delivery.

Measured RGC validation **2026-11-15T08:28:20.599Z**, Node **26.11.1**: prior15 ordered records/18 receipts/3 controls byte-equivalent JSON values, prior Markdown/TASKBOARD exact prefixes;5 added records follow existing entry schema,18/18 fresh receipt fields match reviewed SW23 input,13/13 fresh page mappings/8/8 controls resolve. Combined20 IDs/15 URLs/36 receipt IDs/11 control IDs unique;20/20 unknown source clocks and inactive eligibility. Local links6/6 resolved, missing refs0, rights upgrades0, five secret-pattern matches0, raw HTML additions0, tracked paths3/3 exact, unpiped diff-check exit0. Backend/browser/provider checks skipped, no runtime or network action in this reconciliation. Frozen for renewed independent rights review.
