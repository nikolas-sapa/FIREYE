# Proposal image lab

Open `http://localhost:5173/#image-lab`. The lab sits between Live Ops and the Design System. It reuses the console's spread solver for the Greece spread prototype but never reads or writes console state, scenario packs or predictions.

## Setup

Add this exact server-only variable to `.env` or, preferably, `.env.local`:

```dotenv
FAL_KEY=your_fal_api_key
```

Both files are gitignored. Do **not** use `VITE_FAL_KEY`: that would expose the credential in browser code. Restart the local server after changing it. An exported `FAL_KEY` takes precedence over dotenv files.

Use `npm run dev`, or `npm run build` followed by `npm run preview` for a local production-build check. Node 20+ is required. No additional package is needed.

The Vite plugin provides the API in both dev and preview. It accepts **loopback clients and localhost hosts only**, enforces same-origin submissions, allows only listed models, caps images/prompts, limits submissions to 20/minute and four concurrent submission handshakes, and stores at most 100 request handles for one hour in memory. This is a local research bench, not an authenticated production service. A static deployment can show the UI and test scenes but cannot run inference. Deploy a separately authenticated, budget-limited backend before offering this feature remotely; do not expose Vite or relax the loopback checks.

## Models

Default: [`google/nano-banana-2.1/edit`](https://fal.ai/models/google/nano-banana-2.1/edit/api), explicitly verified against fal's API documentation.

Comparisons:

- [`fal-ai/nano-banana-2/edit`](https://fal.ai/models/fal-ai/nano-banana-2/edit/api)
- [`fal-ai/nano-banana-pro/edit`](https://fal.ai/models/fal-ai/nano-banana-pro/edit/api)
- [`fal-ai/nano-banana/edit`](https://fal.ai/models/fal-ai/nano-banana/edit/api)

The adapter submits one input image and asks for one PNG with automatic aspect ratio. Resolution defaults to 1K; 2K/4K are available on supported models and may cost more. The original Nano Banana uses its own default resolution. No web/image search or automatic paid resubmission is enabled. Provider-side queue retries may still occur under fal's policies.

## Workflow and privacy

### Greece landscape / spread prototype (default)

The Greece mode builds a small fire-path model for one random landscape. Steps 1 to 3 and the spread run use free, keyless public sources and make **no fal call**. The AI review in step 4 is optional and paid.

1. Acknowledge the imagery's non-commercial terms, then click **Pick random Greece landscape**. The local server returns one north-up 1,024 px EPSG:3857 image of about 10.24 × 10.24 km, randomized within eight curated inland Greek windows (not uniform across Greece). Nothing is fetched when the page opens.
2. The server then builds the landscape on a 256 × 256 grid of 40 m cells, the console simulation's cell size:
   - **Fuel**: CORINE Land Cover 2018 polygons (EEA ArcGIS service, at most 10 pages) rasterized at cell centres and mapped to nine fuel classes with the same table as the Mati builder (`clcToFuel`).
   - **Terrain**: Terrarium tiles at zoom 12 (at most 16 tiles), bilinearly resampled.
   - **Weather**: Open-Meteo hourly 10 m wind, gusts, 2 m temperature and humidity for the next 48 h at the scene centre, cached for 10 minutes.
   The landscape is cached per scene. A failed source returns 502 and is not cached; **Retry failed sources** tries again. Without CORINE no spread runs; without weather the wind falls back to Manual.
3. Choose the wind: **Forecast** (pick the ignition hour; the model then follows the forecast hour by hour, holding the last hour past the end; optionally treat gusts as sustained wind) or **Manual** (speed, direction, humidity and temperature held constant).
4. Optional **AI land-cover review**. Each cell is sent with a 64 px overlap margin (576 px) plus the whole scene at 512 px, so all four cells are judged on one absolute scale. The prompt (`fcc-landcover-review-v5`, `reviewPrompt` in `src/image-lab/landscape.ts`) is fixed server-side and asks for a flat three-color mask: V `#FFB800` visible vegetation, N `#5CC8FF` exposed surface or water, U `#929298` uncertain. It names output colors only by hex code (see [Review prompt study](#review-prompt-study)). The browser resamples each output to 576 px with nearest-neighbour sampling, crops the margin and applies a **palette gate**: a cell is used only if at most 15 % of its pixels are more than 45 RGB units from all three colors. **Fusion** decides what accepted cells may change:
   - **CORINE only** (default): no fuel changes; cells where the review contradicts CORINE are outlined.
   - **Add vegetation**: non-burnable land (not water) becomes shrub where at least 60 % of a 40 m cell is V. It can add spread paths but never removes one.
   - **Full review**: also agriculture to shrub (V ≥ 60 %) and burnable land to rock (N ≥ 75 %, built-up excluded). It can speed up or slow down spread.
   **Seamless stitching** (`stitchReviews`, `blendOutputs`). Each 576 px output is placed back at its true scene position (origin 0 or 448 px), never squeezed into a 512 px slot. Neighbouring outputs share a 128 px band centred on each cut; across it their weights ramp linearly from 1 to 0, so they always sum to 1 and both outputs count equally at the cut (all four at the centre). Fusion and the map's AI review layer use these blended labels; a pixel is reviewed only if its own cell is accepted, and rejected neighbours drop out of the blend. The mosaic below the map and **Save review outputs PNG** show the same placement as one 1,024 px image with feathered overlaps. `overlapAgreement` reports how often two neighbours give the same label in their shared band.
   All four cells run at the same time, with the same model, at 1K. **Automatic retries** (None to 3 per cell, default 2) regenerate a cell whose output fails the palette gate, as a new paid call with a new random seed, until one passes or the budget is spent. A cell uses its first accepted attempt, otherwise its least off-palette one (still rejected, so it changes no fuel). The maximum is 4 × (1 + retries) calls: 12 at the default. The model and retry budget lock for the run. Network and provider failures are never retried automatically.
5. Choose the fire start: **Point**, **Line** or **Area**. Point: click or use the keyboard on the map (arrow keys move the cursor, Shift for larger steps, Enter sets ignition) to set an ignition cell. Line: click two or more points along an active fire front. Area: click three or more corners of an area already burning; the shape closes itself and its inside counts as burned. Fronts take up to 64 points; Backspace or **Undo point** removes the last one, **Clear** removes all, and the Point ignition is kept while you draw. Every burnable cell on the line or inside the area starts burning at minute 0; water, rock and unmapped cells are skipped and counted. For fronts the main run follows the mean offset of modelled cells from the nearest part of the front (far cells weigh more, so the head dominates) and reports the farthest reach along it, shown as **Front run**; with no clear direction the metric says so. The console's minimum-travel-time solver (`runTravelTime` in `src/console/agents/spread.ts`) runs in the browser in tens of milliseconds and draws 1 h, 3 h and 6 h bands with band edges, plus areas and the main run (bearing to the centroid of the modelled area and the farthest reach along it). Layers: fuel, hillshade, AI review, spread. Hover or focus shows the cell's position, fuel, elevation and modelled arrival.
6. **Export fcc-landscape-v1 JSON** (`landscapeExport`). It is the contract for loading a run elsewhere, such as the console later.

| Field | Content |
|---|---|
| `schema`, `createdAt`, `scene` | `fcc-landscape-v1`, export time, scene id, region and centre |
| `grid` | side 256, `EPSG:3857` bounds, `cellM`, north-first rows; rasters are base64, little-endian, row-major |
| `sources` | EOX imagery, CORINE, Terrarium and Open-Meteo names, licenses and fetch details |
| `fuelClasses` | `FuelClass` labels and whether each burns |
| `layers` | `fuelBase` and `fuel` (Uint8 `FuelClass`), `fuelOrigin` (0 CORINE, 1 AI added, 2 AI changed, 3 AI removed), `disagree` (Uint8), `elevationM` (Float32) |
| `review` | prompt version, model, retry budget, fusion mode, gate thresholds, classes, changed/disagreeing cell counts, per-tile status, request id, off-palette share, accepted flag and pixel counts of the attempt in use, plus every attempt's request id, off-palette share and accepted flag |
| `weather` | the Open-Meteo series (if loaded) and the wind choice used |
| `spread` | ignition index and lon/lat (first vertex for a front), `start` (`kind` point, line or area; front `vertices` with index and lon/lat; `seedCells`, `skippedCells`, `startHa`), horizon, bands, areas (ha), main run, edge flag, `arrivalMin` (Uint16 minutes, 65535 = not reached) |
| `notes`, `limitations` | reviewer notes and the fixed limitation list |

The server reserves a slot for **each attempt before submission**, including ambiguous network failures: at most 1 + retries per cell. Attempts for a cell must run in order, and a retry is allowed only after the previous attempt's output exists; the palette gate itself runs in the browser. Repeat clicks return the accepted job handle, or block a submitting/uncertain slot; they never create a replacement request. **Recover same cells** polls accepted jobs, re-reads outputs, recovers saved acceptance handles and resumes each cell at the same attempt. It never automatically retries a failed paid submission. Check fal history for uncertain submissions. Keep the page open; reloads lose the browser's run state. Server state expires after one hour or restart. Picking a new landscape explicitly starts another capped experiment and resets consent; there is no account-wide spending cap. Provider pricing and internal retry policies still apply.

Imagery source: [EOX Sentinel-2 cloudless 2020](https://eox.at/2021/03/sentinel-2-cloudless-2020/#license), served by [EOX::Maps](https://maps.eox.at/) WMS layer `s2cloudless-2020_3857`, [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). Required attribution:

> Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2020)

This is a **historical annual mosaic**, not a dated acquisition or current incident view. Approximately 10 m native resolution does not resolve individual bushes, most small debris, understory or moisture. The public imagery service is non-commercial; commercial use needs appropriate provider licensing. Preserve attribution and applicable share-alike terms for crops/adapted imagery, including exported composites. fal processing does not remove those source obligations.

Landscape sources: CORINE Land Cover 2018, © European Union, Copernicus Land Monitoring Service 2018, European Environment Agency (open data; 25 ha minimum mapping unit, about 100 m positional detail). [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium encoding; [attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)). Weather data by [Open-Meteo.com](https://open-meteo.com/), CC BY 4.0 (forecast, single point). None needs a key.

Landscape picking is limited to six/minute and 30 in-memory scenes/hour. All proxies use fixed public HTTPS hosts, reject redirects, check content type and size (8 MiB imagery, 32 MiB per land-cover page, 2 MiB per terrain tile, 1 MiB weather) and send no fal key to anything except the fal queue. All API/image responses are `no-store`; the PWA excludes this traffic.
### Single image

1. Load a bundled test scene or choose a JPEG, PNG, or WebP up to 8 MiB and 40 MP.
2. The browser re-encodes it locally to strip EXIF/GPS and limits the longest edge to 2,560 px. Visible identifying content is **not** anonymized. Prepared dimensions are shown and exported.
3. Edit the complete seeded prompt, choose a model/resolution, and acknowledge external processing and billing.
4. Click **Generate review overlay**. Only then are the prepared image and prompt sent through the local server to fal and the model provider.
5. Inspect the generated image beside the exact submitted source. Explanatory text is shown if supplied; some responses contain no text.
6. Open/save the output image and export the run JSON. The JSON includes the exact prompt, prompt version, model ID, resolution, input dimensions, request ID, timestamp, fixed palette, provider output URL/text, and limitations. It intentionally excludes the source image bytes and API key.

FCC does not write images or prompts to disk or localStorage. Source crops remain in browser memory; the grid server keeps scene metadata, the locked model, request handles and the derived landscape and weather in memory for up to one hour, with completed result metadata. Provider retention follows its own policies. Generated media URLs can be publicly accessible and may expire. Exported JSON includes the local filename and unverified model notes; review it before sharing.

Keep the page open while waiting. A polling/network failure exposes **Check same request again**, which retrieves that job without a new generation charge. After ten minutes the UI stops polling and offers the same action. Request handles expire after one hour or on server restart. If submission fails before a request ID is received, check fal history before submitting again; network failures can be ambiguous. Closing the page does not cancel an already-submitted job or its charges.

## Prompt and fixed palette

The complete seed lives in `src/image-lab/prompt.ts` (`fcc-visible-fuels-v1`). It is written for Nano Banana 2.1 image editing, not a segmentation-only model. It requests preserved viewpoint/geometry, restrained translucent fills, class-plus-number labels, non-color boundary cues, visible evidence, uncertainty, and optional matching notes. Those are instructions, not guarantees of model compliance.

| Class | Target sRGB | Meaning |
|---|---|---|
| H | `#FF3B30` | Priority inspection: apparent woody/dead-looking accumulation **and** visible continuity or structure contact. Not ignition probability. |
| V | `#FFB800` | Potential vegetation fuel. No inference of dryness or safety from color. |
| O | `#A88CFF` | Potential combustible object / contextual anomaly. Unknown contents remain unknown. |
| N | `#5CC8FF` | Clearly visible water, rock, or paved surface. Not a guaranteed firebreak. |
| U | `#929298` | Unknown/obscured, with diagonal hatching. Never low risk. |

The palette reuses FCC data colors but remains fixed across themes/appearance. Uncolored areas mean unassessed, not safe. If the user edits palette instructions, the fixed reference legend may no longer describe the output; exact submitted instructions are retained with the result.

## Limits of the spread prototype

The Greece spread map is a prototype, labelled as such in the UI and in every export:

- Same minimum-travel-time solver as the console (`PROJECTION.md`): fuel class, slope and wind only. No ember spotting, suppression, measured fuel moisture or fire-atmosphere coupling.
- On the Mati 2018 replay the solver, from detection, reached sourced checkpoints from about 30 min early to about 20 min late and burned less than half the reconstructed area. Treat times as rough, not as arrival forecasts.
- Above about 30 km/h the 16-direction solver under-represents the width and area of narrow wind-driven fires; head travel is still modelled at the full rate.
- Fuel is CORINE 2018 at 25 ha minimum mapping unit, mapped to nine coarse classes. Small patches, roads and recent burns are not represented. Wind is one forecast point applied uniformly.
- AI review cells are generative outputs gated only by palette compliance, not checked for accuracy. They change fuel only in the fusion mode you choose.

The single-image mode remains a visual hypothesis. A generative image can invent detail, drift spatially, approximate colors, omit objects, and render misleading labels; its colors there are not calibrated risk scores. Nothing from either mode feeds the console's predictions.

For an operational pipeline, collect expert-validated fuel maps, measured moisture, observed wind fields and independently validated spread models. RGB alone does not establish fuel moisture, understory hidden by canopy, species or container contents.
Bundled scenes and source licenses: [`public/image-lab/README.md`](../public/image-lab/README.md).

## Review prompt study

Measured on the fixed Crete scene in `experiments/crete-study-2026-11-15/` (one sample per cell, seed 41729, Nano Banana 2.1 at 1K, each cell with halo and whole-scene context). Re-run the numbers with `node scripts/image-lab-study-eval.mjs <run>`. Reference patches are spot checks interpreted from the source image, not field truth.

| Prompt | Cells passing the 15 % gate | Off-palette NW / NE / SW / SE | Reference patches | Labels matching across cut lines |
|---|---|---|---|---|
| v3 (Crete-specific hints) | 2 / 4 | 5 / 19 / 9 / 34 % | 9 / 12 | 72 % |
| v4 (lists forbidden colors) | 1 / 4 | 39 / 27 / 2 / 19 % | 8 / 12 | 68 % |
| v5 (hex codes only, shipped) | 1 / 4 | 29 / 2 / 51 / 41 % | 8 / 12 | 85 % |

Live app run, Olympus foothills, v5 (2026-11-15, 4 paid calls): NW 14.0 % and NE 9.4 % off-palette (accepted), SW 33.4 % and SE 30.8 % (rejected).

Findings: no wording reliably holds the three-color palette. The usual failure is a fourth, darker shade for dense canopy: in five of the eight failing cells more than half of the off-palette pixels were dark amber, and v4 also painted olive. v3 and v4, which both name white, produced white patches. Naming a color, even to forbid it, makes it more likely. v5 was kept because it is scene-neutral and its cells agree best with each other, not because it passes the gate more often. With one sample per prompt, sampling noise is as large as the wording effects. The gate does its job: rejected cells leave the CORINE fuel unchanged.

## Model comparison

Same Crete scene, 33 paid calls (about $0.84 at list prices), scored against ESA WorldCover 2020 (10 m, CC BY 4.0, a separate model product, not field truth) and the 12 spot patches. Details and per-run numbers: `experiments/crete-study-2026-11-15/models/README.md`. Scripts: `scripts/image-lab-model-study.mjs` (capped ledger, eight per model), `scripts/image-lab-model-eval.mjs`, `scripts/image-lab-worldcover.mjs`.

| Option | List price per call | Inference | Result |
|---|---|---|---|
| Nano Banana 2.1, medium thinking (ships) | about $0.045 (estimated) | about 26 s | Best AI result: up to 9/12 patches, κ up to 0.13 vs WorldCover, gate passes 1–2 of 4 cells |
| Nano Banana 2.1, minimal thinking | slightly less | 18–26 s | Much worse: tree recall 1.5 % vs 20 %, 0/4 cells pass |
| FLUX Kontext dev | $0.025 | 3–8 s | 0/8 frames pass; pale or off colors, invented lake and blobs |
| Qwen Image Edit 2511 | $0.03 | 3–7 s | 0/8 pass; keeps geometry but recolors the photo, or draws coarse invented regions |
| Seedream v4 edit | $0.03 | 12–19 s | 0/3 pass; loses composition |
| SAM 3 | $0.005 | under 1 s | Water only: IoU 0.81, precision 0.98, no false positive on a dry crop; no mask for any vegetation or rock prompt |
| ESA WorldCover 2020 (no fal call) | free | about 1 s | 10/12 patches, more than any AI run |

Keep Nano Banana 2.1 at medium thinking. None of the cheaper generative models produced a usable mask. SAM 3 is a cheap water detector. A keyless WorldCover layer is the best cost/quality option found for vegetation. One scene, mostly one sample per setting: these are screening results.
## Validation

`npm run test:image-lab` covers the mocked adapter, exact 2.1 endpoint, queue root handling, limits, secret isolation, error handling, model payloads and rendered UI. Grid checks cover row order, exact crops/bounds, sampling extremes, no-key imagery, media download limits, four 1K submissions, duplicate/concurrent clicks, ambiguous failures and partial result recovery. No paid provider calls are made by tests.

Implementation checks (2026-11-15): build, console/scenario tests, PWA checks, and the image-lab test suite pass. Browser checks on the existing local dev server exercised sample loading, real file upload/re-encoding, custom prompt submission, model switching, consent reset, mocked result rendering, empty model notes, same-request recovery after a retrieval error, and JSON export. Desktop and 390 px mobile layouts were inspected. All provider responses in browser generation tests were fixtures, not live inference. Model adherence, output quality, and real account/model access remain untested until an authorized keyed run.

Greece-grid browser checks fetched live EOX imagery with paid submissions blocked. Mocked analysis exercised a 3/4 partial result, recovery to 4/4 with exactly four submissions, empty descriptions, human review notes/marks and both 1,024 px PNG exports. An independent synthetic image checked all 1,048,576 crop pixels and all 4,194,304 reassembled RGBA channels exactly, plus wrong-size/non-square guards. A failed subsequent imagery fetch reset consent, removed stale outputs and made no analysis request. The completed grid passed scoped axe with zero violations or incomplete checks; the 390 px layout had no horizontal overflow. Temporary browser fixtures were removed. These are workflow/geometry checks, not model-quality validation.

Landscape pipeline checks (2026-11-15, temporary local server, real public sources): CORINE, Terrarium and Open-Meteo loaded for two scenes (30 and 33 polygons, 100 % mapped). Forecast and manual wind, keyboard ignition (arrow keys and Enter), all four layers and all three fusion modes ran; spreads took 9 to 23 ms. In the live Olympus run with manual 35 km/h west wind, CORINE only gave 445 / 1,581 / 2,642 ha at 1 / 3 / 6 h and Full review 446 / 1,531 / 2,420 ha (4,384 cells changed, only in the two accepted cells). Add vegetation changed nothing because the accepted cells held almost no non-burnable land. The exported `fcc-landscape-v1` JSON (about 880 KB) parsed and its rasters decoded. The 390 px layout had no horizontal overflow, and scoped axe reported no violations after a Slider tick-label contrast fix.
