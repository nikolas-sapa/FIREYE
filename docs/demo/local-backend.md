# Local backend, EXERCISE only

Issue #17 backend-only launcher. No frontend server/page opens. Frontend handoff/launch requires owner confirmation after backend completion. No login/signup, provider calls, Boxd, Convex, media decoding, public bind, deployment or real commands. This is disposable process-local fixture authority, not production authentication or distributed persistence.

## Test plan before implementation

LL01 one actual loopback backend command, ten start/stop cycles with zero listeners/polls left, zero providers/public bind/wildcard CORS. LL02 twenty invalid config/Host/Origin/expiry cases rejected, twenty injected Chief IDs grant zero privilege. LL03 two actual HTTP readers match twenty/twenty revisions, one current-Chief approval/check cycle, twenty unknown metadata cases retain nulls with zero guessed Geo/confidence/calibration. LL04 native and compiled export/CLI, core/config tests/typecheck pass, fresh PID/entry source hash/port evidence. Implementation: inert exported composition, disposable synthetic seed, expiring server-owned roles, owner-only handoff, exact HTTP origin, graceful shutdown, contract map. Non-goals above remain unchanged.

## One backend command

From repository root, Node >=24 (native TypeScript stripping):

```sh
node backend/scripts/start-local.ts
```

No dependency installation required to launch; native `node:http` only. Tests/typecheck use existing pinned development dependencies. Default127.0.0.1:8787 and allowed browser Origin `http://localhost:5173` do not start that frontend. Optional config lives in nonsecret [example](../../backend/.env.example), read only `FCC_LOCAL_MODE`, `FCC_LOCAL_PROVIDERS`, `FCC_LOCAL_PORT`, `FCC_LOCAL_ORIGIN`, `FCC_LOCAL_CAPABILITY_TTL_MS` (optional host must be127.0.0.1). Node does not automatically load `.env.example`.

```sh
FCC_LOCAL_PORT=8788 FCC_LOCAL_ORIGIN=http://127.0.0.1:5173 node backend/scripts/start-local.ts
```

Mode must beEXERCISE, providers must bedisabled. Port integer0–65535 (0 selects a fresh ephemeral port); exact HTTP localhost/127.0.0.1/[::1] Origin only, no trailing slash/path/query/userinfo. Host always127.0.0.1, cannot override to public bind. Capability TTL defaults600000ms (10min), allowed1–1800000ms. No provider env/key is read. Unknown FCC/provider environment fields do not enable inference.

CLI stdout emits one JSON readiness record **after listening**: `ready`, mode/providers, PID, launcher entry SHA256, actual URL, incident/run IDs, exact Origin, expiry, Chief/producer IDs and private capability-file path. Entry SHA is the executed TS/compiled-JS file hash, not a whole-repository commit claim. Capture source Git SHA separately using `git rev-parse HEAD`. Startup failure emits generic stderr, exit1, no readiness/token/input dump. Port-in-use fails; never connect to an old listener and call it a successful launch.

Private role handoff is `backend/.scratch/local-demo-<unique>/capabilities.json`, directory0700/file0600, created exclusively without overwriting old runs. File contains endpoint/run/Origin/expiry and random capabilities for reader, current human Chief, analyst, sole producer. Do not print/log/commit it, send capabilities in URL parameters, copy provider keys or put it into a durable frontend store. It is a local wiring capability, not proof of a human login. Programmatic `startLocalBackend(config, optionalTrustedClock)` returns `{url,incident_id,run_id,allowed_origin,authority,setup,close()}` without stdout/files. `authority` and `setup` are internal/private, never crew DTOs. Importing launcher creates zero listener/files/jobs.

Ctrl-C/SIGINT or SIGTERM closes the owned listener and pending polls, clears bridge liveness timer/connections, deletes this run's private handoff and empty unique directory. SIGKILL/crash cannot clean files; leftover capabilities expire and old server is gone, never reuse them. No automatic restart/persistence/takeover.

## Readiness, producer loss and reset

Authorized local requests send exact configured Origin plus Bearer capability. `GET /incidents/exercise-local/snapshot` returning200 with matching `run_id` establishes actual HTTP readiness. `GET snapshot?after_revision=N&wait_ms=10000` waits for a newer revision or returns204. A healthy listener is not a healthy producer, inference receipt or frontend acceptance.

Launcher creates three thermal synthetic feed declarations and three finite fixture candidates, zero observations/proposals/commands. Every run gets new `run_id`, Chief/producer IDs and capabilities, incident ID remains`exercise-local`. Declared candidates do not prove physical feasibility/routes, feeds do not prove pixels. No time-driven provider job, simulated motion or producer heartbeat is fabricated. Trusted default UTC/tick derive from monotonic elapsed server seconds, not physics, capture clock or frontend animation time.

Only designated external fixture producer may POST empty body `/producer-heartbeats`; expected cadence <5s. Timer every250ms checks >5s absence and freezes authority. Readers stay available with last-known facts/`authority_active=false`; late heartbeats cannot revive frozen run. To reset: stop backend and start a **new run**, reacquire role handoff, discard old cached intents/capabilities. This is explicit exercise reset, not reconciled takeover or revival of accepted work.

Orchestration remains separately reviewed dependency, not imported/started in this launcher revision. Bridge/planner/sponsor adapters may exist in source, but standalone launch creates no planner jobs, registered generated routes or provider inference. No orchestration endpoint is advertised.

## Documented current-Chief fixture cycle

Synthetic native tests implement this cycle through actual HTTP, never startup autoapproval:

1. Sole producer sends empty heartbeat. Analyst sends exact `proposal.created` for current `c1`, proposal`p1` revision1, input/plan/reservation revisions0, Chief epoch1, expiry tick120. Envelope uses actual incident/run/authority epoch, unique event/stream IDs and contiguous sequence.
2. Explicit current-Chief capability sends exact `ApprovalRequest`: matching identity/epochs, approval`a1`, proposal`p1`/revision1, candidate`c1`, expected incident revision1, input/plan/reservation0, Chief epoch1, expiry120. Response shows one`enqueued` command at incident revision2.
3. Producer GETs `/commands`, then POSTs `/command-checks` with only command ID and expected incident revision2. Success validates current command only, zero new revisions/ACK/movement.
4. Fixture producer explicitly submits distinct `command.receipt` events `sent`, `delivered`, `accepted` with current IDs/versions/transmission/owner/epoch and original/unknown capture clocks. Separate real receipt facts advance separate stages. No completion implied. New telemetry/frame between approval/check invalidates acceptance and requires fresh reviewed intent.

See actual [launcher tests](../../backend/tests/local-launcher.test.ts) and [frontend map](../contracts/frontend-map.v1.md) for exact fields/enums/null handling. Private capabilities are intentionally absent from docs/examples/stdout. No executable HTTP demo autoapproves on an owner's behalf.

## Verification, backend only

From`backend/`:

```sh
npm ci --ignore-scripts
npm test
npm run typecheck
./node_modules/.bin/tsc --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --erasableSyntaxOnly --types node --rewriteRelativeImportExtensions --rootDir . --outDir .scratch/local-launcher-dist scripts/start-local.ts config/local-demo.ts tests/local-launcher.test.ts
node --test .scratch/local-launcher-dist/tests/local-launcher.test.js
git diff --check
```

Compiled tests exercise real exported launcher and compiled CLI against ephemeral loopback listeners, then close every listener/remove private handoffs. No persistent server required. Actual receipts appended to TASKBOARD LL-01 after verification/root review. Node24 floor unrun unless separately recorded. Backend verification does not claim teammate adapter/browser/performance/provider/deployment acceptance.
