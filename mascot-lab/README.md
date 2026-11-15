# Pixel mascot bench

Original firefighter and helping-drone characters for Fire Command Center. Local visual prototype, not real agent status or incident evidence. Latest user brief: a well-designed tiny fire Chief and a coherent supporting rescue crew, not generic bots.

## Test plan

| Test | Numeric pass criterion |
| --- | --- |
| ML01 Catalog | Exactly 6 unique IDs and silhouettes; every grid exactly 32x32; each character has >=80 opaque pixels and >=2 palette colors. |
| ML02 States | Idle, thinking, working and alert produce valid frames for all 6 characters across 16 sample frames; >=2 visually distinct frames per state; zero out-of-grid writes. |
| ML03 Gallery | All 6 character selectors, 4 state controls, 3 preview sizes, 2 themes, pause/resume and one PNG export work in actual Chromium; zero page/console errors. |
| ML04 Accessibility | Keyboard can reach/select all characters and states; visible focus; reduced-motion freezes sprite frames; zero horizontally overflowing content at widths 375, 768 and 1440px. |
| ML05 Local boundary | Server binds only 127.0.0.1; actual HTTP serves every required asset, rejects traversal/dotfile/foreign host/cross-site/write requests, and exposes zero backend/frontend/provider routes. |
| ML06 Scope | Zero changes under backend/, proposal/, shared schemas, package manifests or CI; no paid/live providers, production deploy or automatic merge. |
| MC01 Rescue identity | Exactly 6 IDs: chief, ranger, rescue, scout, relay, tender. Three recognizable helmet/turnout characters and three distinct drone silhouettes; each >=120 opaque pixels and >=4 colors. |
| MC02 Animation preservation | All 6 x 4 x 16 = 384 frames valid/immutable; each state has >=2 distinct frames, no clipped artwork. |
| MC03 Chief-first preview | Chief selected on load. All 6 names, roles, selection, keyboard, sizes, states and PNG export pass actual Chromium, page/console errors0 and external requests0. |
| MC04 Visual craft | Inspect every character at 32/64/192px; Chief helmet/shield/coat, ground gear and drone payloads visually distinct. Desktop375/768/1440px dark and light screenshots reviewed, horizontal overflow0. |

## Non-goals

Dashboard integration or redesign, simulation/backend changes, real agent execution/status, operational notifications, a Grok/xAI copy, paid image generation, dependency changes, deployment, provider access, auth or persistent incident data. Sprites are deliberately original code-native pixel art, not downloaded brand assets.

## Implementation plan

1. Publish this test plan, design context and exact file claims.
2. Parallel workers draw two three-character families and build the independent gallery. Shared sprite contract below remains fixed.
3. Root builds the small loopback static server and tests. Retain self-hosted Geist font with its license.
4. Run native tests, actual browser interaction/screenshot checks and independent JavaScript/security review. Fix failures within owned paths.
5. Root commits/pushes only reviewed claimed paths on a feature branch. Leave localhost gallery running; no merge or production deployment.

Current refinement (MASCOT-02): keep renderer/runtime/control contract, redraw Chief/Ranger/Rescue and Scout/Relay/Tender in disjoint files, refine existing gallery into a Chief-first rescue-crew study, rerun numeric checks and independent review, append follow-up receipt. No wholesale dashboard rebuild.

## Sprite contract

- `bots-a.mjs` exports `primaryBots`; `bots-b.mjs` exports `alternateBots`. Each is an array of exactly three plain objects.
- Each bot: `{ id, name, role, tagline, description, silhouette, palette, pixels }`. Strings except palette (`Record<string,string>`) and pixels (`string[32]`, exactly 32 characters per row). `.` means transparent; every other character names a hex-color palette entry. Original 32x32 art.
- `sprite-core.mjs` exports `GRID_SIZE = 32`, `STATES = ['idle', 'thinking', 'working', 'alert']`, `validateBot(bot)`, `frameFor(bot, state = 'idle', frame = 0)`, and `drawSprite(canvas, bot, {state = 'idle', frame = 0, scale = 4, monochrome = false} = {})`.
- `validateBot` throws `TypeError` for invalid data and returns true for valid input. `frameFor` returns a fresh 32x32 string grid. State changes create actual eye/body/accessory changes, not only CSS motion. No global timers or DOM work at module import.
- `drawSprite` uses only integer rects and `imageSmoothingEnabled=false`. Canvas backing dimensions are `32*scale` on each axis; transparent background. Returns the canvas. Decorative shadows/backdrop belong to the gallery, not exported art.
- Renderer reads each bot's pixel grid directly, no per-bot switches. Alternate bots can arrive independently. States are visual-demo states, never evidence of real processes.

## Run

From repository root: `node mascot-lab/server.mjs`. Default: `http://127.0.0.1:5184`. Optional `--port 5185`. No install/build/API keys required.

Native checks: `node --test mascot-lab/tests/catalog.test.mjs mascot-lab/tests/server.test.mjs`.

Browser verification uses an existing Playwright installation. `FCC_PLAYWRIGHT_MODULE` may point to an installed Playwright `index.mjs`, and `FCC_CHROMIUM_PATH` may select an existing Chromium executable; run `node mascot-lab/tests/browser.mjs` from repository root. No new dependency is installed into this repository. Screenshots go to ignored `.scratch/mascot-lab/`.

## Source and reuse

Pixel art and gallery are event-new source for this request (2026-11-15). Controls adapt existing FCC `Segmented`/roving-keyboard behavior and shadcn-style button states, not simulator source. Reference source: main `b1e5572`, `proposal/fcc/src/design-system/components/{Button,forms}.tsx`, and local design-demos `app/src/components/ui/button.tsx`. No upstream FCC files are copied or edited. Self-hosted `geist-latin.woff2` is the unmodified Latin variable-font asset from existing approved `@fontsource-variable/geist@5.3.0`; its SIL Open Font License 1.1 is retained in `assets/OFL.txt`. No Grok/xAI images, logos or likeness imported.

## Historical MASCOT-01 verification receipt

2026-11-15, macOS arm64, Node 26.11.1, deterministic sprite frames 0..15 (no random seed), Chromium 156.0.8078.4.

- Root independently ran native tests: 7/7, failures/skips 0. Exactly 6 distinct 32x32 masks, 229..396 opaque pixels; 384 sampled character/state frames valid and immutable. Actual renderer and actual loopback HTTP exercised, not mocked network access.
- Actual Chromium: all 6 selectors, 4 display states, 3 sizes, 2 themes, pause/resume, transparent PNG download, arrow/Home/End keyboard, visible focus and reduced motion passed. Viewports 375x900, 768x1080 and 1440x1080: horizontal overflow 0, page/console errors 0, external requests 0. Dark screenshots at all widths plus light desktop independently inspected. Theme interpolation and skip-link screenshot artifacts corrected before final rerun.
- Independent JavaScript reviewer: syntax 9/9 and 1,920 actual bounded renderer calls passed; no correctness findings. Independent local security review: server suite 3/3 plus 11 hostile loopback checks passed; no exploitable findings for documented local launcher.
- Retained font: 29,400 bytes, SHA256 `19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1`, source package `@fontsource-variable/geist@5.3.0`, unmodified OFL notice 4,486 bytes. Runtime/manifest/lock additions 0.
- Main planning checkout remained clean on its original branch. Backend, proposal, CI and shared contracts changed 0. No real agents, paid/live providers, production deployment or dashboard integration.

Limits: Chromium only, Safari/Firefox unrun. Typecheck not applicable to native JavaScript; no new linter/build dependencies. Existing backend/frontend suites unrun because those modules are unchanged and the lab imports none of them. Hosted CI does not cover `mascot-lab/`; local checks above are the verification receipt. Local visual prototype is ready to compare, not operational acceptance or a chosen dashboard mascot.

## MASCOT-02 firefighter-crew receipt

2026-11-15, source refinement of `e0f708e`, same macOS arm64 / Node 26.11.1 / Chromium 156.0.8078.4. Original generic art replaced by Chief/Ranger/Rescue plus Scout/Relay/Tender, not relabeled. Chief has a white crested shield helmet, moustache, reflective navy turnout coat and raised radio; ground crew has red helmets and distinct hose/headlamp/support packs; drones have distinct camera, relay mast and water capsule payloads. Costume red is not UI accent, orange absent.

Root native checks 8/8, failures/skips0. All 384 animation samples valid, fresh and unchanged originals; visible pixels Chief412, Ranger397, Rescue371, Scout308, Relay382, Tender342. Three ground and three aerial masks distinct. Independent reviewer ran 1,920 actual bounded immutable canvas renders, syntax9/9 and native8/8, no findings. Existing renderer/server/controls/font assets unchanged.

Actual browser after final polish: Chief-first at 192px, all6 names/roles/selectors, four states, three scales, two themes, representative costume/optic palette colors, pause/resume, transparent PNG, arrow/Home/End and reduced motion PASS. Page/console errors0, external requests0, horizontal overflow0 at375x900,768x1080,1440x1080. Six-character 32/64/192px sheet and dark/mobile/light gallery screenshots independently inspected. Grouped ground/air specimens, supporting drone buddy and command-center placement sketches are visual studies, never real status or dispatch.

Scope: ten claimed files only, no simulator/dashboard/backend/CI/package/lock changes, paid calls0, deployment0, automatic merge0. Local preview remains `http://127.0.0.1:5184`; feature PR50 remains draft. Safari/Firefox/hosted lab CI unrun; no new build/linter dependencies. Historical receipt above describes the superseded first art set.
