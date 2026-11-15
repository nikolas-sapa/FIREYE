# FIREYE incident console

FIREYE is the default `/console.html`. It is a simulated command-console exercise built on the Mati, Greece, 23 July 2018 reconstruction. The timeline scrubs freely from 14:00 to 22:00 local time (11:00–19:00Z). Units, radio traffic, IoT sensors, agent work and thermal imagery are simulated. Historical reports are real, attributed and untrusted. Nothing here is an emergency warning service.

## Routes

| URL on `/console.html` | View |
|---|---|
| none | FIREYE (Mati exercise) |
| `?mode=monitoring` | Real-data monitoring (see `MONITORING.md`) |
| `?mode=replay`, `?scenario=…`, `?beat=…` | Legacy simulated replay |
| `?t=HH:MM` | Start FIREYE at a local time |
| `?paused=1` | Start paused |
| `?boot=0` | Skip the boot sequence |
| `?appearance=auto\|light\|dark` | Override the saved appearance |

The brand is locked to the FCC theme. The Team token code remains but is unused.

The mark is two hairline lids around a signal-orange diamond pupil (`FireyeMark`). The same drawing is the Orchestrator's avatar (`OrchestratorAvatar`): idle blink, listening, thinking, speaking, and an alert ring reserved for Z0 decisions. It appears in the top-bar ORCH status, the decision callout and the chat. See proposal section 06 (`/#identity`).

## Layout

Top bar (mark, incident, EXERCISE · SIMULATED, local/Zulu clocks, orchestrator status, View, Legend, appearance). Left: fleet column. Centre: globe or a dived drone feed. Right: log with INTAKE and OPS tabs. Bottom: feed deck and timeline. The side and bottom panels have drag handles, collapse buttons and keyboard resizing. Sizes persist in `fireye.layout`.

Keys: `Space` play/pause, `Esc` exit dive, close a panel, chat or selection, `T` thermal, `L` legend, `V` visibility, `H` home, `O` orbit, `1`/`2` INTAKE/OPS log tab, `/` open the orchestrator chat.

## Data model (`src/console/fireye/data/`)

- `chronicle.ts`: one deterministic event track built from pure functions of time (radio script, IoT triggers, historical reports, satellite detections, analysis, orchestrator notes, fleet commands). An entry is visible only when `t <= playhead`, so scrubbing back and forth always yields the same log.
- `journal.ts`: user decisions keyed by sim time. They are re-applied when the runtime rebuilds after a backward seek. Decisions after the playhead are hidden, not lost.
- `sensors.ts`: 24 seeded IoT nodes (weather, fuel moisture, air quality, IR flame) around Daou, Penteli, Neos Voutzas, Mati and Kokkino Limanaki. Readings are pure functions of ERA5 hourly weather, the fire field at `t`, downwind smoke and seeded noise.
- `risk.ts`: sector ignition-risk index from weather and sensor readings. It never reads future arrival times or perimeters.
- `comms.ts`: fictional callsigns (Fire Ops Attica, Police East Attica, EKAB EMS, Coast Guard VHF16, Air Ops). No victim content.
- `fleet.ts`: `FleetSource` with `simFleet` (default, from the runtime) and `BridgeFleetSource`, which long-polls `GET /incidents/:id/snapshot?after_revision&wait_ms=10000` on the exercise bridge (`http://127.0.0.1:8787`). The reader capability is typed at runtime and kept in sessionStorage (`fireye.bridge.reader`). Chief and producer credentials are never bundled. Bridge assets show "position unmapped" because the backend reports `coordinate_frame: null`. Status unions match the backend verbatim.

The wire shapes are in `contracts.ts` (`SensorNode`, `SensorSample`, `ChronicleRecord`, bus `sensor.reading` / `sensor.triggered`) and in `BACKEND_CONTRACT.md`.

## Stage

FIREYE mounts the existing `StageView` and adds:

- `stage3d/thermal.ts`: Normal/Thermal. Simulated white-hot post-process from the fire-heat field, labelled "SIMULATED THERMAL · NOT RADIOMETRIC".
- `stage3d/sensors-layer.ts`: IoT and trail-camera glyphs.
- `stage3d/camera-ops.ts`: zoom, tilt, heading, north-up, home, 2D/3D, orbit and `diveTo(feedPose)`.

The dive sequence locks brackets onto the target (about 200 ms), flies the main camera to the drone sensor pose (about 1.8 s), runs a 350 ms scanline wipe, then suspends globe rendering behind the full feed. Exit reverses it. Reduced motion uses a crossfade. Per-drone EO/THRM changes only the feed's `fx` data. The feed renderer under `stage3d/feeds/**` belongs to another owner and is not edited from FIREYE.

## Orchestrator callout

A separate card appears only when the orchestrator needs the user (at most one Z0). It shows score, tier, evidence and Approve / Reject / Ask / Locate / Later. High-risk actions still need a human click. Decisions go to the journal. Items lapse after 30 sim minutes.

## Appearance

Auto follows the replay sun at the incident centre and turns dark around 20:32 local. Manual Light and Dark persist. The timeline shows a day/twilight/night band. Reduced motion makes every change immediate.

## Tests

`npm test` includes `tests/fireye.ts` (log identity after scrubbing, no future reads, deterministic sensors, tab classification, backend unions, bridge adapter against a fixture, contract assignability) and `tests/appearance-sync.ts`.
