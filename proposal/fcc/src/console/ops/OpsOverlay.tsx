import { useEffect, useMemo } from 'react';
import * as Cesium from 'cesium';
import { color } from '@ds';
import type { Geo } from '../contracts';
import { useConsoleSelector } from '../store';
import { localTime, packZone } from '../ui/format';
import type { StageEngine } from '../stage3d/StageEngine';
import {
  NO_EXIT_ZONES, STAGE_RANK, accent, cesiumOf, danger, neutralCol, placeAlerts,
  useAlertVersion, warnCol, type Routes,
} from './alerts';

const FONT = '600 11px "Geist Mono Variable", ui-monospace, monospace';
const FONT_LG = '700 13px "Geist Mono Variable", ui-sans-serif, sans-serif';

const cart = (g: Geo, h = 0) => Cesium.Cartesian3.fromDegrees(g.lon, g.lat, h);
const line = (pts: Geo[]) => pts.map((p) => cart(p));
const ring = (c: Geo, rM: number, n = 48): Geo[] => {
  const out: Geo[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ lon: c.lon + (rM / 111320) * Math.cos(a) / Math.cos((c.lat * Math.PI) / 180), lat: c.lat + (rM / 110540) * Math.sin(a) });
  }
  return out;
};

const BAND_STYLE: Record<number, { fill: number; w: number; dash?: number }> = {
  60: { fill: 0.28, w: 4 },
  180: { fill: 0.18, w: 3, dash: 14 },
  360: { fill: 0.07, w: 1.5, dash: 8 },
};
const STAGE_LABEL: Record<string, string> = { leave: 'LEAVE NOW', shelter: 'SHELTER IN PLACE', prepare: 'PREPARE', monitor: 'MONITOR' };

export function OpsOverlay({ engine, routes, showRoutes, showZones, home }: {
  engine: StageEngine | null;
  routes: Routes;
  showRoutes: boolean;
  showZones: boolean;
  home: Geo | null;
}) {
  const pack = useConsoleSelector((s) => s.pack);
  const t = useConsoleSelector((s) => Math.floor(s.clock.t / 60000) * 60000); // minute bucket: entities rebuild at most 1/min
  const proj = useConsoleSelector((s) => s.projection);
  const rev = proj?.rev ?? -1;
  const alertV = useAlertVersion();
  const tz = packZone(pack).label;
  const alerts = useMemo(() => placeAlerts(pack, t), [pack, t, alertV]);

  useEffect(() => {
    if (!engine) return;
    const viewer = engine.viewer;
    const ds = new Cesium.CustomDataSource('ops-alerts');
    viewer.dataSources.add(ds);
    if (import.meta.env.DEV) (window as unknown as { __opsDs?: Cesium.CustomDataSource }).__opsDs = ds;
    const e = ds.entities;
    const red = danger();
    const chipBg = cesiumOf(color.ink[950], 0.7);
    const chipPad = new Cesium.Cartesian2(4, 2);

    // Red projection bands (draw 6H first so 1H stays on top).
    if (proj) {
      for (const b of [...proj.bands].sort((a, z) => z.horizonMin - a.horizonMin)) {
        if (b.polygon.length < 3) continue;
        const st = BAND_STYLE[b.horizonMin] ?? BAND_STYLE[360]!;
        e.add({
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(line(b.polygon)),
            material: red.withAlpha(st.fill),
            classificationType: Cesium.ClassificationType.BOTH,
          },
        });
        e.add({
          polyline: {
            positions: line([...b.polygon, b.polygon[0]]),
            clampToGround: true,
            width: st.w,
            material: st.dash
              ? new Cesium.PolylineDashMaterialProperty({ color: red.withAlpha(0.95), dashLength: st.dash })
              : new Cesium.ColorMaterialProperty(red.withAlpha(0.98)),
          },
        });
        // Band label at the vertex farthest from the fire origin along the head direction.
        const origin = { lon: 23.95191, lat: 38.03991 };
        let far = b.polygon[0]!, farD = -1;
        for (const p of b.polygon) {
          const d = (p.lon - origin.lon) ** 2 + (p.lat - origin.lat) ** 2;
          if (d > farD) { farD = d; far = p; }
        }
        const at = localTime(t + b.horizonMin * 60000, tz);
        e.add({
          position: cart(far, 40),
          label: {
            text: `+${b.horizonMin / 60}H · ${at}`,
            font: FONT_LG, fillColor: red.withAlpha(0.98), style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            outlineColor: cesiumOf(color.void, 0.9), outlineWidth: 4,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER, verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -6), disableDepthTestDistance: Number.POSITIVE_INFINITY,
            backgroundColor: chipBg, showBackground: true, backgroundPadding: chipPad,
          },
        });
      }
    }

    // Place rings + alert labels for places in the path.
    for (const p of alerts) {
      if (p.eta == null || p.stage === 'monitor') continue;
      const col = STAGE_RANK[p.stage] >= 2 ? red : p.stage === 'prepare' ? warnCol() : neutralCol();
      e.add({
        polyline: { positions: line(ring(p.pos, 260)), clampToGround: true, width: 2.5, material: new Cesium.ColorMaterialProperty(col.withAlpha(0.95)) },
      });
      e.add({
        position: cart({ lon: p.pos.lon, lat: p.pos.lat + 0.0035 }, 60),
        label: {
          text: `${p.name} · ETA ${localTime(p.eta, tz)} · ${STAGE_LABEL[p.stage]}`,
          font: FONT, fillColor: col, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          outlineColor: cesiumOf(color.void, 0.9), outlineWidth: 3,
          backgroundColor: chipBg, showBackground: true, backgroundPadding: chipPad,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER, verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -4), disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }

    // Escape routes from home.
    if (showRoutes && home && routes.best) {
      const ac = accent();
      for (const [i, r] of [routes.best, routes.second].entries()) {
        if (!r) continue;
        e.add({
          polyline: {
            positions: line(r.path), clampToGround: true,
            width: i === 0 ? 6 : 2,
            material: new Cesium.ColorMaterialProperty(ac.withAlpha(i === 0 ? 0.95 : 0.4)),
          },
        });
        if (i === 0) {
          e.add({
            position: cart(r.exit.pos, 40),
            label: {
              text: `EXIT · ${r.exit.label.toUpperCase()}`,
              font: FONT, fillColor: ac, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              outlineColor: cesiumOf(color.void, 0.9), outlineWidth: 3,
              backgroundColor: chipBg, showBackground: true, backgroundPadding: chipPad,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -6),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
        }
      }
    }

    // No-exit zones (Mati coast dead end).
    if (showZones) {
      for (const z of NO_EXIT_ZONES) {
        e.add({
          polyline: { positions: line(ring(z.center, z.radiusM)), clampToGround: true, width: 2, material: new Cesium.PolylineDashMaterialProperty({ color: red.withAlpha(0.9), dashLength: 8 }) },
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(line(ring(z.center, z.radiusM))),
            material: red.withAlpha(0.08), classificationType: Cesium.ClassificationType.BOTH,
          },
        });
        e.add({
          position: cart(z.center, 40),
          label: {
            text: `${z.label.toUpperCase()} · NO ROAD EXIT`,
            font: FONT, fillColor: red, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            outlineColor: cesiumOf(color.void, 0.9), outlineWidth: 3,
            backgroundColor: chipBg, showBackground: true, backgroundPadding: chipPad,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -4),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }
    }

    return () => { viewer.dataSources.remove(ds, true); };
  }, [engine, proj, rev, alerts, routes, showRoutes, showZones, home, t, tz]);

  return null;
}
