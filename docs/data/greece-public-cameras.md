# Greece public camera catalogs, research only

Issue [#23](https://github.com/nikolas-sapa/fire-command-center/issues/23), exact claim `SW23`, branch `task/swarm-20261115-issue-23`, source baseline `db15588f40e2c7bb26de3322d06d99f51235b32d`. Companion [JSON catalog](greece-camera-catalog.json). Neither artifact is an ingestion allowlist or source-activation approval.

## Test plan first

| Test | Numeric pass criterion |
|---|---|
| GC01 | Inspect >=10 candidates. 100% retained records carry official publisher/operator status, geography/uncertainty, published access/schema or explicit unknown, reuse status and UTC check time. |
| GC02 | Each playable/live claim has >=1 permitted actual timestamped playback/API response with type and currentness. Iframe alone counts 0. Unverified live claims 0. |
| GC03 | Private/unauthorized CCTV, bypass, host/stream enumeration, credentials, recordings, spend, automatic ingest and activation all 0. |
| GC04 | >=1 actual official catalog/API positive control or explicit failure. 100% retained records compare publication/capture/check clocks and uncertainty. |

Non-goals: footage/player/stream acquisition, private CCTV discovery, identity/plate analysis, continuous polling, bulk downloads, accounts/API keys, paid retrieval/providers, media ingestion, thermal/radiometric/detection claims, runtime/frontend/package/CI changes, vault/frozen `wildfire-sweep` changes, deployment, merge or issue closure.

Implementation follows tests: reconcile issue and existing draft read-only, inspect published rights before media consideration, make bounded official HTML reads, preserve timestamps/unknowns, validate artifacts, then independent source/rights/privacy review. No camera playback attempted where permission unresolved.

## Answer

**13 inspected candidate pages, 5 publisher networks, 0 ingestion-cleared, 0 verified playable/live.** Eight actual NOA HTML catalog responses provide positive metadata controls; Windy supplies a published API contract, not an API response. All camera capture/publication clocks remain unknown. Issue #23 remains partial, no source needed for current bounded wildfire-exercise demo.

## Key findings

- [NOA catalog](https://www.meteo.gr/webcameras.cfm?ProvinceID=5) assigns camera rights to individual owners. [NOA terms](https://www.meteo.gr/terms.cfm) require consent and source attribution for site-information reproduction. Official catalog publisher is [National Observatory of Athens](https://www.meteo.gr/about-meteo.cfm), not a proven owner of each camera.
- [Kos](https://kos.gov.gr/en/kos-live-streaming/) lists two port selectors but publishes one initial iframe. [English terms](https://kos.gov.gr/en/terms-of-use/) contain no substantive camera reuse grant in inspected text. Public municipal status is not public domain.
- [MeteoCam Marmari](https://www.meteocam.gr/eviamarmari) and [Schinias](https://www.meteocam.gr/schiniasfirecam) provide informational/weather notices, not footage reuse licenses. Operator live-only/no-storage practice does not grant downstream retention; linked Weewx GPLv3 licenses software, not imagery.
- [Windy API docs](https://api.windy.com/webcams/docs) require a registered API key. [Full terms](https://account.windy.com/agreements/windy-webcams-api-terms-of-use) allow certain app-image use but restrict intensive automated use, substantial continuous scanning/history downloads, identifying people, graphics publication and redistribution. Retained evidence/dataset/model use remains unresolved.

## Candidate map

Each row is one distinct official candidate URL. Eight NOA regional catalogs belong to one publisher, not eight independent operators. Sample camera labels are publication facts, not verified active feeds. `GC-M-*` receipts map to JSON entry IDs `GR-*`.

| ID suffix | Official source and geography | Inspected publication, not playback | Rights profile / final UTC check |
|---|---|---|---|
| NOA-CENTRAL | [Central Greece / Evia](https://www.meteo.gr/webcameras.cfm?ProvinceID=5) | Karystos, Paximada Karystou, Oreoi names and image pointers | NOA / 06:32:58.771Z |
| NOA-ATTICA | [Attica](https://www.meteo.gr/webcameras.cfm?ProvinceID=12) | Penteli dome, SW Athens, Parnitha-facing labels | NOA / 06:33:00.141Z |
| NOA-MACEDONIA | [Macedonia](https://www.meteo.gr/webcameras.cfm?ProvinceID=2) | Noesis and Olympus labels | NOA / 06:33:01.206Z |
| NOA-THRACE | [Thrace](https://www.meteo.gr/webcameras.cfm?ProvinceID=1) | Alexandroupoli port and Didymoteicho labels | NOA / 06:33:02.249Z |
| NOA-EPIRUS | [Epirus](https://www.meteo.gr/webcameras.cfm?ProvinceID=3) | Metsovo, Papigko, Parga labels | NOA / 06:33:03.311Z |
| NOA-THESSALY | [Thessaly](https://www.meteo.gr/webcameras.cfm?ProvinceID=4) | Volos, Kalambaka, Pertouli labels | NOA / 06:33:04.372Z |
| NOA-PELOPONNESE | [Peloponnese](https://www.meteo.gr/webcameras.cfm?ProvinceID=7) | Kalamata beach, Mystra, Patra labels | NOA / 06:33:05.435Z |
| NOA-IONIAN | [Ionian Islands](https://www.meteo.gr/webcameras.cfm?ProvinceID=6) | Marathias Zakynthos, Petaleia Corfu labels | NOA / 06:33:06.491Z |
| METEOCAM-MARMARI | [Marmari harbor, Evia](https://www.meteocam.gr/eviamarmari) | Description and uncalibrated map anchor | METEOCAM / 06:33:30.214Z |
| METEOCAM-SCHINIAS | [Schinias, Attica](https://www.meteocam.gr/schiniasfirecam) | “Fire Cam” name and historical weather text only | METEOCAM / 06:33:30.607Z |
| KALAVRITA | [Helmos, Achaea](https://kalavritaski.gr/en/live-cameras/) | Chalet 1700m, Park 1860m, camera tabs/placeholders | KALAVRITA / 06:33:30.910Z |
| KOS-CATALOG | [Kos main port](https://kos.gov.gr/en/kos-live-streaming/) | Two selectors, one published YouTube iframe, not opened | KOS / 06:34:13.118Z |
| WINDY-DOCS | [Greece-capable API docs](https://api.windy.com/webcams/docs) | OpenAPI/key/filter/response contract, no Greece query | WINDY / 06:34:13.396Z |

All final checks dated **2026-11-15**. Unknown individual operators remain null. All positions, CRS, footprints and metric uncertainties remain null; locality names are not sensor geometry. Marmari `(38.049314, 24.317190)` and Schinias `(38.157, 24.00747)` are published map `xlat/xlon` parameters only, not verified sensor/target positions. Source pages above, JSON `geography.published_map_parameters`.

## Details

### Rights and playback boundary

JSON resolves each entry's `rights.profile_id` against five `rights_profiles`. Profiles explicitly separate human viewing, embedding, automated sampling, retention, model use, redistribution and attribution. Unknown stays unknown. [Kalavrita](https://kalavritaski.gr/en/live-cameras/) reserves rights, no footage grant verified. No media/stream URL appears as a runnable fetch target in catalog.

No camera API, JPEG, HLS segment/manifest, player, iframe subresource or recording requested. Media MIME, continuity, source capture time, thermal capability, radiometry and detection remain unverified. “Live”, “Fire Cam”, webcam status and webpage clock are publisher labels, not our source claims. **GC02 positive playback proof 0; permission-gated skip, not an outage or successful stream claim.**

### Published API contract

[Windy docs](https://api.windy.com/webcams/docs): inline OpenAPI **3.0.0**, GET `/webcams/api/v3/webcams` and `/webcams/api/v3/webcams/{webcamId}`, header `x-windy-api-key`; filters `countries`, `bbox`, `nearby`, `include`, `limit`, `offset`. List requires `total`, `webcams`; webcam requires `webcamId`, `title`, `status`, `viewCount`, `lastUpdatedOn`. `bbox` order is north latitude, east longitude, south latitude, west longitude. List limit **0–50 is page size**, not request-rate permission. Other candidates: no camera API/schema/rate limit verified.

Image URL tokens expire after **10 minutes free / 24 hours professional**, then 401. Token expiry and ISO most-recent-update `lastUpdatedOn` are not authenticated acquisition. [Full terms](https://account.windy.com/agreements/windy-webcams-api-terms-of-use) define active as updated within 24h, do not guarantee camera count/availability/quality, and state latest terms update effective **2023-09-01**. No key, account, API call or current Greek coverage verified.

### Evidence and clocks

JSON includes **18 fresh timestamped HTML receipts**: 13 final candidate reads and five rights/operator reads. Candidate bodies all 200; eight NOA controls are actual `text/html;charset=UTF-8` responses at times above. Controls prove catalog publication/access only. Body SHA-256 and byte count identify received HTML, not imagery. Raw bodies discarded; no media saved. Reads bounded to 25 seconds, 1,250,000 HTML bytes, no automatic redirects/subresources or supplied credentials.

Publication/capture null for **13/13** entries. HTTP Date/check is receipt time. [Kalavrita](https://kalavritaski.gr/en/live-cameras/) HTML modification **2026-11-13T08:14:07Z**, visible weather **19/4/2026** and malformed **20/4/2/2026**, neither dates camera acquisition. [Windy docs](https://api.windy.com/webcams/docs) modification **2026-11-12T09:45:30Z**, not a webcam capture. [Schinias](https://www.meteocam.gr/schiniasfirecam) **23/7/2018** is historical Mati weather context, not current fire evidence.

## Prior-draft reconciliation

Existing unmerged issue23 worktree was read-only, not copied. Its two artifact SHA-256 identifiers appear in JSON `prior_reconciliation.prior_artifacts`; prior worker check times remain prior, not new playback evidence. Fresh catalog uses 13 distinct URLs instead of inflating count through multiple camera labels on shared pages. Original planning checkout, vault and frozen outputs untouched.

**Historical Skyline caveat remains:** prior worker reported initial Acropolis HTML metadata read at **05:27:20.274Z**, before reading freshly restrictive [Skyline terms](https://www.skylinewebcams.com/en/terms-of-use.html) at **05:29:26.404Z**. Reported update **4 November 2026** requires written authority for automated extraction/outside-player access, recording/copy/screenshots and republication, with personal official-player viewing/supplied unmodified embed exceptions. This is attributed prior-worker evidence, **not freshly reverified**. Skyline excluded; no Skyline request this pass. Exclusion does not erase prior terms-ordering concern. No blanket prior legal/terms conformance certification.

Prior Windy full-terms follow-up **429 at 05:31:52.491Z**, then stopped. This pass read public terms **200 at 06:19:27.684Z**; no API/account/key or limit bypass. A terms response is not source playback. Source: prior JSON fingerprints and fresh `GC-R-WINDY-FULL` receipt.

## Verification and handoff

Local validation covers JSON parse, 13 unique entries/URLs, all publisher/geography/uncertainty/access/rights/check/clock fields, resolved rights/evidence references, valid receipt timestamps, zero playable/live/thermal/radiometric/detection claims and inactive eligibility. GC01 fields/denominator met; GC04 eight positive catalog controls. GC02 media proof explicitly absent. Current-pass GC03 prohibited operations zero, inherited Skyline caveat unhidden. Independent rights/privacy review pending, issue stays open.

Measured validation **2026-11-15T06:42:54.845Z**, Node **26.11.1**: 13/13 entry checks, 18/18 receipt checks, 8/8 control references, 1/1 local link resolved, five credential-pattern scans with 0 matches, trailing-whitespace errors 0. JSON parse and unpiped `git diff --check` exit 0. Only two new docs in worktree status; temporary bounded reader under ignored `.scratch/`, no tracked source/script/package delta. HTML receipts are metadata, never positive playback fields.

Only two new research artifacts for delivery. Optional checker, backend tests/typecheck, live media/API, browser/ML and deployment checks skipped: no runtime/source implementation. Skills: agent-reach routes `gh`/public page reads; standard research method adapted to issue's numeric scope. Generic research-reference/global-reference pointers absent; no HTML/PDF/report extras. Metered search/Firecrawl, accounts and provider transports unused.

Next gate: independent source/rights/privacy review, then coordinator-reviewed branch/PR delivery. Actual source selection needs exact owner/use/retention/model clearance and separately authorized current playback/capture proof. This report grants none.
