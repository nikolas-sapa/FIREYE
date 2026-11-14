import { useConsoleApi } from '../store';
import { StageView, type StageProps } from './StageView';
import { useStageSync } from './sync';

/** The main 3D globe. Reads the console store; reacts to state.stage and stage directives. */
export function Stage(props: StageProps) {
  useStageSync();
  const api = useConsoleApi();
  return <StageView {...props} onFocusRequest={(g, r) => api.focus(g, r)} />;
}
