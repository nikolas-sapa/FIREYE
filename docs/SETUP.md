# FCC Setup (REV D)

How to run the proposal site and full-screen console, add optional credentials, and rebuild the Mati or Caldor scenario pack.

Every token is optional. Without tokens the console still runs: the 3D stage uses a heightmap built from the scenario pack (`pack.elevation`) and the offline imagery mosaic or NASA GIBS imagery, which needs no key.

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
| `http://localhost:5173/console.html` | Full-screen console: Mati 2018 reconstruction. |
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
| `FIRMS_MAP_KEY` | `scripts/fetch-data.mjs` only | Fetch real FIRMS hotspots (with real FRP and confidence) instead of NASA FEDS fire pixels with synthesized FRP. Never exposed to the browser (no `VITE_` prefix). |

Variables prefixed with `VITE_` are embedded in the client bundle. Treat them as public and restrict them as described below.

The console's status bar shows which providers are active (for example `CESIUM ION · ON`, `GOOGLE 3D · OFF`), from `getStageCapabilities()`.

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

## 6. The console

Open `http://localhost:5173/console.html`. Mati loads from `/data/mati/`; choose Caldor to load `/data/caldor/`. The scenario menu reloads the console and clears the selected demo beat. The theme toggle persists locally; `?theme=team|fcc` overrides it for that page. Press `T` to switch themes.

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

For an offline basemap test, use `?tokens=0` (even with local credentials configured). `?tokens=ion` selects ion without Google. Google 3D coverage has not been verified. Prediction assumptions and limitations are in `src/console/orchestrator/PROJECTION.md`: archived future weather, reconstructed initial fire, no spotting, and substantial underprediction of Mati's speed.

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
