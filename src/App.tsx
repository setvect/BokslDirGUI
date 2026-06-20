import { CommanderShell } from './ui/CommanderShell';
import { isTauriRuntime } from './tauri/client';
import { createFixturePanelDataSource } from './ui/panelDataSource';

export function App() {
  const backendAvailable = isTauriRuntime();
  return (
    <CommanderShell
      dataSource={backendAvailable ? undefined : createFixturePanelDataSource()}
      runtimeBackendAvailable={backendAvailable}
    />
  );
}
