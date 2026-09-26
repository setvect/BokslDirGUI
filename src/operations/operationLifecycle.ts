import type {
  AppError,
  OperationProgress,
  OperationState,
  OperationSummary
} from '../domain/types';
import { ActiveOperationController, OperationStoreState } from './operationTypes';

export const isTerminalState = (state: OperationState) =>
  state === 'completed' || state === 'completedWithErrors' || state === 'failed' || state === 'cancelled';

const isPendingOperationId = (operationId: string) => operationId.startsWith('pending-');

export const isPendingAliasForUnboundController = (
  progress: OperationProgress,
  controller: ActiveOperationController | null,
) => isPendingOperationId(progress.operationId) && Boolean(controller) && !controller?.operationId;

export const isOperationInFlight = (state: Pick<OperationStoreState, 'progress' | 'activeOperationController'>) =>
  Boolean(state.activeOperationController) || Boolean(state.progress && !isTerminalState(state.progress.state));

const MAX_OPERATION_HISTORY = 50;

export const appendOperationHistory = (history: OperationSummary[], summary: OperationSummary) => [
  summary,
  ...history.filter((item) => item.operationId !== summary.operationId),
].slice(0, MAX_OPERATION_HISTORY);

export const appError = (code: string, messageKey: string, path: string | null, recoverable: boolean): AppError => ({
  code,
  messageKey,
  path,
  details: null,
  recoverable,
});

export const allowedOperationTransitions: Record<OperationState, OperationState[]> = {
  idle: ['validating'],
  validating: ['scanning', 'failed', 'cancelled'],
  scanning: ['queued', 'failed', 'cancelled'],
  queued: ['running', 'cancelled'],
  running: ['waitingForConflict', 'completed', 'completedWithErrors', 'failed', 'cancelling'],
  waitingForConflict: ['running', 'cancelled', 'cancelling'],
  cancelling: ['cancelled', 'completedWithErrors'],
  completed: [],
  completedWithErrors: [],
  failed: [],
  cancelled: [],
};

export const canTransitionOperation = (from: OperationState, to: OperationState) =>
  allowedOperationTransitions[from].includes(to);
