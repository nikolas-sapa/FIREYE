# Provenance — wildfire-sweep dispatch physics

## Source

- Repository: https://github.com/nikolas-sapa/wildfire-sweep
- Commit: `66bb3c9f72f0a820c79eb2b495fc80a4ce1a4da6`
- `research.py` sha256 at that commit: `45ddfd1837602061adc2914b575787498921a276110c6cbee33d312b38fa5301`

## File-level record

| Source (wildfire-sweep @ 66bb3c9) | Target (FIREYE) | Classification |
| --- | --- | --- |
| `research.py:34-58` (`flight_times`, wind-triangle legs) | `src/sim/dispatch.ts` (`flightTimes`) | adapted |
| `research.py:61-100` (`dispatch_physical`, single alert, idle fleet) | `src/sim/dispatch.ts` (`planDispatch`) | adapted |
| `simulator_engine.py:96-144` (`run_mission` per-base eligibility/reasons) | `src/sim/dispatch.ts` (`planDispatch` candidates) | adapted |
| `sweep.py` `CONFIG["dwell_s"]` (120 s), `simulator_protocol.json` defaults | `src/sim/dispatch.ts` (`SWEEP_DEFAULTS`) | adapted |
| — | `src/sim/dispatch.ts` (`toLocalKm`, `windVector`) | new |
| — | `src/console/fireye/data/fleet.ts` (dispatch assessment in `simFleet`) | new |
| — | `scripts/gen-sweep-parity.py`, `tests/sweep-dispatch-parity.ts`, `tests/fixtures/sweep-dispatch-parity.json` | new |

## License

The wildfire-sweep repository contains no LICENSE file; its license is unstated.
Both repositories are owned by the same author (nikolas-sapa), so the port is
authorized by the owner. No license terms are invented here.

## Limitations

From `simulator_protocol.json` (verbatim):

- Synthetic square and hypothetical aircraft/weather inputs, not real geography or operating advice.
- Mission sandbox evaluates one alert with initially idle drones; no queueing or season-wide rate.
- Captured replay includes fleet contention but contains no saved base assignments or flight trajectories.
- Recorded replay outcomes and study metrics are frozen; sandbox changes do not update them.
- No detector accuracy, thermal confirmation, upstream alert latency, flight authorization or live control.

Additional limitations of this port:

- Equirectangular projection around the scenario centre; distances are approximate at Attica scale.
- Single alert at a time; the fleet is assumed idle and all stations available.
- No queueing, turnaround or battery state carried between alerts.
- UI surface is a `review_only` fleet assessment, not a dispatch or flight authorization.
