import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

export const projectRoot = fileURLToPath(new URL('..', import.meta.url));

// 실제 TypeScript 정의를 읽되 HTTP/WebSocket 리스너와 파일 감시는 생성하지 않음.
export async function loadFeatureMetadata() {
  const server = await createServer({
    configFile: false,
    root: projectRoot,
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  try {
    const [registry, commands, dialogs, validation] = await Promise.all([
      server.ssrLoadModule('/src/actions/registry.ts'),
      server.ssrLoadModule('/src/tauri/commands.ts'),
      server.ssrLoadModule('/src/operations/dialogDefinitions.ts'),
      server.ssrLoadModule('/src/verification/featureContracts.ts'),
    ]);
    return { actions: registry.ACTIONS, commands: commands.COMMANDS, dialogs: dialogs.DIALOG_DEFINITIONS, validation };
  } finally {
    await server.close();
  }
}
