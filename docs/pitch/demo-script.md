# FIREYE: two-minute resident demo

Simulation of Mati 2018, not official evacuation advice or validated forecasting. Follow **112 / civil protection**. All timings below are presenter targets, not measured performance.

## Click-by-click demo — 2 minutes

1. **0:00–0:15 — Open on a phone.** Visit <https://nikolas-sapa.github.io/FIREYE/console.html?view=civilian>. Say: “FIREYE helps residents understand where the fire is and what it means for their location.” Point out the simulation label, fire and home framing. The demo starts after ignition; show **LEAVE NOW** when the selected location reaches that simulated stage. Do not imply every location starts there.
2. **0:15–0:35 — Choose a location.** Select **Kokkino Limanaki**. Point to Fire ETA and Leave by: the latter subtracts a fixed 45-minute preparation buffer, not permission to wait. Open the route choices. Show **Balanced**, the default, and its **+1 min** comparison if displayed in this replay state; the number can change with time/location, so read the actual value rather than promise it.
3. **0:35–0:55 — Compare routes.** Tap **Fastest**, then **Safest**, then **Balanced**. Explain: “Balanced seeks lower simulated risk within 1.4× the fastest drive time. The search checks when fire and resident reach each road segment, aiming for a 15-minute margin; a smaller available margin is warned about.” These are prototype comparisons, not proven safe routes.
4. **0:55–1:15 — Hand off.** Tap **Open in Google Maps**. Show the selected origin, exit and steering waypoints. Say: “Google Maps may recalculate and does not receive the simulated fire.” Return to FIREYE. Optional embedded preview needs a configured, restricted Maps key; the external handoff does not.
5. **1:15–1:35 — Enable updates.** Tap **Enable alerts** and accept browser permission if offered. Explain that supported devices can notify, vibrate or speak simulated stage increases. Browser/OS support varies; this is not a real 112 message, SMS or phone call. Do not promise an immediate notification.
6. **1:35–2:00 — Ask Chief.** Open Chief and ask **“Which route?”** or use its question chip. Show the scripted exercise answer alongside the route choices. State that this is deterministic guidance about a simulation, not live AI or official advice.

**Optional local responder extension, outside the two minutes:** use Node ≥24; first run `npm ci --ignore-scripts` in both `backend` and `proposal/fcc`, then `npm run dev:full` from `proposal/fcc`. Open `http://localhost:5173/console.html?view=responder`, review and approve a finite drone task, then inspect the backend-received receipt in Crew (`?mode=crew`) using the local reader capability handoff. Crew access is manual and reader-only. This loop moves simulated drones only; it is not hosted on Pages. See the [local exercise contract](../../proposal/fcc/docs/BACKEND_CONTRACT.md).

## Roadmap pitch — 60 seconds, plans only

“Our next step is a resident pilot in East Attica, subject to partners and approval. We plan attributed FIRMS, wind and official 112 data integration, then validation on **five or more past fires** before making operational claims. We want Greek voice calls for elderly residents, mobility-aware profiles, ‘I'm safe’ check-ins, tourist languages and offline mode. These are plans, not delivered capabilities. Any SMS or cell-broadcast emergency channel would be through an authorized **112** partnership, never independent public alarms. Our proposed business model is free access for residents, funded by municipalities, regions or insurers. Validation, data rights, privacy and official coordination come before rollout.”

## Backup

- Record a fallback video in advance; label its source/replay state.
- Play forward, not rewind: seek/rewind currently changes drone positions and alert history.
- If cached UI looks stale, reload once. If unavailable, use the video; do not improvise claims.
- Keep the disclaimer visible. Never recommend shelter-in-place.
