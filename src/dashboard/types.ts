import type { useSim } from '@/sim';
import type { Vec } from '@/sim/types';

export type Sim = ReturnType<typeof useSim>;
export type DrawerId = 'forces' | 'feeds' | 'agents' | 'layers' | 'log';
export type ViewMode = 'calm' | 'detail';
export type MapMode = 'ortho' | 'oblique';

/** Console-level actions shared by the dock, drawers and map overlays. */
export interface ConsoleActions {
  flyTo(pos: Vec, zoom?: number): void;
  select(id: string | null): void;
  openFeed(feedId: string, caption?: string): void;
  focusAlert(alertId: string): void;
  openDrawer(id: DrawerId | null): void;
}
