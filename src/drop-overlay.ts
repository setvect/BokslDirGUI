import { nativeDropPosition } from './ui/nativeDropPosition';
import { emitTo } from '@tauri-apps/api/event';
import { getCurrentWebview, type DragDropEvent } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';

const NATIVE_FILE_DROP_EVENT = 'boksldir://native-file-drop';

const logicalDropEvent = (event: DragDropEvent) => {
  if (event.type === 'leave') {
    return event;
  }
  const position = nativeDropPosition(event.position, window.devicePixelRatio, navigator.platform);
  if (event.type === 'over') {
    return { type: event.type, position };
  }
  return { type: event.type, paths: event.paths, position };
};

void getCurrentWebview().onDragDropEvent(async ({ payload }) => {
  try {
    await emitTo('main', NATIVE_FILE_DROP_EVENT, logicalDropEvent(payload));
  } finally {
    if (payload.type === 'drop' || payload.type === 'leave') {
      await getCurrentWindow().hide();
    }
  }
});
