import type { ConsoleApi } from '../../contracts';
import type { Decision } from '../shell/OrchestratorCallout';
import { journal } from './journal';

export function applyDecision(decision: Decision, t: number, choice: 'approved' | 'rejected', api: Pick<ConsoleApi, 'approve' | 'reject' | 'acknowledge' | 'dismiss'>) {
  journal.record({ key: decision.key, t, decision: choice, title: decision.title, actionKind: decision.action?.kind });
  if (decision.action) {
    (choice === 'approved' ? api.approve : api.reject)(decision.action.id);
  } else if (decision.item) {
    (choice === 'approved' ? api.acknowledge : api.dismiss)(decision.item.id);
  }
}
