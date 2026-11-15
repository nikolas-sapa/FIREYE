# Precision and presentation follow-up claim

Owner: marcseli / Droid. Branch: `proposal/fcc-review-followup`.
Base: PR #2, `c2682d4e855b8daf76e297315a63b86e58ce43ff`.
The owner authorized this stacked follow-up and scoped coordination updates on 15 November 2026.

## Test targets before implementation

- FP01: actual `runSpread` reaches 20/20 cells at 10.00023 minutes; final arrival within 0.0001 minute of 9.50021869; ten identical runs. First reproduce RED against the pinned source.
- FP02: retain a genuine stale-entry guard; compare all cells of a graph with improved queued routes to an independent shortest-path implementation, maximum error 0.0001 minute.
- FP03: blocked corridor, no seeds and short horizon do not propagate beyond their permitted bounds.
- FP04: both 190-second scenario tours, manual approval isolation and future-fire independence; typecheck, no-key production build and PWA pass; actual compiled solver invocation. Preserve unfavorable prediction/checkpoint results.
- Presentation: run console, monitoring and mocked/non-billable image-lab suites. Verify source/rights labels, bounded caches and no credentials/private experiment artifacts in outgoing blobs.

These are acceptance targets, not test receipts or claims of independent product validation.

## Boundaries

Deliver the precision regression/fix and the owner's recent local presentation work. Preserve the original source history and frozen revisions. Include monitoring, smooth simulated feeds, cartography/motion, and the explicit opt-in image lab without claiming root integration.

Issues #8 and #9 remain open. The reviewed producer/coordinate/media mapping and backend acceptance are separate prerequisites. This follow-up does not adopt a backend schema, create a crew Runtime, manufacture thermal/receipt metadata, launch the backend/frontend integration, merge PR #2, deploy, provision machines or spend on providers.

The 249 local experiment outputs, credentials, dependency directories, generated builds and browser/auth/scratch artifacts are excluded. Existing local working changes remain untouched; implementation occurs in an isolated worktree from a frozen explicit file snapshot.

## Exact claimed paths

The following list is the complete proposed publication/review scope, not a wildcard claim. Outside it, no edits are authorized by this claim.

- `TASKBOARD.md`
- `proposal/HANDOFF.md`
- `proposal/fcc/.env.example`
- `proposal/fcc/.gitignore`
- `proposal/fcc/AGENTS.md`
- `proposal/fcc/DESIGN_SYSTEM.md`
- `proposal/fcc/README.md`
- `proposal/fcc/console.html`
- `proposal/fcc/docs/IMAGE_LAB.md`
- `proposal/fcc/docs/MONITORING.md`
- `proposal/fcc/docs/REVIEW_RECEIPT.md`
- `proposal/fcc/docs/REVIEW_SCOPE.md`
- `proposal/fcc/docs/SETUP.md`
- `proposal/fcc/docs/VALIDATION.md`
- `proposal/fcc/package.json`
- `proposal/fcc/public/data/monitoring/README.md`
- `proposal/fcc/public/data/monitoring/attica-detail-2020.jpg`
- `proposal/fcc/public/data/monitoring/attica-detail-2020.json`
- `proposal/fcc/public/data/monitoring/attica2024-gibs.jpg`
- `proposal/fcc/public/data/monitoring/attica2024.json`
- `proposal/fcc/public/data/monitoring/current-firms.json`
- `proposal/fcc/public/data/monitoring/current-metar.json`
- `proposal/fcc/public/image-lab/README.md`
- `proposal/fcc/public/image-lab/forest.jpg`
- `proposal/fcc/public/image-lab/quarry.jpg`
- `proposal/fcc/public/image-lab/village.jpg`
- `proposal/fcc/scripts/check-console.mjs`
- `proposal/fcc/scripts/check-image-lab.mjs`
- `proposal/fcc/scripts/check-monitoring.mjs`
- `proposal/fcc/scripts/check-pwa.mjs`
- `proposal/fcc/scripts/check-spread-precision.mjs`
- `proposal/fcc/scripts/image-lab-model-eval.mjs`
- `proposal/fcc/scripts/image-lab-model-study.mjs`
- `proposal/fcc/scripts/image-lab-study-eval.mjs`
- `proposal/fcc/scripts/image-lab-study-images.mjs`
- `proposal/fcc/scripts/image-lab-study.mjs`
- `proposal/fcc/scripts/image-lab-worldcover.mjs`
- `proposal/fcc/scripts/save-monitoring-detail.mjs`
- `proposal/fcc/scripts/save-monitoring.mjs`
- `proposal/fcc/server/image-lab-grid.ts`
- `proposal/fcc/server/image-lab-landscape.ts`
- `proposal/fcc/server/image-lab.ts`
- `proposal/fcc/server/monitoring.ts`
- `proposal/fcc/src/App.tsx`
- `proposal/fcc/src/console/agents/spread.ts`
- `proposal/fcc/src/console/director/scenarios/mati.ts`
- `proposal/fcc/src/console/main.tsx`
- `proposal/fcc/src/console/monitoring/MonitoringApp.tsx`
- `proposal/fcc/src/console/monitoring/MonitoringFeedRenderer.ts`
- `proposal/fcc/src/console/monitoring/MonitoringGlobe.tsx`
- `proposal/fcc/src/console/monitoring/SimulatedFeed.tsx`
- `proposal/fcc/src/console/monitoring/cameras.ts`
- `proposal/fcc/src/console/monitoring/feed-detail-worker.ts`
- `proposal/fcc/src/console/monitoring/feed-detail.ts`
- `proposal/fcc/src/console/monitoring/feed-motion.ts`
- `proposal/fcc/src/console/monitoring/model.ts`
- `proposal/fcc/src/console/monitoring/resources.ts`
- `proposal/fcc/src/console/orchestrator/PROJECTION.md`
- `proposal/fcc/src/console/stage3d/MapControls.tsx`
- `proposal/fcc/src/console/stage3d/README.md`
- `proposal/fcc/src/console/stage3d/StageEngine.ts`
- `proposal/fcc/src/console/stage3d/StageView.tsx`
- `proposal/fcc/src/console/stage3d/cartography-paint.ts`
- `proposal/fcc/src/console/stage3d/cartography.ts`
- `proposal/fcc/src/console/stage3d/context-map.ts`
- `proposal/fcc/src/console/stage3d/context-rasterizer.ts`
- `proposal/fcc/src/console/stage3d/context-worker.ts`
- `proposal/fcc/src/console/stage3d/feeds/ArchiveCamera.tsx`
- `proposal/fcc/src/console/stage3d/feeds/FeedRenderer.ts`
- `proposal/fcc/src/console/stage3d/feeds/FeedSurfaceView.tsx`
- `proposal/fcc/src/console/stage3d/feeds/archive-camera.ts`
- `proposal/fcc/src/console/stage3d/feeds/dynamics.ts`
- `proposal/fcc/src/console/stage3d/feeds/poses.ts`
- `proposal/fcc/src/console/stage3d/fire.ts`
- `proposal/fcc/src/console/stage3d/layers.ts`
- `proposal/fcc/src/console/stage3d/map-settings.ts`
- `proposal/fcc/src/console/stage3d/motion.ts`
- `proposal/fcc/src/console/stage3d/outline.ts`
- `proposal/fcc/src/console/stage3d/stage.css`
- `proposal/fcc/src/console/stage3d/sync.ts`
- `proposal/fcc/src/console/stage3d/terrain.ts`
- `proposal/fcc/src/console/stage3d/types.ts`
- `proposal/fcc/src/console/stage3d/vector-tile.ts`
- `proposal/fcc/src/console/stage3d/world.ts`
- `proposal/fcc/src/console/ui/StageArea.tsx`
- `proposal/fcc/src/console/world/flight.ts`
- `proposal/fcc/src/console/world/sim.ts`
- `proposal/fcc/src/console/world/units.ts`
- `proposal/fcc/src/design-system/components/ImageComparison.tsx`
- `proposal/fcc/src/design-system/components/TileMosaic.tsx`
- `proposal/fcc/src/design-system/components/forms.tsx`
- `proposal/fcc/src/design-system/components/index.ts`
- `proposal/fcc/src/image-lab/client.ts`
- `proposal/fcc/src/image-lab/grid-client.ts`
- `proposal/fcc/src/image-lab/grid.ts`
- `proposal/fcc/src/image-lab/landscape.ts`
- `proposal/fcc/src/image-lab/prompt.ts`
- `proposal/fcc/src/image-lab/protocol.ts`
- `proposal/fcc/src/image-lab/samples.ts`
- `proposal/fcc/src/sections/DesignSystemSection.tsx`
- `proposal/fcc/src/sections/GreeceGridLab.tsx`
- `proposal/fcc/src/sections/ImageLabSection.tsx`
- `proposal/fcc/src/sections/Nav.tsx`
- `proposal/fcc/src/sections/landscape/SpreadMap.tsx`
- `proposal/fcc/tests/cartography.ts`
- `proposal/fcc/tests/console.ts`
- `proposal/fcc/tests/image-lab-grid.ts`
- `proposal/fcc/tests/image-lab-landscape.ts`
- `proposal/fcc/tests/image-lab.ts`
- `proposal/fcc/tests/monitoring-feeds.ts`
- `proposal/fcc/tests/monitoring.ts`
- `proposal/fcc/tests/motion.ts`
- `proposal/fcc/tests/spread-precision.ts`
- `proposal/fcc/vite.config.ts`
