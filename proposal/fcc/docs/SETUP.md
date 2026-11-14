# FCC Setup (REV C)

How to run the proposal site and the full-screen console, add the optional Cesium ion and Google tokens, and rebuild the Caldor scenario pack.

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
| `http://localhost:5173/` | The proposal site (REV C). |
| `http://localhost:5173/console.html` | The full-screen console: Caldor Fire 2021 replay. |
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

Open `http://localhost:5173/console.html`. The scenario loads from `/data/caldor/`, then the replay clock starts.

The disclaimer is always on screen: "Scenario built from public data; units, people and events are simulated."

### Demo Director

The Demo Director plays a scripted three-minute tour for judges, with captions. It controls the replay clock so the story lines up with the real fire timeline (Grizzly Flats threatened on the evening of Aug 16, 2021). Start it with **Start demo** in the command strip or the `D` key.

| Time | Beat |
|---|---|
| 0:00 | Calm monitoring: brief, agent swarm working, ledger ticking. |
| 0:20 | A social clip suggests two hikers; the Orchestrator retasks HAWK-3; the drone feed is promoted to the stage and confirms them; life-safety interrupt; EMS and OPS notified; rescue drafted for approval. |
| 1:00 | Wind shift from the real weather archive; the projection agent re-projects (ghost of the previous bands); head reaches Grizzly Flats in about 90 min; evacuation ORDER and crew move drafted and approved. |
| 1:40 | E-41's dash cam spots propane tanks; hazard relayed only to nearby units; the lens switches to OPS to show re-ranking. |
| 2:10 | "What changed in the last 10 minutes?" is asked and answered. |
| 2:40 | Agent Work Ledger summary: work done and analyst minutes saved. |

| Key | Action |
|---|---|
| `D` | Start or stop the Demo Director |
| `→` / `←` | Next / previous beat |
| `Space` | Pause or resume the replay clock |
| `1`–`4` | Role lens: IC, OPS, AIR, EMS |
| `Esc` | Close drawers and popovers |

Captions, speed, autonomy and hold layout are controls in the command strip. Bindings are defined in `src/console/ui/**`; if one does not respond, check there.

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
