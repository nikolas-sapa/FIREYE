import { useEffect } from 'react';
import { claimSolarDaylight } from '@ds';
import { consoleStore } from '../store';
import { daylight, sunPosition } from '../stage3d/sun';

/** A store subscription, not a React render or a second clock, drives the appearance. */
export function DaylightSync() {
  useEffect(() => {
    const claim = claimSolarDaylight();
    const sync = () => {
      const { pack, clock } = consoleStore.get();
      if (!pack) return;
      const b = pack.manifest.bbox;
      const c = pack.manifest.center ?? { lon: (b[0] + b[2]) / 2, lat: (b[1] + b[3]) / 2 };
      claim.set(daylight(sunPosition(clock.t, c.lat, c.lon).elDeg));
    };
    sync();
    const off = consoleStore.subscribe(sync);
    return () => { off(); claim.release(); };
  }, []);
  return null;
}
