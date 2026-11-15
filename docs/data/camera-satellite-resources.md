# Camera and satellite resource candidates

Metadata/source checks: 2026-11-15. [Docs index](../README.md) · [Software status](../../SOFTWARE.md) · [Taskboard](../../TASKBOARD.md) · [Thermal contract](../contracts/thermal-camera.md)

Complementary candidates, not installed or ingested. No camera scans, private feeds, media downloads, inference or application integration performed by this catalog. Selection, source permission and ingestion require separate approval. Software licenses do not license source video, imagery or provider services.

## Bounded shortlist

| Candidate | Pinned source / exact license | Useful boundary |
|---|---|---|
| MediaMTX | [v1.21.3](https://github.com/bluenviron/mediamtx/releases/tag/v1.21.3), [MIT license](https://github.com/bluenviron/mediamtx/blob/v1.21.3/LICENSE). | Standalone Go transport for owned/authorized RTSP → browser WebRTC/WHEP or HLS. Not a detector or footage-rights grant. Frame extraction/transcoding needs separate FFmpeg/GStreamer and codec checks. No stream-capacity benchmark established. |
| HIT-UAV | [Repository](https://github.com/suojiashun/HIT-UAV-Infrared-Thermal-Dataset), commit `c5ce70a049d38036fe767b68692c3411ef04e900`, [CC BY 4.0 license](https://github.com/suojiashun/HIT-UAV-Infrared-Thermal-Dataset/blob/c5ce70a049d38036fe767b68692c3411ef04e900/LICENSE). | Recorded UAV thermal/person fixture with ground-truth labels. Credit authors, license and changes. No verified georegistration, radiometric calibration or wildfire/rescue accuracy. Older [Zenodo release](https://zenodo.org/records/7633134) says CC0; that does not replace this commit's CC BY 4.0 terms. |
| HPWREN FIgLib | [Published archive](https://www.hpwren.ucsd.edu/FIgLib/), [current usage terms](https://www.hpwren.ucsd.edu/cc.html): data older than 24 hours, CC BY-NC 4.0. | Fixed-lookout wildfire RGB/monochrome archive, not LWIR thermal. Automated retrieval, embedding or model use of data younger than 24 hours needs prior live-data license, including noncommercial use. No live clearance or product/demo noncommercial eligibility assumed. Commercial archive use follows separate registration/conditions. |
| USGS HVO F1 thermal camera | [Official F1cam item](https://www.usgs.gov/media/webcams/f1cam-kilauea-summit-thermal-west-rim-summit-caldera-looking-southeast), explicitly Public Domain. | Authority-operated thermal volcano/lava context, not Greek wildfire, drone imagery or person evidence. Rendered image is not a verified pixel-temperature API. Polling limits, freshness/SLA and calibration unverified; credit USGS/HVO. |
| NASA GIBS + EONET | [GIBS docs/data use](https://nasa-gibs.github.io/gibs-api-docs/), [NASA-led science-data default CC0](https://science.data.nasa.gov/about/license), subject to restrictive notices; third-party layers retain source terms. [EONET v3](https://eonet.gsfc.nasa.gov/docs/v3) has no separately verified CC license here. | Dated satellite imagery and approximate hazard context. Preserve layer/source credits, partner terms and event dates. [EONET disclaimer](https://eonet.gsfc.nasa.gov/what-is-eonet#disclaimer): visualization/general information, not authoritative perimeters or evacuation guidance. |
| PySTAC Client, optional | [v0.9.1](https://github.com/stac-utils/pystac-client/releases/tag/v0.9.1), [Apache-2.0 license](https://github.com/stac-utils/pystac-client/blob/v0.9.1/LICENSE). | Python ≥3.10 metadata-search helper, not a TypeScript dependency or imagery service. Catalog permissions, auth, asset licenses and costs remain independent. No installation proposed in current protocol slice. |

## Small fixture path, not an integration receipt

- HIT-UAV candidate: `normal_json/test/1_60_80_0_00701.jpg`, 640×512, pinned commit above. [Label metadata](https://github.com/suojiashun/HIT-UAV-Infrared-Thermal-Dataset/blob/c5ce70a049d38036fe767b68692c3411ef04e900/normal_json/annotations/test.json): image ID `2772`, 21 Person labels. Keys include singular `annotation` and image `filename`, not exact COCO keys. Labels are ground truth, never model results. A map anchor would be explicitly simulated, not inferred geography.
- NASA context: [Evia event EONET_5814](https://eonet.gsfc.nasa.gov/api/v3/events/EONET_5814), source PDC, dated 2021-08-09. Use imagery from the matching period, not latest imagery labelled historical. [GIBS WMTS capabilities](https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml) lists MODIS true color and GOES fire-temperature layers; GOES does not cover Greece. [Bulk policy](https://nasa-gibs.github.io/gibs-api-docs/map-library-usage/#bulk-downloading): over 1 million tiles/day requires coordination 48 hours ahead, not a demo target.
- HPWREN [published FIgLib file index](https://cdn.hpwren.ucsd.edu/HPWREN-FIgLib-Data/index.html) avoids stream discovery. Use only permission-cleared archived fixtures. Credit: “Data courtesy of HPWREN, University of California San Diego.” Retain required imprints and result-publication notice: “HPWREN data are not intended to be used as a decision-making tool, or as a replacement for such tools.”
- MediaMTX is optional only after an authorized source is supplied. Do not browse exposed private cameras, guess RTSP URLs, scan endpoints or bypass access controls. Public camera accessibility is not permission for automation, embedding or model analysis.

## Metadata required before any ingest

| Field group | Preserve explicitly |
|---|---|
| Identity and rights | Evidence/source ID, publisher, original URL, dataset/software version or commit, exact license URL, attribution/notices, changes, access permission and permitted use. |
| Clocks | Capture/acquisition, post/publication if applicable, retrieval and received clocks; time zone and missing/unknown values. Never substitute retrieval time for capture time. |
| Geography | Coordinates, CRS, footprint/extent, georegistration status and positional uncertainty. Unknown geography stays unknown; exercise anchors marked simulated. |
| Sensing | Modality, pixel/spatial resolution, source kind, synthetic/recorded/live flags, radiometric status, calibration source/status and measurement uncertainty. |

10 m satellite imagery cannot identify individual people. False-color pixels are not Celsius. Thermal does not provide through-wall vision; smoke/occlusion and sensing capability need source-specific validation. Missing calibration means no invented temperature/range/confidence. Detection hypotheses stay unverified.

Existing Copernicus/OSM/Evia investigation remains in [frozen wildfire-sweep research](https://github.com/nikolas-sapa/wildfire-sweep/tree/66bb3c9). This shortlist complements it, does not rewrite or import it. Preserve file-level source/commit/license/attribution and pre-existing/adapted/new-work disclosure for any later reuse.
