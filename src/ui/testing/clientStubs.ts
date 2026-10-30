// 테스트용 클라이언트 스텁과 설정·플랫폼·진행률 기본값의 단일 정의.
import { vi } from 'vitest';
import type { OperationProgress, PlatformInfo, Settings } from '../../domain/types';
import type { LongRunningOperationClient, RemoteSessionClient, SafeMutationClient } from '../../tauri/commanderClients';
import platformFixtures from '../../tauri/fixtures/platform.json';

export const operationClientStub = <T extends Partial<LongRunningOperationClient> = object>(overrides = {} as T) => ({
  startCopy: vi.fn(),
  startMove: vi.fn(),
  startDelete: vi.fn(),
  cancelOperation: vi.fn(),
  resolveConflict: vi.fn(),
  ...overrides,
});

export const mutationClientStub = <T extends Partial<SafeMutationClient> = object>(overrides = {} as T) => ({
  createDir: vi.fn(),
  renameEntry: vi.fn(),
  ...overrides,
});

export const remoteClientStub = <T extends Partial<RemoteSessionClient> = object>(overrides = {} as T) => ({
  remoteConnect: vi.fn(),
  remoteAuthRespond: vi.fn(),
  remoteAuthCancel: vi.fn(),
  remoteTrustHostKey: vi.fn(),
  remoteDisconnect: vi.fn(),
  remoteSessions: vi.fn(async () => ({ ok: true as const, data: [] })),
  listenRemoteConnectionChanges: vi.fn(async () => () => undefined),
  remoteForgetSecret: vi.fn(async () => ({ ok: true as const, data: undefined })),
  remoteImportSshConfig: vi.fn(async () => ({ ok: true as const, data: { entries: [], warnings: [] } })),
  ...overrides,
});

export const settingsFixture = (overrides: Partial<Settings> = {}): Settings => ({
  schemaVersion: 1,
  theme: 'dark',
  language: 'ko',
  sizeFormat: 'binary',
  external: { editorId: null, shellCommand: { enabled: false } },
  bookmarks: [],
  layout: { singlePanel: false, ratio: '50:50' },
  session: { leftPath: null, rightPath: null, activePanel: 'right' },
  view: { zoomStep: 0, density: 'compact', showIcons: true },
  ...overrides,
});

export const platformInfoFixture = (os: 'macos' | 'windows', features: Partial<PlatformInfo['features']> = {}): PlatformInfo => {
  const platform = platformFixtures.find((candidate) => candidate.os === os)!;
  return { ...platform, features: { ...platform.features, ...features } };
};

export const runningProgress = (overrides: Partial<OperationProgress> = {}): OperationProgress => ({
  operationId: 'op-running',
  kind: 'copy',
  state: 'running',
  totalFiles: 1,
  completedFiles: 0,
  totalBytes: null,
  completedBytes: 0,
  currentPath: null,
  bytesPerSecond: null,
  etaSeconds: null,
  recentErrorCount: 0,
  ...overrides,
});
