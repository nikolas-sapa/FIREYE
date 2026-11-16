# FIREYE: submission evidence and case for advancement

**An exercise prototype for wildfire-response transparency and human decision support. Not an operational emergency service.**

## Why this deserves a next phase

FIREYE brings simulated fire context, camera-style evidence, projections, agent recommendations and human review into one inspectable exercise. Its strongest contribution is not an unsupported promise of autonomy: it makes the evidence, uncertainty and decision boundaries visible.

Our case for advancement is a concrete, reviewable prototype with an explicit validation roadmap. The next phase would test whether that workflow actually improves commanders' understanding and decision-making.

## Official criteria

The official judging rubric has not been supplied for this summary. Complete criterion coverage, a winning score or qualification cannot be claimed without it. The evidence below describes project strengths, not invented scoring categories.

## What the repository supports

| Strength | Evidence | Boundary |
| --- | --- | --- |
| Integrated exercise workflow | [Current feature inventory and setup](README.md), [exercise guide](proposal/fcc/docs/FIREYE.md) | Local simulation and dated context, not live incident operations or validated forecasting. |
| Human oversight and traceability | [Approval and receipt protocol](docs/contracts/backend-bridge.v1.md), [producer handoff](docs/contracts/producer-handoff.v1.md) | Backend approvals, immutable commands and supplied receipt stages exist. Backend commands do not yet execute the frontend fleet. |
| Distinct drone evidence channels | [Thermal contract](docs/contracts/thermal-camera.md), [channel tests](proposal/fcc/tests/thermal.ts) | Six simulated drones have separate EO and thermal channels. False color is presentation; thermal output is non-radiometric. Full rendered-export acceptance remains open. |
| Received-only shared view | [Crew reader](proposal/fcc/src/console/crew/CrewApp.tsx), [bridge proof](docs/architecture/backend-bridge-proof.md) | Crew consumes received state without simulator fallback. Local fixture capabilities are not production authentication. |
| Transparent historical context | [Frozen Greece wildfire-fatality series](proposal/fcc/src/console/data/greece-wildfire-fatalities.json) | Supplied EEA/CATDAT series:45 annual records,1980–2024,245 recorded fatalities. Historical context, not predicted deaths or lives saved. |
| Reproducible bounded backend checks | [Backend checker](backend/scripts/check-backend.mjs), [PR48](https://github.com/nikolas-sapa/fire-command-center/pull/48) | Fresh hosted Node24/26 checks each passed320 native plus320 compiled tests. This establishes tested local contracts, not field effectiveness. |

Older guides and proof receipts retain their own source dates. The README identifies current route behavior and distinguishes those historical receipts from later changes.

## Recording claims

- Show an explicitly simulated exercise, source-labelled evidence and prototype projections.
- Describe Chief/Scout replies as local scripted assistance, not verified live-model inference.
- Distinguish reviewing or acknowledging a recommendation from approving an executable action.
- Distinguish local simulated movement from backend command execution and factual completion.

## Bounded desktop recording checks

Local browser receipts reviewed on 2026-11-15 UTC, 1440×900. Camera checks used frozen frontend `c98415b`; Chief, export and Locate checks used the reviewed Chief candidate `d662ec3`, whose frontend matches merged main `28a42f8`. These are local automated browser checks, not hosted end-to-end CI. Raw captures and failed attempts remain locally retained, not published here.

| Check | Observed result | Limit |
| --- | --- | --- |
| Camera opening and return | 14 distinct paths accepted across bounded runs: EO and IR for all six drones, plus two fixed cameras. Ordinary clicks, matching labels, simulated disclosure and return-to-globe checked. | Paused 14:00 FIREYE exercise. Allowed click retries were used; not an uninterrupted run, latency benchmark or soak test. |
| Local thermal frame export | 20 real AETOS-2 IR JSON downloads containing PNG pixels, 20 unique frame identities, successful image decoding, dimensions, hashes and strict provenance validation. Wrong-hash and wrong-modality copies were rejected. | One thermal source during 1× exercise playback. [Local capture metadata](proposal/fcc/src/console/world/frame-capture.ts) remains simulated and non-radiometric, with unknown receipt/bridge geography. Not shared evidence or backend completion. |
| Chief/Scout chat | Desktop Ops and FIREYE checks completed a scripted reply and retained history after reopening. Chief heading, input and simulation disclosure visible. [Branding delivery](https://github.com/nikolas-sapa/fire-command-center/pull/59) has passing hosted Node24/26 frontend checks. | Browser receipts are separate from hosted checks; no live-model or full-mobile claim. |
| Fire inspection | One ordinary Locate click at 17:00 focused the exercise fire area while the same pending warning remained visible. | No approval, acknowledgement, dismissal or dispatch. An earlier driver hung with an unbounded animation wait; its exact stalled stage was not observed. That attempt remains not proved, with its artifact retained. |

## Acceptance still open

- Approved backend-to-frontend coordinate, clock, unit, feed, command and executor mapping.
- Further per-drone rendered-export coverage and ten-minute browser acceptance beyond the bounded checks above.
- Complete desktop/mobile interaction, accessibility and performance acceptance. Candidate desktop chat checks do not establish full mobile readiness.
- Genuine provider inference/retrieval, rights-cleared live-media use and production identity/persistence.
- Validated operational forecasts, population exposure and counterfactual impact assessment.

No actual public warnings, phone calls, field orders, real drone control, evacuation success or lives-saved outcome is established by this prototype.

## What advancement would unlock

1. Agree the single target user and decision workflow with reviewers and prospective users.
2. Complete the approved producer/executor mapping and end-to-end acceptance.
3. Validate usability and evidence interpretation with human participants.
4. Establish source rights, genuine-provider budgets and independent forecast/exposure validation before operational claims.

**The advancement case:** transparent evidence, explicit human responsibility, testable engineering boundaries and a specific path to validation.
