import { emitTo } from '@tauri-apps/api/event';
import { getCurrentWebview, type DragDropEvent } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';

const NATIVE_FILE_DROP_EVENT = 'boksldir://native-file-drop';

const logicalDropEvent = (event: DragDropEvent) => {
  if (event.type === 'leave') {
    return event;
  }
  const scaleFactor = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
    ? window.devicePixelRatio
    : 1;
  const position = {
    x: event.position.x / scaleFactor,
    y: event.position.y / scaleFactor,
  };
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
