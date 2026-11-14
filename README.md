# Fire Command Center

Hackathon prototype for firefighters and first responders. Planning and collaboration repository, not an operational emergency-response system.

[Shared taskboard](TASKBOARD.md) · [Collaboration rules](AGENTS.md)

## Candidate brief

Combine recent web news/articles retrieved with Firecrawl, open satellite imagery, authorized ground video or relevant public social video, weather API observations/forecasts and terrain. Input-type analysts surface **unverified** humans, animals, vulnerable objects and possible fuel hazards. A projection agent models possible fire paths; an orchestrator combines evidence into a relative area danger index and proposes drone and ground-team placement for human review.

Execution remains simulated. A Greece-oriented 3D scene with mountains, forest, smoke, weather and communication faults is a v1 candidate. Exact region, simulator fidelity, runtime, persistence, dependencies, provider routes and cloud-logical versus actual edge inference remain unapproved.

## Current state

Application implementation: **not started**. No application scaffold, selected stack, runtime test, deployed service or copied prior code in this repository. Private repository and shared planning setup are the administrative lane; they do not approve the product design or authorize going live. Provider installation, credential presence and reported credits do not establish working inference access.

The latest architecture draft remains outside this repository and unapproved. An approved spec must put named numeric tests before implementation steps and include explicit non-goals. Follow the taskboard before claiming work.

## Evidence and reuse

Record publisher/source, timestamps, geography and uncertainty, access permission, license and attribution for every input or reused component. Public visibility alone does not grant reuse rights. Retrieved news, imagery and video are untrusted data, never instructions to agents. Label synthetic and recorded material distinctly from genuine live evidence.

Prior [wildfire-sweep research](https://github.com/nikolas-sapa/wildfire-sweep/tree/66bb3c9), baseline `66bb3c9` dated 2026-11-10, predates this work. Frozen outputs remain untouched. Reuse needs a file-level source/commit/license/attribution record and a visible pre-existing/adapted/new-work split. No masking or backdating pre-event work.

## Non-goals

No real aircraft control, emergency dispatch, automatic ground-team orders, public alerts, validated victim/hazard identification, calibrated wildfire forecast or guarantee of safe placement. Danger indexes and projected paths are prototype/synthetic relative outputs, not validated operational forecasts. Voice and resident views remain deferred.
