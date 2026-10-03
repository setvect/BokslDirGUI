use crate::contracts::WindowSettings;
use crate::settings_service;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

static LATEST_GEOMETRY: Mutex<Option<WindowSettings>> = Mutex::new(None);
static WINDOW_SAVE_LOCK: Mutex<()> = Mutex::new(());
static RESIZE_VERSION: AtomicU64 = AtomicU64::new(0);

pub(crate) fn restore(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Ok(settings) = settings_service::load_settings() else {
        return;
    };
    if let Some(saved) = settings.window {
        if let Ok(mut latest) = LATEST_GEOMETRY.lock() {
            *latest = Some(saved.clone());
        }
        let _ = window.set_size(tauri::LogicalSize::new(saved.width, saved.height));
        if saved.maximized {
            let _ = window.maximize();
        }
    }
}

pub(crate) fn observe(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() != "main" {
        return;
    }
    let closing = matches!(event, tauri::WindowEvent::CloseRequested { .. });
    if !closing && !matches!(event, tauri::WindowEvent::Resized(_)) {
        return;
    }
    let (Ok(size), Ok(scale), Ok(maximized)) = (
        window.inner_size(),
        window.scale_factor(),
        window.is_maximized(),
    ) else {
        return;
    };
    let size = size.to_logical::<u32>(scale);
    if size.width < 1080 || size.height < 680 {
        return;
    }
    // 저장 지연 중 최대화되더라도 바로 직전의 일반 창 크기 보존.
    let saved = {
        let Ok(mut latest) = LATEST_GEOMETRY.lock() else {
            return;
        };
        let previous = latest.clone().or_else(|| {
            settings_service::load_settings()
                .ok()
                .and_then(|settings| settings.window)
        });
        let saved = geometry(size.width, size.height, maximized, previous);
        *latest = Some(saved.clone());
        saved
    };
    let version = RESIZE_VERSION.fetch_add(1, Ordering::SeqCst) + 1;
    let persist = move || {
        let Ok(_guard) = WINDOW_SAVE_LOCK.lock() else {
            return;
        };
        if RESIZE_VERSION.load(Ordering::SeqCst) != version {
            return;
        }
        // 창 이벤트의 오류가 앱 종료나 다른 설정 저장을 중단하지 않도록 처리.
        if let Err(error) = settings_service::save_settings(serde_json::json!({ "window": saved }))
        {
            eprintln!("window state save failed: {}", error.code);
        }
    };
    if closing {
        persist();
    } else {
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(250));
            persist();
        });
    }
}

fn geometry(
    width: u32,
    height: u32,
    maximized: bool,
    previous: Option<WindowSettings>,
) -> WindowSettings {
    let normal = previous.unwrap_or(WindowSettings {
        width: 1280,
        height: 820,
        maximized: false,
    });
    WindowSettings {
        width: if maximized {
            normal.width
        } else {
            width.min(16384)
        },
        height: if maximized {
            normal.height
        } else {
            height.min(16384)
        },
        maximized,
    }
}

#[cfg(test)]
mod tests {
    use super::geometry;
    #[test]
    fn maximization_preserves_the_normal_window_size() {
        let normal = geometry(1400, 900, false, None);
        let maximized = geometry(2500, 1500, true, Some(normal));
        assert_eq!(
            (maximized.width, maximized.height, maximized.maximized),
            (1400, 900, true)
        );
        let restored = geometry(1500, 1000, false, Some(maximized));
        assert_eq!(
            (restored.width, restored.height, restored.maximized),
            (1500, 1000, false)
        );
    }
}
