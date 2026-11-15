# FCC Orchestrator Spec (REV C)

The Orchestrator is the incident watch officer. Analysis agents report findings; the projection agent forecasts the fire; the Orchestrator decides **what the human sees, when, and where**, and drafts the work. This document is the attention model. Types are in `src/console/contracts.ts`; the implementation is `src/console/orchestrator/**`; the wire format is in `docs/BACKEND_CONTRACT.md`.

Contents

1. Goals
2. The score
3. Factors
4. Role lenses
5. Zones and capacities
6. Placement rules (hysteresis, dwell, bundling, fatigue, novelty, expiry)
7. Directives catalog
8. Hold layout
9. Autonomy levels and approvals
10. Drafts catalog
11. Explainability ("Why am I seeing this?")
12. Worked examples
13. Invariants and tests

---

## 1. Goals

1. **Calm by default.** On a quiet screen the 3D stage, the brief and the ledger are all that show. Every element on screen has earned its place.
2. **Never miss life safety.** A person or animal in the projected path interrupts within seconds, once, and stays until acknowledged.
3. **Turn findings into work.** Each important item comes with a drafted action (retask, move, notice, sitrep, order, rescue) ready to approve.
4. **Be explainable.** Every placement has a plain-language reason and the exact factors behind it.
5. **Deterministic.** Scoring and placement are pure functions of state, settings and time. Language models only write words.

## 2. The score

```
base   = 100 × severity × exposure × confidence × freshness × lens
score  = clamp(0, 100, base + corroboration + actionability + novelty − fatigue)
```

- The multiplicative part means any factor near zero sinks the item: a stale rumor of a fire in a place the fire will not reach scores low no matter how alarming it sounds.
- The additive part (−15 to +28 points) rewards items that are confirmed, that the user can act on, and that changed; and penalizes items the user already handled.
- Scores are recomputed on every relevant event (new finding, projection revision, action change, user attention change, settings change) and at least every 2 s of scenario time for freshness decay.

## 3. Factors

All factors are exposed in `ScoreFactors` and shown in the Why popover.

### 3.1 Severity (0..1), from the finding kind

| Finding kind | Class (`cls`) | Severity |
|---|---|---|
| `human` | life | 1.00 |
| `animal` | life | 0.85 |
| `combustible` (propane, fuel depot, explosives) | hazard | 0.75 |
| `structure` | hazard | 0.60 |
| `vehicle` (occupied or blocking egress) | hazard | 0.60 |
| `spot` (spot fire beyond the line) | hazard | 0.60 |
| `road-block` | movement | 0.50 |
| `fuel` (heavy brush, dead timber) | fuel | 0.40 |
| `water` (dip site, pond) | fuel | 0.30 |
| `smoke` and other information | status | 0.15 |

Projection items use severity 0.70 (class `projection`); action items inherit the severity of the item they serve; status items 0.15.

### 3.2 Exposure (0..1), from minutes to impact

Minutes to impact = time until the projected head (or nearest band edge) reaches the item position, from the latest `Projection`. Items already inside burned area use 0.2 unless `kind` is life (then 1.0).

| Minutes to impact | Exposure |
|---|---|
| < 30 | 1.00 |
| 30–60 | 0.85 |
| 60–180 (inside +3 h band) | 0.60 |
| 180–360 (inside +6 h band) | 0.30 |
| > 360 or outside all bands | 0.10 |

Between the breakpoints the implementation interpolates linearly so scores do not jump when a band edge passes.

### 3.3 Confidence (0..1)

`model confidence × source reliability`. Reliability by source: drone/ground/fixed cam 1.0, satellite 0.9, radio (agency traffic) 0.85, weather 0.9, web (news outlet) 0.75, social 0.55.

### 3.4 Freshness (0..1)

`freshness = 1` while `live`; otherwise `0.5 ^ (age / halfLife)`.

| Source | Half-life |
|---|---|
| Social | 15 min |
| Web / news | 20 min |
| Satellite | 40 min |
| Live feed, after it leaves the frame | 5 min |
| Radio | 10 min |
| Weather | 60 min |

A finding with freshness below **0.10** expires: it leaves every zone except Z5 (ledger/log) and its map glyph is removed. Non-live findings are drawn as approximate-location rings whose opacity follows freshness.

### 3.5 Lens (0.5..1.3)

The role-lens multiplier, see section 4.

### 3.6 Additive terms (points)

| Term | Range | Rule |
|---|---|---|
| Corroboration | 0..10 | +5 per independent source beyond the first (distinct `SourceKind`, or distinct feeds), max 10. |
| Actionability | 0..10 | 10 when a concrete drafted action exists and the needed units are available; 6 when an action exists but units are committed; 0 when nothing can be done. |
| Novelty | 0..8 | 8 when the item is new or materially changed since the user last saw it: confidence up by ≥ 0.15, uncertainty radius halved, ETA to impact shortened by ≥ 30 %, or count changed. Decays to 0 after the user has seen it (`markSeen`). |
| Fatigue | 0..15 | +5 per minute the item has been visible and seen without action, max 10; 15 when dismissed. Reset when the item materially changes (novelty fires). |

## 4. Role lenses

The console user picks a lens (`setLens`, keys `1`–`4`). The lens multiplies `base`. Unlisted combinations are 1.00.

| Lens | Boosted | Reduced | Intent |
|---|---|---|---|
| IC | — (all 1.00) | — | Balanced incident-wide picture |
| OPS | hazard ×1.20, movement ×1.20 | — | Structures, combustibles, crew and engine moves |
| AIR | drone, aircraft and spot-fire items ×1.25 | — | Recon, drops, airspace |
| EMS | life ×1.30 | fuel ×0.60 | People and animals, access routes |

The multiplier is clamped to 0.5..1.3 (`ScoreFactors.lens`). Lenses change ordering and zones but never hide a life-safety interrupt: a confirmed, live life item in the +1 h band has enough additive points (actionability + novelty) to stay at or above 85 under every lens.

## 5. Zones and capacities

The screen is an attention budget. `ZONE_CAPACITY` in `contracts.ts`:

| Zone | Capacity | Where on screen | Entry rule |
|---|---|---|---|
| `Z0_INTERRUPT` | 1 | Interrupt banner across the top of the stage, with sound cue optional | score ≥ 85 **and** (class `life`, or an imminent hazard: severity ≥ 0.75 and exposure 1.0) |
| `Z1_STAGE` | 1 | The 3D stage itself is framed on it (focusStage / promoteFeed) | the current Z0 item, else the top Z2/Z3 item when the Orchestrator directs the stage |
| `Z2_DECISION` | 3 | Decision cards (approve / edit / reject) | a proposed action with `requiresApproval` whose item scores ≥ 60, ordered by score |
| `Z3_FOCUS` | 3 | Focus list beside the stage, with reason line | score 60–84 |
| `Z4_AMBIENT` | 40 | Glyphs on the stage and the quiet list; no text until hovered | score 35–59 |
| `Z5_LEDGER` | ∞ | Ledger and log only | score < 35, expired, or dismissed |

Overflow: when a zone is full, the lowest-scoring member drops one zone and keeps a `prevZone`. Z0 overflow (two life items at once) is bundled (section 6.3) or queued: the second waits in Z3 marked "next interrupt" until the first is acknowledged.

## 6. Placement rules

### 6.1 Hysteresis

Once placed, an item moves to a higher zone only when its score exceeds that zone's threshold by **+5**, and to a lower zone only when it falls below its current zone's threshold by **−5**. Example: an item at 62 in Z3 stays in Z3 until it falls below 55; an item at 56 in Z4 moves up to Z3 only above 65. A new item is placed by the raw thresholds. The Z0 life rule is exempt from the +5 margin so that life safety is never delayed.

### 6.2 Dwell

An item stays in a zone for at least **8 s** of wall-clock time before it can be demoted (promotion is never delayed). Z0 stays until acknowledged (`acknowledge`), regardless of score, unless the item expires or is resolved (rescue done).

### 6.3 Bundling

Findings of the same class within **400 m** of each other, with overlapping time windows, are merged into a `bundle` item (`kind: 'bundle'`, `bundleOf: [ids]`). The bundle score is the max member score + 2 per extra member (max +6). Title: "3 structures · Sciaroni Rd". Opening the bundle shows members. Bundles keep the screen calm when a village is threatened.

### 6.4 Fatigue

See 3.6. Dismissed items get fatigue 15 and sink to Z5. They come back only if they materially change (novelty resets fatigue) and their new score beats the old one by 15 points.

### 6.5 Novelty

See 3.6. Novelty is the reason a known item re-surfaces briefly when it changes. The reason line says what changed ("ETA moved 40 min earlier").

### 6.6 Expiry

Freshness below 0.10 expires a finding (section 3.4). Actions expire when their `window.endMin` passes without a decision; the Orchestrator posts a message and may re-propose.

## 7. Directives catalog

The Orchestrator changes the screen only through `Directive`s, published as `ui.directive`.

| Kind | When the Orchestrator emits it | Rate limit |
|---|---|---|
| `focusStage` | New Z0; a Z3 item the user hovers or opens; projection revision with a large change (frame the bands) | ≤ 1 per 8 s unless Z0 |
| `promoteFeed` | Z0 or Z3 item has a live feed with it in frame | ≤ 1 per 15 s unless Z0 |
| `restoreStage` | Z0 acknowledged and no other item owns Z1; or 45 s after the last directive with nothing pending | — |
| `openPanel` | A draft is ready (`drafts`), autoscaling event (`agents`), user asks about work done (`ledger`) | ≤ 1 per 30 s |
| `highlight` | Every Z0/Z1 item: highlight the item, its units, route and safety zone | — |
| `dimOthers` | On with Z0, off on acknowledge | — |
| `requestDecision` | An action enters Z2 | — |
| `notify` | Relay to audiences: life items to EMS/AIR/law, evac notices to public (after approval), projection changes to IC/OPS | ≤ 1 per audience per 20 s, except life |

Every directive carries a `reason` that the UI may show as a toast ("Framing hikers against the +1 h band").

## 8. Hold layout

When `settings.holdLayout` is on, the user owns the screen. Directives are not applied; they appear as suggestions ("Orchestrator suggests: show HAWK-3 feed") that the user applies with `applyDirective(id)`. Exceptions: Z0 interrupts still show the banner (they do not move the camera or swap the stage), and `notify` relays still go out.

## 9. Autonomy levels and approvals

| Autonomy | The Orchestrator | Low-risk actions (`retask-drone`, `reproject`) | High-risk actions |
|---|---|---|---|
| `advise` | Grades, places, directs the screen, explains. Never acts. | Proposed only | Proposed only |
| `assist` (default) | Also prepares drafts and stages low-risk tasks | Wait for one-click approval | Require approval |
| `act` | Also executes low-risk tasks on its own and logs "Orchestrator did X · Undo" | Auto-executed (`action.decided` with `by: 'orchestrator'`) | Require approval |

Always require approval (`risk: 'high'`, `requiresApproval: true`), regardless of autonomy:

- `move-group` (moves people: crews, engines, dozers, aircraft)
- `evac-notice` (any public notice)
- `resource-order` (spends money and pulls resources from other incidents)
- `rescue` (commits people into the hazard)

`radio-script` and `sitrep` are documents: they are drafted automatically in `assist` and `act`, and relayed only on approval. Every autonomous execution appears in the ledger and can be undone (`undo`) while reversible; undoing a drone retask returns the drone to its previous sweep.

## 10. Drafts catalog

| Action kind | Draft format | Contents |
|---|---|---|
| `retask-drone` | — (summary only) | Unit, new task, orbit center and radius, altitude, sensor mode, duration, battery check |
| `move-group` | `order` | Units, from/to, route (via `nearestRoadPath`), time window, safety zone, trigger to abort |
| `evac-notice` | `evac-notice` | Zone id (e.g. EDC-GF-1), level (WARNING / ORDER), boundaries in plain words, routes out, shelter location, time issued, issuing authority placeholder, translations note |
| `radio-script` | `radio` | Channel, from/to callsigns, concise script in plain language, read-back request |
| `sitrep` | `ics209` | ICS-209 fields: incident name, size (acres), % containment, threat summary, projected spread, values at risk, resources, weather, next update |
| `resource-order` | `order` | Kind and type, quantity, reporting location, time needed, justification |
| `rescue` | `rescue` | Persons (count, description, no names), last seen position and time, assigned units, route in and out, safety zone, abort trigger |
| `reproject` | — | Reason, inputs changed, expected time |

Drafts are plain text with fields, editable before approval. They never contain real personal data in the demo.

## 11. Explainability ("Why am I seeing this?")

Every `GradedItem` has a `reason` line and its full `factors`. The Why popover shows:

1. The reason sentence: `Life · in +1H band (ETA 42 min) · conf 0.91 · 2 sources · rescue ready`.
2. The formula with the item's numbers: `100 × 1.00 × 0.85 × 0.91 × 1.00 × 1.00 = 77.4` and `+5 corroboration +10 actionability +8 novelty −0 fatigue = 100`.
3. The zone rule it met (`≥ 85 and life → Z0`) and, if relevant, why it is not higher (capacity, hysteresis, dwell).
4. Sources (`sourceIds`) with age and freshness.
5. Controls: pin, dismiss, "show less like this" (adds fatigue to the class for 10 min).

## 12. Worked examples

The examples use the reference tables above. Numbers in the running demo may differ slightly where the implementation tunes them; the structure is the same. Both the hikers and the propane tanks are beats of the Demo Director.

### 12.1 Hikers in the +1 h band → Z0

A social clip suggests two hikers near a trail below Grizzly Flats (approximate ring, fading). The Orchestrator retasks HAWK-3 (low-risk, auto-executed in Act); the drone's EO feed confirms two people. The projection says the head arrives in 42 min. Lens IC.

| Factor | Value | Why |
|---|---|---|
| severity | 1.00 | human |
| exposure | 0.85 | 42 min to impact |
| confidence | 0.91 | detector 0.91 × drone 1.0 |
| freshness | 1.00 | live |
| lens | 1.00 | IC |
| base | **77.4** | |
| corroboration | +5 | social clip + drone feed |
| actionability | +10 | rescue drafted, M-12 available |
| novelty | +8 | confidence jumped from 0.55 to 0.91 |
| fatigue | 0 | |
| **score** | **100** (clamped from 100.4) | |

≥ 85 and life → **Z0_INTERRUPT**. Directives: `promoteFeed` HAWK-3, `focusStage` on the trail, `highlight` hikers + M-12 + route + safety zone, `dimOthers` on, `notify` EMS and OPS, `requestDecision` on the rescue action (Z2). Under the EMS lens the base is 100.6 (clamped to 100). Without the corroborating clip and with novelty spent, the IC score would still be 87.4: the item stays in Z0 until acknowledged.

### 12.2 Propane tanks → Z3 for OPS, Z4 for IC

E-41's dash cam passes a residence with two large propane tanks; the +3 h band covers it (ETA about 2 h). An OSM tag corroborates. The frame was 4 min ago (freshness 0.90 after leaving the frame).

| Factor | OPS | IC |
|---|---|---|
| severity | 0.75 | 0.75 |
| exposure | 0.60 | 0.60 |
| confidence | 0.85 | 0.85 |
| freshness | 0.90 | 0.90 |
| lens | 1.20 | 1.00 |
| base | 41.3 | 34.4 |
| corroboration | +5 | +5 |
| actionability | +8 | +8 |
| novelty | +8 | +8 |
| **score** | **62.3 → Z3_FOCUS** | **55.4 → Z4_AMBIENT** |

For OPS the item shows in the focus list with a drafted structure-protection `move-group` (E-41 to the residence, 20-minute window) and a relay to nearby units only. For IC it is a glyph on the stage. Switching the lens re-ranks immediately; the Director does this on purpose. After OPS has seen it, novelty decays and the score is 54.3, under the 55 hysteresis line: after the 8 s dwell it returns to Z4 and the drafted move stays in Drafts.

### 12.3 Heavy brush → Z4

The satellite pool flags dense brush on a south aspect inside the +3 h band. Lens IC.

| Factor | Value |
|---|---|
| severity | 0.40 (fuel) |
| exposure | 0.60 |
| confidence | 0.70 (satellite 0.9 × model 0.78) |
| freshness | 0.80 (satellite, 13 min old) |
| lens | 1.00 |
| base | 13.4 |
| corroboration | +5 (fuels raster agrees) |
| actionability | +10 (dozer line drafted) |
| novelty | +8 |
| **score** | **36.4 → Z4_AMBIENT** |

An ambient glyph with a dozer-line suggestion on hover. It never interrupts; once seen (novelty 0) it scores 28.4 and drops to Z5 below the 30 hysteresis line, and it fades out as the satellite pass ages. Under EMS (fuel ×0.60) it starts in Z5 at 31.1.

## 13. Invariants and tests

1. At most one item is in Z0; at most `ZONE_CAPACITY[z]` items are in each zone.
2. A life finding with exposure ≥ 0.85, confidence ≥ 0.8 and freshness ≥ 0.9 reaches Z0 within one grading cycle under every lens.
3. No action with `risk: 'high'` reaches `executing` without an `action.decided` `approved` by `user`.
4. Same inputs, same settings, same time → same zones (determinism).
5. With `holdLayout` on, no directive except `notify` changes `state.stage`.
6. Expired findings (freshness < 0.10) are in Z5 only.
7. Every `GradedItem.reason` is non-empty and every directive has a `reason`.
