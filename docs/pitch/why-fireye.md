# Why FIREYE

## The problem

The 23 July 2018 Mati wildfire in East Attica reached residential areas and the coast with devastating consequences. We use this well-documented event to demonstrate a resident information problem: a fire map alone does not tell someone what the changing picture means for their location. We do not claim this prototype could have prevented historical deaths.

## The solution

FIREYE is a resident wildfire information app. Its Mati simulation connects fire location, a selected resident location, one clear exercise instruction, a leave-by target and a prototype route. The stages are **MONITOR**, **PREPARE TO LEAVE**, **LEAVE NOW**, or **“Fire very close: follow 112 instructions now.”** Chief/Scout/orchestrator updates and resident answers are scripted; deterministic rules choose the safety wording. AI's intended role is explanation, not issuing evacuation orders.

## Phone demo

Open [Civilian view](https://nikolas-sapa.github.io/FIREYE/console.html?view=civilian).

1. Select Mati or another preset; alternatively enter a pack place/road name or coordinates inside the exercise area. A preset works when your phone is elsewhere.
2. Advance the replay to see the simulated fire, current stage, fire ETA and **Leave by**. The target is ETA minus a fixed 45 minutes, not permission to wait.
3. When a route is available, show its destination and roads, then tap **Open in Google Maps**. Return and ask the resident chat, “When should I leave?” or “Which route should I take?”

## Why more than a map and chatbot?

- **Time-aware routing:** Fastest, Safest and a default Balanced route (lowest simulated risk within 1.4× fastest). Road segments the simulated fire reaches before the resident would pass (plus a 15-minute margin) are skipped; the trade-off is shown, e.g. “+1 min vs fastest”. The Maps link carries the chosen exit and steering waypoints; Google does not receive the simulated fire and may recalculate. Nominal speeds, not validated.
- **Grounded demonstration:** real terrain, attributed imagery, OSM roads and historical Mati anchors. Current roads are not a 2018 snapshot; fitted reconstruction is not independently validated forecasting.
- **Evidence and control:** simulated drone EO/thermal, fixed cameras and sensors form one exercise picture. Evidence/feed records retain sources, clocks, uncertainty fields and simulated flags. Thermal is false-color, not temperature measurement. Local Ops drone execution requires backend-enforced human approval; this separate local path is unavailable on Pages. Recon tasking remains browser simulation.
- **Accessible entry:** a keyless web demo with installable PWA support on compatible browsers.

## The moat to earn

A maintained Greek road graph, curated fire replays, historical-fire validation and the safety/approval architecture matter beyond the interface. A rights-cleared camera catalog and Civil Protection / 112 partnerships would deepen that foundation. The [docs/data catalog](../data/greece-public-cameras.md) is inactive research with unresolved rights, not cleared feeds. No such partnerships are claimed today.

## Roadmap — all future, not implemented

Greek voice-agent phone calls for elderly residents and people without smartphones, plus relatives/volunteers; mobility/no-car profiles with earlier alerts and location-bearing “I need help”; family “I'm safe” check-in; tourist languages; official SMS/cell broadcast only through authorized 112 partners; live FIRMS hotspots and wind, with news/social marked unverified (GDELT/Firecrawl); real drones only with authorities; validation against more historical fires.

## Honest limits

Simulation, not official advice: follow **112 / civil protection**. Routes are unvalidated; Google may recalculate them. No real alerts, SMS or phone calls are sent to residents. Optional browser notifications/speech are exercise-only. The public demo has no deployed backend or live AI inference.
