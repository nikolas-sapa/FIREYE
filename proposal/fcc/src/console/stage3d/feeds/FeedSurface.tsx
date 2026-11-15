import { useStageSync } from '../sync';
import { FeedSurfaceView, type FeedSurfaceProps } from './FeedSurfaceView';

/** Simulated live camera view of a feed. Reads the store; place inside any sized box (fills it). */
export function FeedSurface(props: FeedSurfaceProps) {
  useStageSync();
  return <FeedSurfaceView {...props} />;
}
