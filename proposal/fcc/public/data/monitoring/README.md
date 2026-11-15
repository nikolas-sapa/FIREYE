# Permitted real presentation fixtures

Captured by `node scripts/save-monitoring.mjs`; the JSON files retain exact retrieval and observation times.

- `attica2024.json`: Copernicus EMSR746 initial DEL burned-area product, not AOI. Acquisition 2024-08-12 09:05 UTC; publication 19:01 UTC. 46 polygon features; 8,594.2 ha initial mapped area. © 2024 European Union / Copernicus EMS.
  - Metadata: https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations/?code=EMSR746
  - Geometry: https://rapidmapping-viewer.s3.eu-west-1.amazonaws.com/EMSR746/AOI01/DEL_PRODUCT/EMSR746_AOI01_DEL_PRODUCT_observedEventA_v1.json
- `attica2024-gibs.jpg`: NASA GIBS VIIRS SNPP corrected-reflectance true color, 2024-08-12. Bbox 23.78,37.98,24.05,38.28; 1024×768 output. Coarse optical overview, not tactical aerial imagery; may include smoke/cloud. NASA Earthdata / LANCE.
- `current-firms.json`: Official public NOAA-20/21 FIRMS last-24h downloads, filtered to the Greece-region bounding box (includes neighboring border areas). **Saved data, not current after its retrieval date.** NASA FIRMS / LANCE. Nominal 375 m anomalies, not confirmed incidents.
- `current-metar.json`: NOAA Aviation Weather airport METAR observations returned at capture. **Saved data, not current after its observation time.** NOAA / originating stations.

No third-party camera media, original commercial satellite products, secrets or tokenized webcam URLs are bundled. Local Mati assets are reused without modification. See `docs/MONITORING.md` for limitations.

`attica-detail-2020.jpg` and its JSON provenance file add a **3840×4035 historical Sentinel-2 cloudless 2020** basemap from EOX IT Services GmbH (contains modified Copernicus Sentinel data 2020). Bbox 23.55,37.85,24.15,38.35. Approximately 10 m source imagery, approximately 14 m output. **CC BY-NC-SA 4.0**, non-commercial use; https://s2maps.eu. Not current or 2024 incident imagery. Refreshed separately by `node scripts/save-monitoring-detail.mjs`. Simulated camera loops animate the existing Mati 2018 archive, not copied webcam footage.
