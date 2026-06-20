export type SupportedLanguage = 'ko' | 'en';

export const I18N_RESOURCES: Record<SupportedLanguage, Record<string, string>> = {
  ko: {
    'app.name': 'BokslDirGUI',
    'errors.notFound': '대상을 찾을 수 없습니다.',
    'errors.notDirectory': '디렉터리가 아닙니다.',
    'errors.permissionDenied': '권한이 거부되었습니다.',
    'errors.invalidPath': '잘못된 경로입니다.',
    'errors.invalidName': '잘못된 이름입니다.',
    'errors.alreadyExists': '이미 같은 이름의 항목이 있습니다.',
    'errors.commandNotImplemented': '이 작업은 아직 사용할 수 없습니다.',
    'errors.commandNotConnected': '이 작업은 아직 실행할 수 없습니다.',
    'errors.tauriInvokeFailed': '앱 명령 실행에 실패했습니다.',
    'errors.confirmationRequired': '표시된 확인 문구를 정확히 입력하세요.',
    'errors.shellCommandDisabled': '쉘 명령 실행은 기본 비활성입니다.',
    'errors.invalidShellCommand': '실행할 쉘 명령을 입력해야 합니다.',
    'errors.externalEditorNotConfigured': '외부 편집기가 설정되지 않았습니다.',
    'errors.archiveFormatUnsupported': '지원하지 않는 압축 형식입니다.',
    'errors.archivePasswordListUnsupported': '암호 압축 목록 보기는 아직 지원하지 않습니다.',
    'errors.archivePasswordUnsupported': '암호 압축 작업은 아직 지원하지 않습니다.',
    'errors.archiveProviderUnavailable': '압축 제공자를 찾을 수 없습니다.',
    'errors.archiveSourcesMustShareParent': '압축할 항목은 같은 부모 디렉터리에 있어야 합니다.',
    'errors.archiveUnsafePath': '압축 파일에 안전하지 않은 경로가 포함되어 있습니다.',
    'errors.externalCommandFailed': '외부 명령 실행에 실패했습니다.',
    'errors.operationBusy': '다른 파일 작업이 진행 중입니다.',
    'errors.operationEventListenFailed': '파일 작업 진행 상태를 확인하지 못했습니다.',
    'errors.settingsSaveFailed': '설정 저장에 실패했습니다.',
    'settings.external.shellCommand.disabledByDefault': '안전을 위해 쉘 명령 실행은 기본 비활성입니다.',
    'operations.backendExecution.stubbedUntilCommandWiring': '이 화면은 실행 전 확인용 미리보기입니다.',
    'external.dryRun': '외부 앱 실행을 확인했습니다.',
  },
  en: {
    'app.name': 'BokslDirGUI',
    'errors.notFound': 'The target was not found.',
    'errors.notDirectory': 'The target is not a directory.',
    'errors.permissionDenied': 'Permission was denied.',
    'errors.invalidPath': 'The path is invalid.',
    'errors.invalidName': 'The name is invalid.',
    'errors.alreadyExists': 'An item with the same name already exists.',
    'errors.commandNotImplemented': 'This action is not available yet.',
    'errors.commandNotConnected': 'This action cannot be run yet.',
    'errors.tauriInvokeFailed': 'The app command failed.',
    'errors.confirmationRequired': 'Type the displayed confirmation phrase exactly.',
    'errors.shellCommandDisabled': 'Shell command execution is disabled by default.',
    'errors.invalidShellCommand': 'Enter a shell command to run.',
    'errors.externalEditorNotConfigured': 'No external editor is configured.',
    'errors.archiveFormatUnsupported': 'The archive format is not supported.',
    'errors.archivePasswordListUnsupported': 'Password-protected archive listing is not supported yet.',
    'errors.archivePasswordUnsupported': 'Password-protected archive operations are not supported yet.',
    'errors.archiveProviderUnavailable': 'No archive provider is available.',
    'errors.archiveSourcesMustShareParent': 'Archive sources must share the same parent directory.',
    'errors.archiveUnsafePath': 'The archive contains an unsafe path.',
    'errors.externalCommandFailed': 'The external command failed.',
    'errors.operationBusy': 'Another file operation is already running.',
    'errors.operationEventListenFailed': 'Could not update file operation progress.',
    'errors.settingsSaveFailed': 'Failed to save settings.',
    'settings.external.shellCommand.disabledByDefault': 'Shell command execution is disabled by default for safety.',
    'operations.backendExecution.stubbedUntilCommandWiring': 'This screen is a preview before running the action.',
    'external.dryRun': 'External app launch was checked.',
  },
} as const;

export const translateMessageKey = (language: SupportedLanguage, key: string) =>
  I18N_RESOURCES[language][key] ?? key;

const FALLBACK_USER_MESSAGES: Record<SupportedLanguage, string> = {
  ko: '작업을 완료하지 못했습니다.',
  en: 'The operation could not be completed.',
};

export const translateUserMessageKey = (
  language: SupportedLanguage,
  key: string | null | undefined,
) => {
  if (!key) {
    return FALLBACK_USER_MESSAGES[language];
  }
  return I18N_RESOURCES[language][key] ?? FALLBACK_USER_MESSAGES[language];
};

export const formatUserErrorMessage = (
  language: SupportedLanguage,
  error: { messageKey: string; path?: string | null },
) => {
  const message = translateUserMessageKey(language, error.messageKey);
  return error.path ? `${message} · ${error.path}` : message;
};
