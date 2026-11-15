# FCC Setup (REV D)

How to run the proposal site and full-screen console, add optional credentials, and rebuild the Mati or Caldor scenario pack.

The default entry is the real-data Attica monitoring presentation. See [Monitoring setup, source limits and recording safety](MONITORING.md). The original simulated Mati console remains at `?mode=replay`. Every map token is optional; local terrain and historical cases work without one.

## 1. Requirements

- Node.js 20 or newer, npm 10.
- A desktop browser with WebGL 2 (Chrome, Edge, Safari 17+, Firefox). The console is designed for 1920 × 1080 and larger.

## 2. Install and run

```bash
npm install
npm run dev          # http://localhost:5173
```

| URL | What |
|---|---|
| `http://localhost:5173/` | The proposal site (REV D). |
| `http://localhost:5173/#image-lab` | Random Greece satellite 2×2 bench, capped four-call analysis, seam inspection/exports, plus single-image uploads. |
| `http://localhost:5173/console.html` | Real-data monitoring: Current Attica, Mati 2018 and Attica 2024. |
| `http://localhost:5173/console.html?mode=replay` | Original simulated Mati 2018 reconstruction. |
| `http://localhost:5173/console.html?scenario=caldor-2021` | Caldor 2021 replay. |
| `http://localhost:5173/console.html?theme=team` | Team theme: blue accent and Geist fonts. |
| `http://localhost:5173/rev-b/index.html` | Frozen REV B build. |
| `http://localhost:5173/rev-a/index.html` | Frozen REV A build. |

Before shipping changes run `npm run build` (typecheck + production build).

## 3. Environment file

```bash
cp .env.example .env.local
```

`.env.local` is gitignored. Vite reads it at startup, so **restart `npm run dev`** after editing it.

| Variable | Used by | Effect |
|---|---|---|
| `VITE_CESIUM_ION_TOKEN` | Console stage | Cesium World Terrain and ion imagery. |
| `VITE_GOOGLE_MAPS_KEY` | Console stage | Google Photorealistic 3D Tiles. |
| `FIRMS_MAP_KEY` | Local monitoring server and data scripts | Free NASA FIRMS area queries; monitoring falls back to official public downloads without it. Never exposed to the browser. |
| `WINDY_API_KEY` | Local monitoring server only | Optional Windy Webcams discovery; curated provider links work without it. |
| `FCC_APP_CONTACT` | Local monitoring server only | Actual public project/contact URL or application contact address, required to identify MET Norway requests. |
| `FAL_KEY` | Local image-lab server only | Paid image editing through fal. Add `FAL_KEY=your_fal_api_key` to `.env` or `.env.local` and restart. Never use a `VITE_` prefix. |

Variables prefixed with `VITE_` are embedded in the client bundle. Treat them as public and restrict them as described below.

The image lab requires the local dev/preview server; static hosting has no inference or imagery proxy. Picking a Greece landscape needs no key and makes no fal call. The EOX imagery is a historical 2020 mosaic for non-commercial use, not live imagery. Analysis is separately consented and capped at four 1K submissions. See [Image lab setup and limitations](IMAGE_LAB.md) for licensing, models, privacy, exports, and production-backend requirements.

The map HUD names the active basemap. Select **Satellite** to use Google/ion imagery; the clean **Outline** default intentionally uses the local DEM, even when credentials are configured. `getStageCapabilities()` reports configured credentials, not successful provider access.

## 4. Cesium ion token (free, non-commercial)

1. Create an account at https://ion.cesium.com/signup (Community plan, free for non-commercial and personal use).
2. Open **Access Tokens** (https://ion.cesium.com/tokens) and click **Create token**.
3. Name it `fcc-local`. Scopes: keep `assets:read` and `geocode`. Under **Resources**, keep the default assets (Cesium World Terrain, Bing Maps Aerial, Cesium OSM Buildings) or select them explicitly.
4. Under **Allowed URLs**, add `http://localhost:5173` (and your deployed origin later). This stops the token working on other sites.
5. Copy the token into `.env.local`:

   ```
   VITE_CESIUM_ION_TOKEN=eyJhbGciOi...
   ```

6. Restart `npm run dev` and reload `/console.html`.

Community limits to keep in mind: roughly 15 GB of streaming per month and a monthly cap on Google/Bing imagery sessions (about 1,000). A 3-minute demo uses a small fraction. Commercial use needs a paid plan.

## 5. Google Map Tiles API key (Photorealistic 3D Tiles)

Billing is required even for usage inside the free caps. The old $200 monthly credit ended in February 2025; Google Maps Platform now has per-SKU free monthly usage. Set a budget alert.

1. Go to https://console.cloud.google.com/ and create a project, for example `fcc-demo`.
2. **Billing**: link a billing account to the project (Billing → Link a billing account).
3. **Enable the API**: APIs & Services → Library → search **Map Tiles API** → Enable.
4. **Create the key**: APIs & Services → Credentials → Create credentials → API key.
5. **Restrict the key** (important, the key ships to the browser):
   - Application restrictions → **Websites (HTTP referrers)** → add `http://localhost:5173/*` and `http://127.0.0.1:5173/*`, and later your deployed origin, e.g. `https://fcc.example.com/*`.
   - API restrictions → **Restrict key** → select only **Map Tiles API**.
6. **Budget**: Billing → Budgets & alerts → create a budget (for example 10 USD) with email alerts at 50 / 90 / 100 %.
7. Copy the key into `.env.local`:

   ```
   VITE_GOOGLE_MAPS_KEY=AIza...
   ```

8. Restart `npm run dev`.

Terms that matter for the demo: Google and data-provider attribution must stay visible on the stage (the console renders it); root tileset sessions last about 3 hours; the default quota is about 10,000 root tileset requests per day; tiles must not be cached or exported outside the terms.

## 6. The legacy replay console

Open `http://localhost:5173/console.html?mode=replay`. Mati loads from `/data/mati/`; choose Caldor to load `/data/caldor/`. The scenario menu reloads the console and clears the selected demo beat. The theme toggle persists locally; `?theme=team|fcc` overrides it for that page. Press `T` to switch themes in legacy replay.

Rebuild Mati with `node scripts/fetch-data.mjs --scenario mati` and check the reconstruction with `node scripts/check-mati.mjs`. The latter checks fitted historical consistency, not prediction accuracy. See `public/data/mati/README.md` for sources and limitations.

The disclaimer is always on screen: "Scenario built from public data; units, people and events are simulated."

### Demo Director

The Demo Director plays a scripted three-minute tour for judges, with scenario-specific captions. Start it with **Start demo** or `D`. It advances the replay clock, not real operations. All high-risk drafts wait for your approval click, including during the tour. The Director only reminds you; it never approves on your behalf.

| Time | Beat |
|---|---|
| 0:00 | Calm monitoring: brief, agent swarm working, ledger ticking. |
| 0:20 | Mati: ignition at Daou Penteli, simulated camera corroboration and Z0. Caldor: fictional hikers and a drone retask. |
| 1:00 | Mati: simulated evacuation ORDER, crew move and boats/EKAB resource draft. Caldor: archived wind shift and new model projection. Review and approve the drafts manually. |
| 1:40 | Mati: Marathonos crossing, simulated dashcam traffic blockage and route-update draft. Caldor: simulated propane hazard and OPS lens. |
| 2:10 | Mati: fictional people at the shore, drone confirmation and maritime rescue draft. Caldor: change brief. |
| 2:40 | Simulated work summary, reconstruction overlap and sourced historical facts. Time savings are illustrative estimates, not measurements. |

| Key | Action |
|---|---|
| `D` | Start or stop the Demo Director |
| `→` / `←` | Next / previous beat |
| `Space` | Pause or resume the replay clock |
| `1`–`4` | Role lens: IC, OPS, AIR, EMS |
| `T` | Toggle FCC / Team theme |
| `Esc` | Close drawers and popovers |

Captions, speed, autonomy and hold layout are controls in the command strip. Bindings are defined in `src/console/ui/**`; if one does not respond, check there.

For an offline basemap test, use `?tokens=0` (even with local credentials configured). `?tokens=ion` selects ion without Google. Google 3D rendering over Mati was verified on 2026-11-15 after a key was supplied. Prediction assumptions and limitations are in `src/console/orchestrator/PROJECTION.md`: archived future weather, reconstructed initial fire, no spotting, and on Mati a late head (about 20 min at Marathonos Ave and the coast from detection) with less than half the reconstructed area.

## 7. Rebuilding the scenario pack

The pack under `public/data/caldor/` is committed so the demo works offline. To rebuild it from the public sources:

```bash
node scripts/fetch-data.mjs
# with FIRMS hotspots instead of FEDS fire pixels:
FIRMS_MAP_KEY=your_key node scripts/fetch-data.mjs
```

Get a free FIRMS key at https://firms.modaps.eosdis.nasa.gov/api/map_key/. The script reads `FIRMS_MAP_KEY` from the environment (export it or prefix the command). It writes `manifest.json` (including `sources[]` with fetch times and licenses) and the raster and vector files, and prints what it could not fetch. See `public/data/caldor/README.md` for the file list and fallbacks.

Be polite to public endpoints (Overpass, Open-Meteo): the script fetches once and caches.

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| Stage shows the fallback terrain although a token is set | Restart the dev server after editing `.env.local`; check the token's Allowed URLs include `http://localhost:5173`. |
| Google tiles 403 | Map Tiles API not enabled, billing not linked, or referrer restriction missing `http://localhost:5173/*`. |
| Black stage | WebGL disabled; in Chrome check `chrome://gpu`. |
| Console says the scenario failed to load | `public/data/caldor/` missing; run `node scripts/fetch-data.mjs`. |

## 9. Install as a standalone app (PWA)

```bash
npm run build
npm run test:pwa
npm run preview -- --host localhost
# Open http://localhost:4173
```

Deploy the contents of `dist/` at the origin root over **HTTPS**. Localhost is also a secure context. Do not deploy `.env.local`; browser-prefixed provider credentials must be restricted to the actual website origin. The service worker is generated only by the production build, never registered by Vite development mode.

- **Chrome / Edge:** click **Install** in FCC when the native prompt is available, or use the address-bar install icon/browser menu.
- **Safari on Mac:** File → Add to Dock.
- **iPhone / iPad:** Share → Add to Home Screen, keeping Open as Web App enabled where offered.
- Launch the installed app from the Dock, desktop or home screen. It starts at `/console.html?source=pwa` in standalone mode, without a browser tab/address bar. An OS window title bar, mobile status bar or home indicator may remain; those are not controlled by a website.

The initial offline download is approximately **33.4 MiB / 418 local files** for this build, including both scenario packs, app/fonts and Cesium runtime. Allow it to finish online. The console, proposal and scenario switching then work offline. Google/ion streamed imagery, Google 3D and external APIs are deliberately **never** cached; use Outline or the local Satellite fallback offline. Revision archives are online-only. Browser storage can be evicted by the OS; reconnect and reinstall/reload if that happens.

Updates use a content-versioned cache. A new worker finishes downloading before activation; existing windows keep their version until closed, so an update never forcibly reloads a pending decision.

## 10. Appearance and globe controls

- FCC/Team chooses the accent and font. **Auto / Light / Dark** independently chooses appearance.
- Auto follows the replay sun in the console, not your local computer time. Dawn/dusk gradually blends the palettes; seeks and manual changes settle smoothly. Reduced motion applies the current target immediately. On the proposal, Auto follows your system appearance.
- Optional override: `?appearance=light`, `?appearance=dark`, or `?appearance=auto`. A URL override takes precedence on reload; remove it to use the saved `fcc.appearance` preference.
- **Outline / Satellite** appears at the top-right of the globe. Outline is monochrome DEM hillshade with metre-spaced contours, roads and basic incident overlays. Satellite loads configured Google/ion imagery or cached imagery. Provider imagery is current/archived as documented, not a live fire image.
- **Layers** independently controls contours, roads, approximate building marks, labels, units, findings, fire/perimeter, prediction bands, routes, coverage and Satellite smoke/atmosphere. Outline details are intentionally unavailable in Satellite mode. Reset restores the clean defaults. Hiding a layer does not acknowledge an alert or approve anything.
- Map preferences persist under `fcc.map`; camera feeds always retain their own imagery, telemetry and synthetic-sensor treatment.
