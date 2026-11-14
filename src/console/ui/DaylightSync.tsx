import { useEffect } from 'react';
import { setSolarDaylight } from '@ds';
import { consoleStore } from '../store';
import { daylight, sunPosition } from '../stage3d/sun';

/** A store subscription, not a React render or a second clock, drives the appearance. */
export function DaylightSync() {
  useEffect(() => {
    const sync = () => {
      const { pack, clock } = consoleStore.get();
      if (!pack) return;
      const b = pack.manifest.bbox;
      const c = pack.manifest.center ?? { lon: (b[0] + b[2]) / 2, lat: (b[1] + b[3]) / 2 };
      setSolarDaylight(daylight(sunPosition(clock.t, c.lat, c.lon).elDeg));
    };
    sync();
    const off = consoleStore.subscribe(sync);
    return () => { off(); setSolarDaylight(null); };
  }, []);
  return null;
}
