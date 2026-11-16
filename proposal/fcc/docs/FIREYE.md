# FIREYE incident console

FIREYE opens at `/console.html?mode=fireye`. Plain `/console.html` keeps current main's Ops view. It is a simulated command-console exercise built on the Mati, Greece, 23 July 2018 reconstruction. The timeline scrubs freely from 14:00 to 22:00 local time (11:00–19:00Z). Units, radio traffic, IoT sensors, agent work and thermal imagery are simulated. Historical reports are real, attributed and untrusted. Nothing here is an emergency warning service.

## Routes

| URL on `/console.html` | View |
|---|---|
| none | Ops (current-main default) |
| `?mode=fireye` | FIREYE reconnaissance (Mati exercise) |
| `?mode=crew` | Isolated received-only exercise reader, no local simulator |
| `?mode=monitoring` | Real-data monitoring (see `MONITORING.md`) |
| `?mode=replay`, `?scenario=…`, `?beat=…` | Legacy simulated replay |
| `?mode=fireye&t=HH:MM` | Start FIREYE at a local time |
| `?paused=1` | Start paused |
| `?boot=0` | Skip the boot sequence |
| `?appearance=auto\|light\|dark` | Monitoring/replay appearance override; FIREYE stays dark |

FIREYE uses the FCC theme. Ops keeps its Team theme.

The mark is two hairline lids around a signal-orange diamond pupil (`FireyeMark`). One 96 px eye sits at the screen center in a 48 px header, half overflowing below it. It blinks occasionally and briefly looks down-left/right when a new drone command arrives. A compact message card connects below the eye without repeating its avatar. Clicking the eye opens the Orchestrator chat. There is no ORCH/count box. See proposal section 06 (`/#identity`).

## Layout

The map begins below the solid 48 px header. A matching header-coloured backing follows the centered eye's lower-lid contour, with 12 px padding beyond the visible mark, so the header appears shaped around the logo. There is no fade or transparent-center header. Time/date, local/Zulu clocks and EXERCISE · SIM sit left; incident details, EO/THRM, Legend and Layers sit right. The FIREYE eye stays centered independently of the side panels. Appearance and satellite/outline toggles are absent.

Left: the **Fleet** directory defaults to a 104 px, two-column rail. Square tiles retain drone battery/callsign, station, camera and source identities. Hover or keyboard focus expands details horizontally over the map without resizing it. Drone/camera clicks open their feed; source/station clicks open a larger analysis and decision-flow popup. Expanding Fleet to 220 px (200–300 px) exposes per-feed Flow and Locate actions and sensor details. Source history distinguishes intake, analysis jobs, recorded Orchestrator tasking and execution, with honest evidence links and no hidden reasoning. Popups trap keyboard focus and close with Escape.

Centre: satellite globe or a dived feed. Right: INTAKE and OPS log. Bottom: one continuous horizontally scrolling feed row and the timeline. All tiles share one height; available feeds sort by exact descending Orchestrator relevance, stable ID ties, then offline/reserve sources. Relevance scores and honest live/total counts remain visible. Trackpad/scrollbar, keyboard scrolling and left/right buttons expose the rest without a second row or duplicated feeds. The panels retain drag handles, collapse buttons and keyboard resizing. Sizes persist in `fireye.layout.recon`; migration preserves the old right/bottom sizes but resets Fleet to compact/collapsed.

The deck contains 12 distinct EO/thermal drone channels (six drones) and eight fixed CCTV/terrain cameras, 20 registered channels across 14 physical sources, including Neos Voutzas, Mati, Kallitechnoupoli, Kokkino Limanaki, Rafina and Nea Makri. Drone video is offline on a station pad, while charging and below takeoff camera altitude; it never substitutes archive imagery. There are no satellite, dash, helmet or social feeds, no ground fleet/helicopters/airplanes, and no flight paths, route lines or altitude stems, including in the Everything preset. Historical satellite/social/radio **information** remains in INTAKE, distinct from live video sources.

Keys: `Space` play/pause, `Esc` exit dive, close a panel, chat or selection, `T` thermal, `L` legend, `V` visibility, `H` home, `O` orbit, `1`/`2` INTAKE/OPS log tab, `/` open the orchestrator chat.

## Presentation boot

The large centered eye opens from a horizontal outline and signal line, then moves to the measured header eye. Source icons appear strictly one at a time: Terrain, Fuel, Roads, Weather on the left, then Drone, Sensor, Radio, Camera on the right. Each appears in the center, holds for 100 ms, and moves quickly to its assigned side while fading out over 260 ms. They do not accumulate or appear together. Only “Simulation build” remains as visible loading text.

The dashboard, map and feed surfaces preload at their final sizes behind the loader. The map permanently fills the full area below the 48 px header, including underneath all panel slots. Static overscan framing preserves the panel-free view's scale and center, with both stations still visible; measured panel bounds position the HUD, attribution and feed controls without shrinking the canvas. Next the loading field fades out over 700 ms while the map makes a short 1.8 s approach from a view only 35% wider than the goal frame. The off-screen feed wall pauses for this approach. Both the goal heading and tilt stay fixed; range changes logarithmically with a smooth start/stop, no orbital view or competing camera flight. Large frame delays are capped and hidden tabs do not advance the camera. Only after arrival do Fleet, log, feeds and timeline slide over the map. Neither canvas size nor framing changes for panel entrances. The exercise stays at its requested start time until the reveal is complete.

The nearby view warms under the opaque loader and uses the normal local basemap and atmosphere throughout. No Earth overview imagery is added. Hidden data sources and camera-input settings are restored on completion or cancellation; EO/thermal feed rendering is unchanged.

Escape/click skips the choreography, and reduced motion uses a static eye and immediate final camera view once required data is available. `?boot=0` bypasses the loader entirely. Graphics failure has a bounded grace period, but missing scenario/source data cannot be declared ready by a timer. A delayed required load offers Retry. The underlying dashboard is inert and hidden from accessibility APIs until handoff; focus then moves to the real header eye.

## Data model (`src/console/fireye/data/`)

- `chronicle.ts`: deterministic source/analysis track (radio script, IoT triggers, historical reports, satellite detections and analysis). Entries appear only when `t <= playhead`. IoT debounce uses current and previous samples, never a future sample. No scripted fleet commands, dispatch, approvals or synthetic projection updates.
- `world/recon.ts`: FIREYE-only tasking and important-event track, exposed as optional `ConsoleState.recon`. Every seek rebuilds from scenario start, independently of prior scrub history. The latest 60 tasks and 240 events are retained; this is not a complete audit archive.
- `world/drone-stations.ts`: home stations, bounded takeoff/flight/return/landing and on-pad recharge. Battery capacity and recharge rates are illustrative, not aircraft specifications.
- `source-flow.ts`: joins retained observations, jobs, findings and commands using recorded source references. It never assigns aggregate pool jobs to an individual camera or invents causal links.
- `sensors.ts`: 24 seeded IoT nodes (weather, fuel moisture, air quality, IR flame) around Daou, Penteli, Neos Voutzas, Mati and Kokkino Limanaki. Readings are pure functions of ERA5 hourly weather, the fire field at `t`, downwind smoke and seeded noise.
- `risk.ts`: sector ignition-risk index from weather and sensor readings. It never reads future arrival times or perimeters.
- `comms.ts`: fictional callsigns (Fire Ops Attica, Police East Attica, EKAB EMS, Coast Guard VHF16, Air Ops). No victim content.
- `fleet.ts`: `simFleet` advertises actual registered channel IDs from the runtime. The separate `?mode=crew` page uses the validated GET-only `CrewStore`; the compatibility `BridgeFleetSource` delegates to that same store. Initial reads have no cursor; subsequent reads long-poll `GET /incidents/:id/snapshot?after_revision&wait_ms=10000`. The reader capability is typed at runtime and kept in memory, never storage or the URL. Chief and producer credentials are never bundled or requested. Positions remain unmapped because the backend reports `coordinate_frame: null`. Media is unavailable, not a local simulated fallback. Status unions match the backend verbatim.

The wire shapes are in `contracts.ts` (`SensorNode`, `SensorSample`, `ChronicleRecord`, bus `sensor.reading` / `sensor.triggered`) and in `BACKEND_CONTRACT.md`.

## Stage

FIREYE mounts the existing `StageView` and adds:

- `stage3d/thermal.ts`: Normal/Thermal. Simulated white-hot post-process from the fire-heat field, labelled "SIMULATED THERMAL · NOT RADIOMETRIC".
- `stage3d/sensors-layer.ts`: ground sensors as small status-coloured dots (5 px normal, 7 px alarm, 9 px selected), with labels/details only on selection. Fixed cameras retain camera glyphs. North/south stations use battery glyphs and on-pad counts. Both fit the initial home view. Fixed-camera footprints are optional and off by default.
- `stage3d/camera-ops.ts`: zoom, tilt, heading, north-up, home, 2D/3D, orbit and `diveTo(feedPose)`.

The dive sequence locks brackets onto the target (about 200 ms), flies the main camera to the drone sensor pose (about 1.8 s), runs a 350 ms scanline wipe, then suspends globe rendering behind the full feed. Offline drones skip the camera flight and show an explicit unavailable state. The return button and feed toolbar start at screen y=112, 16 px below the full eye, and wrap rather than hiding the button at narrow widths. Exit reverses the handoff. Reduced motion uses a crossfade. EO FX/IR FX changes only display palette, not source identity. FIREYE opts into World3D with reconstructed fire at stage time; `?feeds=cesium` or WebGL failure uses the Cesium fallback. Procedural scenery is simulated, not measured vegetation or observed incident footage.

Every drone has distinct EO and thermal channels in the feed deck. EO FX/IR FX changes only display palette, never channel ID, label or source modality. The full-feed HUD identifies source modality separately and offers opt-in local PNG/metadata capture after a successful fresh render. Captures reject stale, disconnected, mismatched-transform and truth-overlay surfaces; they contain no detector labels or truth masks. See `BACKEND_CONTRACT.md` for the local-only format and `FRONTEND_ISSUES.md` for remaining acceptance gates.

## Reconnaissance and important alerts

The Orchestrator only coordinates drones. All six spawn at two simulated outskirts stations, north near Nea Makri and south near Pikermi. Two begin reconnaissance in high fire-sensitivity sectors inferred from current fuel, gust and weather readings; four remain in reserve. Current fire projections and blind-spot demand can increase usage. Candidates exclude recently observed sectors and estimated fixed-camera coverage (range, horizontal FOV and sampled DEM line of sight).

Drones climb from their pads, travel to distinct targets and execute circle, square, repeated line or hover-and-look maneuvers. After six simulated minutes observing a sector, tasks complete and another may be assigned. A 38-minute illustrative powered-flight budget drains with elapsed flight time. Distance-aware battery reserves trigger return; drones arrive, descend, land and recharge on their home pads (18 minutes from empty to full), then become available again. No clock-based battery reset occurs. Coverage and battery behavior are illustrative, not validated operational models.

Movement commands and returns appear as dismissible FIREYE messages beneath the centered eye, with title, reason, time and Locate, but no duplicate logo or approval buttons. Commands expire after four simulated minutes. Important fire updates take precedence: a new fire or material forecast deterioration (speed increases by at least 20% and 3 m/min, an absolute future arrival moves at least five minutes earlier, or a newly threatened place falls within an hour). A countdown merely getting shorter is not an alert. Fire cards expire after 15 simulated minutes. Completion/recharge events remain available in OPS and source history.

FIREYE recon does not use the decision journal (retained for Ops), dispatch workflow or approval buttons. Its simulation does not generate operational actions, rather than silently approving them. Chat answers reconnaissance/projection questions and does not dispatch resources. Ops and legacy replay retain their separate action model and mandatory human approval.

## Appearance

FIREYE is fixed dark with a satellite basemap. Saved Light/Auto settings and the appearance URL parameter do not change its UI. Monitoring and legacy replay retain their appearance controls. Feed lighting and the timeline's day/twilight/night band still follow simulation time. Reduced motion disables looping/smooth animation.

## Tests

`npm test` includes `tests/fireye.ts` (log identity after scrubbing, causal debounce, deterministic sensors, tab classification, no scripted decisions, backend unions and bridge adapter), `tests/recon.ts` (20 registered channels across 14 physical sources, two stations, staged patrol, all four flight patterns, return/landing/recharge/relaunch, physical battery rates, source-flow provenance, no actions/routes across the eight-hour exercise, alert thresholds and seek identity), `tests/boot.ts` (real readiness/skip/grace gates, serial icon order/100 ms holds, bounded positions, measured header handoff, monotonic fixed-heading descent, overscan projection equivalence and frame-gap/background-tab limits), and `tests/appearance-sync.ts`. Also run `npm run typecheck`, `npm run test:monitoring`, `npm run build` and `npm run test:pwa`.

Run `node scripts/check-fireye-boot-browser.mjs` after building for finite production-entry browser QA. It checks all eight delivered 100 ms holds and strict order, actual rendered pixels beneath former panel slots, a constant 1600×952 canvas at (0,48), stationary camera/framing through panel entrances, both stations in the clear home view, HUD bounds, map hit testing, panel toggles/resize, feed entry/return, Escape and zero boot animations under reduced motion. It closes its own browser/listener and writes no artifacts by default. `FIREYE_QA_SCREENSHOTS=1` saves reveal/ready screenshots under `experiments/`. It also exercises current-main's default Ops boot, Chief reply/history and isolated Crew entry. Browser timing covers the boot approach, not sustained feed-wall performance.

`npm test` also retains Ops, mascot, thermal metadata/capture and crew-store regressions. `npm run test:thermal-browser` checks 20 actual local PNG/metadata exports through the explicit FIREYE entry. `npm run test:crew` checks dependency isolation and two readers against actual exported backend code over loopback HTTP. It is a finite fixture integration test, not the ten-minute real-producer acceptance run.
