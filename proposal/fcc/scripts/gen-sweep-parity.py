#!/usr/bin/env python3
"""Regenerate tests/fixtures/sweep-dispatch-parity.json from the wildfire-sweep source.

Run with the wildfire-sweep venv:
  /Users/nikolassapalidis/Developer/python/wildfire-sweep/.venv/bin/python scripts/gen-sweep-parity.py
"""
import hashlib
import json
import math
import subprocess
import sys
from pathlib import Path

SWEEP = Path("/Users/nikolassapalidis/Developer/python/wildfire-sweep")
sys.path.insert(0, str(SWEEP))

import numpy as np

import research
from sweep import CONFIG as SWEEP_CONFIG

OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "sweep-dispatch-parity.json"

DEFAULTS = {
    "airspeedMps": 18.0,
    "windMps": [0.0, 0.0],
    "enduranceMin": 46.0,
    "reserveFraction": 0.25,
    "launchLatencyS": 60.0,
    "maxWindMps": 12.0,
    "dwellS": float(SWEEP_CONFIG["dwell_s"]),
}
CFG = {"dwell_s": float(SWEEP_CONFIG["dwell_s"]), "turnaround_s": 0.0, "season_days": 1.0}


def finite(v):
    return float(v) if math.isfinite(v) else None


def expected(case):
    p = {**DEFAULTS, **case.get("params", {})}
    point = np.asarray(case["point"], dtype=float)
    bases = case["bases"]
    coords = np.array([[b["xKm"], b["yKm"]] for b in bases], dtype=float)
    available = np.array([b["available"] for b in bases], dtype=bool)

    mission = research.MissionConfig(
        airspeed_mps=p["airspeedMps"], wind_mps=tuple(p["windMps"]),
        endurance_min=p["enduranceMin"], reserve_fraction=p["reserveFraction"],
        max_wind_mps=p["maxWindMps"])
    usable = mission.endurance_min * 60 * (1 - mission.reserve_fraction)
    weather_closed = math.hypot(*mission.wind_mps) > mission.max_wind_mps

    if available.any():
        result = research.dispatch_physical(
            np.array([0.0]), point[None, :], coords[available],
            1, p["launchLatencyS"], CFG, mission)
        status = result["status"][0]
        response = float(result["response_s"][0])
    else:
        # dispatch_physical rejects an empty base list; over zero available bases
        # no airborne is finite, so the rule resolves to flight_rejected.
        status = "flight_rejected"
        response = math.inf

    outbound, inbound = research.flight_times(point - coords, mission.airspeed_mps, mission.wind_mps)
    airborne = outbound + p["dwellS"] + inbound
    flight_ok = np.isfinite(airborne)
    battery_ok = flight_ok & (airborne <= usable + 1e-9)
    eligible = available & battery_ok & (not weather_closed)
    arrival = p["launchLatencyS"] + outbound
    selected = int(np.argmin(np.where(eligible, arrival, np.inf))) if eligible.any() else None

    if (selected is None) != (status != "served") or (
            selected is not None and not math.isclose(
                response, float(arrival[selected]), rel_tol=1e-12, abs_tol=1e-9)):
        raise AssertionError(f"candidate explanation disagrees with dispatch_physical: {case['name']}")

    candidates = []
    for i, b in enumerate(bases):
        reason = ("offline" if not b["available"] else "weather" if weather_closed else
                  "flight" if not flight_ok[i] else "battery" if not battery_ok[i] else "eligible")
        candidates.append({
            "baseId": b["id"], "outboundS": finite(outbound[i]), "returnS": finite(inbound[i]),
            "airborneS": finite(airborne[i]), "arrivalS": finite(arrival[i]),
            "flightOk": bool(flight_ok[i]), "batteryOk": bool(battery_ok[i]),
            "eligible": bool(eligible[i]), "reason": reason,
        })
    return {
        "status": status,
        "selectedBaseId": bases[selected]["id"] if selected is not None else None,
        "responseS": finite(response),
        "within15min": bool(response <= 900.0),
        "usableAirborneS": usable,
        "candidates": candidates,
    }


def grid_bases(n, x0=4.0, y0=4.0, dx=8.0, dy=8.0, cols=3):
    return [{"id": f"b{i}", "xKm": x0 + (i % cols) * dx, "yKm": y0 + (i // cols) * dy, "available": True}
            for i in range(n)]


def case(name, point, bases, params=None):
    c = {"name": name, "point": list(point), "bases": bases}
    if params:
        c["params"] = params
    return c


CASES = []

# Calm wind, several fleet sizes.
for n in (3, 5, 9):
    CASES.append(case(f"calm-{n}bases", (10.0, 6.0), grid_bases(n)))

# Tailwind / headwind / crosswind (wind vector is blowing-toward).
CASES.append(case("tailwind-east", (16.0, 4.0), grid_bases(3), {"windMps": [8.0, 0.0]}))
CASES.append(case("headwind-west", (16.0, 4.0), grid_bases(3), {"windMps": [-8.0, 0.0]}))
CASES.append(case("tailwind-north", (4.0, 16.0), grid_bases(4), {"windMps": [0.0, 7.5]}))
CASES.append(case("headwind-south", (4.0, 16.0), grid_bases(4), {"windMps": [0.0, -7.5]}))
CASES.append(case("crosswind-pure", (12.0, 4.0), grid_bases(4), {"windMps": [0.0, 9.0]}))
CASES.append(case("crosswind-diagonal", (14.0, 10.0), grid_bases(6), {"windMps": [5.0, 6.0]}))

# Cross component at/over airspeed: infeasible legs. maxWind is lifted so the flight
# physics, not the weather gate, decides these cases.
for i, w in enumerate((17.5, 17.99, 18.0, 18.5, 20.0, 25.0)):
    CASES.append(case(f"cross-near-airspeed-{i}", (12.0, 4.0), grid_bases(4),
                      {"windMps": [0.0, w], "maxWindMps": 30.0}))
CASES.append(case("cross-beyond-mixed", (9.0, 11.0), grid_bases(5),
                  {"windMps": [14.0, 13.0], "maxWindMps": 30.0}))
CASES.append(case("cross-near-slow-drone", (12.0, 4.0), grid_bases(4),
                  {"airspeedMps": 12.5, "windMps": [0.0, 12.0]}))

# Weather closed (wind speed above max_wind but still flyable physics).
for i, w in enumerate((12.5, 15.0, 20.0)):
    CASES.append(case(f"weather-closed-{i}", (10.0, 8.0), grid_bases(5), {"windMps": [w, 0.0]}))
CASES.append(case("weather-closed-higher-max", (10.0, 8.0), grid_bases(5),
                  {"windMps": [14.0, 0.0], "maxWindMps": 20.0}))

# Far points: battery then flight rejection as distance grows.
for i, d in enumerate((30.0, 60.0, 120.0, 300.0)):
    CASES.append(case(f"far-{i}", (d, 0.0), grid_bases(5)))
CASES.append(case("far-no-dwell", (40.0, 0.0), grid_bases(5), {"dwellS": 0.0}))
CASES.append(case("far-long-endurance", (40.0, 0.0), grid_bases(5), {"enduranceMin": 90.0}))
CASES.append(case("far-tight-reserve", (30.0, 0.0), grid_bases(5), {"reserveFraction": 0.5}))

# Offline bases.
b = grid_bases(5)
for x in b:
    x["available"] = False
CASES.append(case("all-offline", (8.0, 8.0), b))
b = grid_bases(5)
b[1]["available"] = False
b[3]["available"] = False
CASES.append(case("some-offline", (4.0, 4.0), b))
b = grid_bases(4)
b[0]["available"] = False  # nearest is offline -> second nearest wins
CASES.append(case("nearest-offline", (4.2, 4.1), b))

# Zero distance: point exactly on a base.
CASES.append(case("zero-distance", (4.0, 4.0), grid_bases(4)))
CASES.append(case("zero-distance-wind", (4.0, 4.0), grid_bases(4), {"windMps": [9.0, 4.0]}))

# Tie: two equidistant bases, first index wins.
CASES.append(case("tie-equidistant", (8.0, 4.0),
                  [{"id": "west", "xKm": 4.0, "yKm": 4.0, "available": True},
                   {"id": "east", "xKm": 12.0, "yKm": 4.0, "available": True},
                   {"id": "far", "xKm": 40.0, "yKm": 4.0, "available": True}]))
CASES.append(case("tie-equidistant-wind", (8.0, 4.0),
                  [{"id": "west", "xKm": 4.0, "yKm": 4.0, "available": True},
                   {"id": "east", "xKm": 12.0, "yKm": 4.0, "available": True},
                   {"id": "north", "xKm": 8.0, "yKm": 20.0, "available": True}],
                  {"windMps": [3.0, 0.0]}))

# Parameter sweeps.
for i, a in enumerate((10.0, 18.0, 25.0, 40.0)):
    CASES.append(case(f"airspeed-{i}", (15.0, 9.0), grid_bases(6), {"airspeedMps": a}))
CASES.append(case("slow-airspeed-headwind", (12.0, 4.0), grid_bases(4),
                  {"airspeedMps": 10.0, "windMps": [-9.0, 0.0]}))
CASES.append(case("long-launch-latency", (10.0, 6.0), grid_bases(4), {"launchLatencyS": 300.0}))
CASES.append(case("no-reserve", (20.0, 0.0), grid_bases(4), {"reserveFraction": 0.0}))
CASES.append(case("high-dwell", (15.0, 0.0), grid_bases(4), {"dwellS": 600.0}))
CASES.append(case("oblique-wind-mixed", (18.0, 7.0), grid_bases(7), {"windMps": [-4.0, -6.5]}))
CASES.append(case("tiny-scene", (0.5, 0.5),
                  [{"id": "a", "xKm": 0.0, "yKm": 0.0, "available": True},
                   {"id": "b", "xKm": 1.0, "yKm": 1.0, "available": True},
                   {"id": "c", "xKm": 2.0, "yKm": 0.0, "available": False}]))
CASES.append(case("single-base", (6.0, 3.0),
                  [{"id": "only", "xKm": 2.0, "yKm": 2.0, "available": True}]))
CASES.append(case("single-base-offline", (6.0, 3.0),
                  [{"id": "only", "xKm": 2.0, "yKm": 2.0, "available": False}]))
CASES.append(case("nine-bases-oblique", (13.5, 17.25), grid_bases(9), {"windMps": [6.0, -2.0]}))

for c in CASES:
    c["expected"] = expected(c)

research_py = (SWEEP / "research.py").read_bytes()
fixture = {
    "source": {
        "repo": "https://github.com/nikolas-sapa/wildfire-sweep",
        "commit": subprocess.check_output(["git", "-C", str(SWEEP), "rev-parse", "HEAD"], text=True).strip(),
        "research_py_sha256": hashlib.sha256(research_py).hexdigest(),
    },
    "defaults": DEFAULTS,
    "cases": CASES,
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(fixture, indent=2) + "\n")
print(f"wrote {OUT} ({len(CASES)} cases)")
