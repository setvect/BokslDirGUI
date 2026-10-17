import { useEffect, useState } from 'react';
import type { PlatformInfo } from '../domain/types';
import type { SafeMutationClient } from '../tauri/commanderClients';

const UNKNOWN_PLATFORM: PlatformInfo = {
  os: 'unknown',
  features: { openWith: false, currentFolderManager: false, currentFolderTerminal: false, nativeFileClipboard: false, trashUndo: false },
};

export function useRuntimePlatform(client: SafeMutationClient, available: boolean) {
  const [resolved, setResolved] = useState<{ client: SafeMutationClient; info: PlatformInfo } | null>(null);
  useEffect(() => {
    let alive = true;
    if (available && client.getPlatformInfo) {
      void client.getPlatformInfo().then(result => {
        if (alive) setResolved({ client, info: result.ok ? result.data : UNKNOWN_PLATFORM });
      }).catch(() => { if (alive) setResolved({ client, info: UNKNOWN_PLATFORM }); });
    }
    return () => { alive = false; };
  }, [client, available]);
  if (!available || !client.getPlatformInfo) return undefined; // 브라우저 fixture의 기존 입력 모델 유지.
  return resolved?.client === client ? resolved.info : UNKNOWN_PLATFORM;
}
