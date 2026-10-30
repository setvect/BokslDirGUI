import type { OperationSummary, PanelId } from '../domain/types';
import { OPERATION_DIALOG_TITLES, type SupportedLanguage } from '../i18n-resources';
import type { DialogKind } from '../operations/dialogDefinitions';
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

// 장기 작업 완료 공통 처리: 양쪽 패널 새로고침 뒤 "작업 이름 결과" 상태 메시지. 선택 해제 등 작업별 후처리는 호출부 담당.
// 작업 이름은 대화상자 제목(복사·이동 등): 반대 패널·붙여넣기·폴더 드롭 어느 대상이든 정확한 표기.
export const finishOperation = (
  target: OperationCompletionTarget,
  dialogKind: DialogKind,
  summary: OperationSummary,
  language: SupportedLanguage,
  options: { firstPanel?: PanelId; suffix?: string } = {},
) => {
  const firstPanel = options.firstPanel ?? 'left';
  target.refreshPanel(firstPanel, true);
  target.refreshPanel(oppositePanelOf(firstPanel), true);
  target.setStatusMessage(`${OPERATION_DIALOG_TITLES[language][dialogKind]} ${operationSummaryStatusLabel(summary, language)}${options.suffix ?? ''}`);
};
