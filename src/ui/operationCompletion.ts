import { labelForAction, type AppAction } from '../actions/registry';
import type { OperationSummary, PanelId } from '../domain/types';
import type { SupportedLanguage } from '../i18n-resources';
import { operationSummaryStatusLabel } from '../operations/operationLabels';
import type { LongRunningOperationClient } from '../tauri/commanderClients';
import { oppositePanelOf } from './selectionModel';

export interface OperationCompletionTarget {
  readonly refreshPanel: (panel: PanelId, background?: boolean) => void;
  readonly setStatusMessage: (message: string) => void;
}

// 장기 작업 취소 요청의 공통 연결.
export const operationCanceller = (client: Pick<LongRunningOperationClient, 'cancelOperation'>) =>
  (operationId: string) => client.cancelOperation({ operationId });

// 장기 작업 완료 공통 처리: 양쪽 패널 새로고침 뒤 "액션 이름 결과" 상태 메시지. 선택 해제 등 작업별 후처리는 호출부 담당.
export const finishOperation = (
  target: OperationCompletionTarget,
  action: AppAction,
  summary: OperationSummary,
  language: SupportedLanguage,
  options: { firstPanel?: PanelId; suffix?: string } = {},
) => {
  const firstPanel = options.firstPanel ?? 'left';
  target.refreshPanel(firstPanel, true);
  target.refreshPanel(oppositePanelOf(firstPanel), true);
  target.setStatusMessage(`${labelForAction(action, language)} ${operationSummaryStatusLabel(summary, language)}${options.suffix ?? ''}`);
};
