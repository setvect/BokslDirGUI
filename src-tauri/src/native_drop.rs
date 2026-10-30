//! Windows receives OS drops on the main window, without a second WebView target.
use crate::path_text::display_path;
use serde_json::{json, Value};
use tauri::DragDropEvent;
#[cfg(windows)]
use tauri::{Emitter, Manager};

pub(crate) fn configure_windows(windows: &mut [tauri::utils::config::WindowConfig]) {
    for window in windows {
        if window.label == "main" { window.drag_drop_enabled = true; }
        if window.label == "drop-overlay" { window.create = false; }
    }
}

// 프론트 `src/tauri/commands.ts`의 `EVENTS.nativeFileDrop`과 같은 이름(contract.test.ts가 대조).
#[cfg(windows)]
const NATIVE_FILE_DROP_EVENT: &str = "boksldir://native-file-drop";

#[cfg(windows)]
pub(crate) fn forward(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() != "main" { return; }
    let tauri::WindowEvent::DragDrop(event) = event else { return; };
    let Some(payload) = logical_event(event, window.scale_factor().unwrap_or(1.0)) else { return; };
    let _ = window.app_handle().emit_to("main", NATIVE_FILE_DROP_EVENT, payload);
}

#[cfg(windows)]
pub(crate) fn prepare_paths(paths: Vec<String>) -> crate::contracts::CommandResult<Vec<String>> {
    use crate::{contracts::AppError, navigation, platform, windows_shell};
    if paths.is_empty() {
        return Err(AppError::new("invalid_path", "errors.emptyOperation", None, true));
    }
    paths.into_iter().map(|raw| {
        let path = navigation::canonical_existing_entry(&raw)?;
        platform::entry_metadata(&path)?;
        Ok(display_path(&windows_shell::compatible_path(&path)))
    }).collect()
}

fn logical_event(event: &DragDropEvent, scale: f64) -> Option<Value> {
    let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    let position = |point: &tauri::PhysicalPosition<f64>| json!({ "x": point.x / scale, "y": point.y / scale });
    let paths = |paths: &[std::path::PathBuf]| paths.iter().map(|path| display_path(path)).collect::<Vec<_>>();
    Some(match event {
        DragDropEvent::Enter { paths: entries, position: point } => json!({ "type": "enter", "paths": paths(entries), "position": position(point) }),
        DragDropEvent::Over { position: point } => json!({ "type": "over", "position": position(point) }),
        DragDropEvent::Drop { paths: entries, position: point } => json!({ "type": "drop", "paths": paths(entries), "position": position(point) }),
        DragDropEvent::Leave => json!({ "type": "leave" }),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::{configure_windows, logical_event};
    use serde_json::json;
    use tauri::{DragDropEvent, PhysicalPosition};

    #[test]
    fn windows_uses_the_main_drop_target_without_an_overlay() {
        use tauri::utils::config::WindowConfig;
        let mut windows = vec![
            WindowConfig { label: "main".into(), drag_drop_enabled: false, ..Default::default() },
            WindowConfig { label: "drop-overlay".into(), ..Default::default() },
            WindowConfig { label: "other".into(), drag_drop_enabled: false, ..Default::default() },
        ];
        configure_windows(&mut windows);
        assert!(windows[0].create && windows[0].drag_drop_enabled);
        assert!(!windows[1].create);
        assert!(windows[2].create && !windows[2].drag_drop_enabled);
    }

    #[test]
    fn native_drop_preserves_paths_and_converts_physical_coordinates_once() {
        let paths = vec![std::path::PathBuf::from(r"C:\한글 폴더\file.txt ")];
        let position = PhysicalPosition::new(450.0, 300.0);
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let expected = json!({"type":"drop", "paths":[r"C:\한글 폴더\file.txt "],
                "position":{"x":450.0 / scale,"y":300.0 / scale}});
            assert_eq!(logical_event(&DragDropEvent::Drop { paths: paths.clone(), position }, scale), Some(expected));
        }
        assert_eq!(logical_event(&DragDropEvent::Over { position }, f64::NAN),
            Some(json!({"type":"over","position":{"x":450.0,"y":300.0}})));
        assert_eq!(logical_event(&DragDropEvent::Leave, 1.0), Some(json!({"type":"leave"})));
    }
}
