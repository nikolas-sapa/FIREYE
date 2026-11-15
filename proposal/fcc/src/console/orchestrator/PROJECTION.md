# Projection agent: spread model and prediction checks

This note documents the fire-spread model behind `Projection` (bands, head, `etaToPlaces`) and the
prediction checks the console scores against the replay. Code: `src/console/agents/spread.ts` (model),
`src/console/agents/projection.ts` (bands, ETAs, revisions), `src/console/agents/predictions.ts` (checks).
The proposal's image lab runs the same solver (`runTravelTime`) on open-data Greek landscapes; see
[`docs/IMAGE_LAB.md`](../../../docs/IMAGE_LAB.md).

## What the model may read

At issue time `t` the model reads only:

- the DEM (`pack.elevation`) and the fuel classes (`pack.fuel`);
- the fire state at `t`: raster cells whose replay arrival is at or before `t` (`arrival <= t - start`);
- weather (`pack.weather`), see "Weather" below.

It never reads arrival times after `t`, perimeters, hotspots after `t`, checkpoints, reports or facts.
`modelEtaMin` (used by grading, rules and the conversation) treats "already burned at `t`" as an
observation and takes everything later from the model field. Story timing in the scenario scripts (when
the Demo Director jumps, where fictional people are placed) may use the replay; the projection, its
ETAs and the Orchestrator's evacuation triggers do not.

For Mati the replay arrival raster is itself a reconstruction fitted to documented anchors and the EFFIS
final burnt area (see `public/data/mati/README.md`). The model's seed at `t` is therefore the
reconstructed fire at `t`, and the IoU below is agreement with that reconstruction, not with an
independently observed perimeter.

## Grid and solver

- The pack raster is coarsened by an integer stride so the grid has at most about 100,000 cells
  (Caldor: stride 3, 334 x 278 cells of about 120 m; Mati: stride 3, 264 x 222 cells of about 60 m).
  Each coarse cell takes the fuel and elevation of its centre fine cell and the earliest arrival of any
  fine cell inside it.
- Minimum travel time (Dijkstra) with a 16-neighbour stencil (8 neighbours plus knight moves) to reduce
  grid-direction bias. Burned cells at `t` get time 0; only burned cells on the edge that burned within
  the last 12 h ignite neighbours (`ACTIVE_EDGE_MIN`, a typical satellite active-fire window).
- Horizon 360 min. One run takes about 4 to 20 ms on both packs (see "Timings").

## Fire behaviour relations

Rates are head rates of spread (ROS) per fuel class; spread in other directions follows an ellipse.

| Fuel class | Head ROS | Source |
|---|---|---|
| Grass | Cheney, Gould & Catchpole (1998) natural pasture: 0.054 + 0.269 U (U >= 5 km/h), 0.054 + 0.209 U below, km/h, times the Cheney moisture coefficient exp(-0.108 M) for M < 12 % | Cheney et al. 1998, Int. J. Wildland Fire 8 |
| Agriculture | Grass x 0.5 | Labelled assumption (patchy, partly irrigated or harvested fields) |
| Shrub, TimberUnderstory | 10 % wind rule: ROS = 0.1 x U10 (same units), damped by exp(-0.108 (M - 6)) above 6 % fine fuel moisture | Cruz & Alexander (2019), Int. J. Wildland Fire 28 |
| TimberLitter | 10 % rule x 0.5 | Labelled assumption (surface fire in litter under a canopy) |
| Urban | 10 % rule x 0.5 | Labelled assumption (structure-to-structure spread slower than open fuels) |
| Water, rock, none | 0 | |

- Fine dead fuel moisture M (%): Simard (1968) equilibrium moisture content from temperature and RH.
- Length-to-breadth ratio: McArthur (1966) grass LB = 1.1 U^0.464 (U >= 5 km/h); forest and shrub
  LB = 1 + 0.0012 U^2.154 (Alexander 1985); capped at 8. Directional rate from the ellipse:
  R(theta) = R_head (1 - e) / (1 - e cos(theta - downwind)), e = sqrt(1 - 1/LB^2).
- Slope: Forestry Canada FBP slope factor exp(3.533 (tan slope)^1.2), slope capped at 60 %, upslope only.
- U is the 10 m wind (km/h) from the pack weather. Gusts are not used.

None of these constants were fitted to either fire. See "Changes" for a variant that was tried and dropped.

## Weather

- The model uses the pack's hourly weather (`weatherAt`) as its forecast, one rate table per model hour.
  This is a perfect-forecast assumption: archived hourly weather (Open-Meteo archive for Caldor, the
  pack's hourly series for Mati) stands in for the forecast an incident team would have had.
- Caldor: until the scenario's forecast ingest time (`ctx.tShift`, T0 + 60 min) the model holds the
  issue-time observation constant (persistence), then switches to the hourly series. Mati has no shift
  (`tShift = null`) and uses the hourly series from detection.

## Outputs

- Bands at 60, 180 and 360 min: radial envelopes (96 bearings) of the modelled field around the burned
  centroid, smoothed; confidence 0.8, 0.6, 0.4.
- Head direction and ROS: the bearing with the largest +60 min growth, and that growth / 60.
- `etaToPlaces`: earliest modelled arrival within 600 m of each manifest place; places outside the
  horizon are omitted.
- Evacuation triggers use the zone ETA: the earliest of the primary community and the scenario's
  `zonePlaceIds` (Mati: Neos Voutzas). Thresholds are scenario policy, not model properties: Caldor
  WARNING at 240 min and ORDER at 180 min, Mati ORDER at 150 min (no WARNING stage).

## Prediction checks

Each projection revision issues, when none is pending for that horizon, a +30 min and a +60 min check,
and the first revision with documented checkpoints ahead also issues one checkpoint check whose horizon
reaches the last checkpoint in its 6 h window ("to the coast" for Mati). A check stores the predicted
burned mask at issue. When the clock passes the target time it is scored:

- IoU of predicted and replay burned cells on the model grid, plus IoU of new growth only (cells not
  burned at issue). For Mati this is agreement with the reconstruction.
- Predicted and replay burned area (ha).
- For each documented checkpoint in (issue, target]: modelled arrival within 200 m of the checkpoint
  (or its place) versus the documented time, error in minutes (positive = model late). Checkpoints
  already inside the model's seed at issue are dropped, so a nearby burned cell cannot count as an
  on-time arrival.

A scored check is published as the bus event `prediction.scored`, said by the Orchestrator, written to
the ledger and noted in "What changed". Checks live in `state.predictions` (newest first, at most 16).
The final-perimeter comparison (EFFIS / CAL FIRE final) is not part of these checks.

## Results (scratch runs of the 3-minute Demo Director)

Re-run on 2026-11-15 after the solver fix listed under Changes; the pre-fix value follows each number in
brackets. Reproduce with `npm test`, which prints the scored checks of both tours.

Mati (issue time, horizon: IoU vs reconstruction; predicted vs replay area; checkpoint errors):

| Check | IoU | Area pred / replay (ha) | Checkpoints (model minus documented) |
|---|---|---|---|
| rev 1, 16:43, +30 | 0.30 [0.36] | 73 [21] / 56 | none in window |
| rev 1, 16:43, +60 | 0.40 [0.19] | 177 [56] / 289 | NV west edge -33 [+74] min |
| rev 1, 16:43, to coast (+122) | 0.37 [0.12] | 476 [164] / 1,248 | NV west edge -33 [+74], Neos Voutzas -30 [+101], Marathonos +19 [+128], coast +23 [+178] min |
| rev 4, 17:24, +30 | 0.63 [0.44] | 282 [200] / 436 | NV west edge -4 [+22] min |
| rev 5, 17:44, +60 | 0.53 [0.40] | 687 [518] / 1,239 | Neos Voutzas +10 [+14], Marathonos +17 [+60] min |
| rev 6, 18:05, +30 | 0.71 [0.63] | 811 [719] / 1,061 | Marathonos +3 [+16] min |

From detection the model now reaches the west edge of Neos Voutzas about 30 min early, but Marathonos
Ave and the coast about 20 min late, and by the coast time it has burned less than half the
reconstructed area. The Director's ignition caption (Marathonos Ave site, 300 m radius) reads about 64 min
to the road and 128 min to the sea [224 and 314]. Remaining likely causes of the late head and small area:
no ember spotting, 10 m mean wind without gusts (gusts reached about 74 km/h), and coarse fuel classes.
The reconstruction itself was built with a fitted travel-time model, so agreement with it is not
independent skill; the sourced checkpoint times are the more meaningful comparison.

Caldor: +30 min IoU 0.78 to 0.81 [0.80 to 0.82], +60 min IoU 0.61 [0.66]; growth-only IoU 0.11 to 0.23
[0.13 to 0.24]. The fix makes Caldor slightly worse: the model already over-predicted area (3,426 [3,172]
vs 2,128 ha at +60) yet is still late reaching Grizzly Flats (at the 16:59 PDT revision, model ETA about
190 [198] min against a replay arrival about 104 min after issue), again consistent with missing spotting.

Spread-model sweep, eight issue times at ninths of each pack's span, IoU vs replay:
Caldor +30 0.78 to 0.90 [0.82 to 0.92], +60 0.60 to 0.82 [0.66 to 0.85], +180 0.32 to 0.57 [0.37 to 0.62],
+360 0.24 to 0.38 [0.27 to 0.44]. Mati +30 0.49 to 0.90 [0.46 to 0.90], +60 0.48 to 0.81 [0.23 to 0.86],
+180 0.60 to 0.85 [0.32 to 0.75].

## Known limitation: narrow fires at high wind

The 16-neighbour stencil resolves directions only to about 26.6° near the head. Above about 30 km/h
(shrub and forest LB above about 3) almost every stencil direction except straight downwind becomes very
slow, so modelled area at a fixed time stops growing with wind and even falls (uniform flat shrub, 32 °C,
20 % RH, 60 min: 1,206 cells at 30 km/h, 723 at 60 km/h) while the head still advances at the full rate.
Area and flank width are therefore under-represented in strong wind; head arrival times are not affected.
A larger stencil would fix it and is a model change, not yet made.

## Timings

One `runSpread` call: in the sweep above, mean 12 ms and worst 16 ms on Caldor, mean 3 ms and worst 4 ms on
Mati (Node, Apple silicon), under the 50 ms budget. Demo Director goto to
any beat (measured before the fix, not re-measured): Caldor up to about 160 ms, Mati up to about 310 ms.

## Changes

- 2026-11-15: fixed a solver bug. Arrival times are stored in a `Float32Array` but heap keys are float64;
  when a time rounded down on storage, the stale-entry test (`tc > T[i]`) skipped the cell's own fresh
  entry, so the front stalled at random cells and spread was slowed by roughly 1.2 to 2.7 times in burned
  area. The test now compares in float32. This is a correctness fix found by a wind-response unit test in
  the image lab (uniform shrub, stronger wind burned less), not a change tuned to these results. All
  numbers above were re-run; pre-fix values are in brackets.
- REV D: replaced the replay-derived projection (pack arrival scaled by a bias) with this model.
- Tried and dropped: a crowning threshold for TimberLitter (full 10 % rule when M <= 5 % and
  U10 >= 25 km/h), added after the first Mati run. It changed Mati IoU by at most 0.06 and Caldor not at
  all, and would have been a change made after seeing the results, so it was removed.
- Checkpoint search radius capped at 200 m and checkpoints already inside the seed dropped, after the
  first run showed 500 m rings scoring "on time" from fire that was already nearby at issue.
