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
    let mut saved = settings_service::load_settings()
        .ok()
        .and_then(|settings| settings.window)
        .unwrap_or(WindowSettings { width: 1280, height: 820, maximized: false });
    if let (Ok(Some(monitor)), Ok(inner), Ok(outer)) = (
        window.current_monitor(), window.inner_size(), window.outer_size(),
    ) {
        let area = monitor.work_area();
        let (width, height) = fit_size(
            (saved.width, saved.height),
            (area.size.width, area.size.height),
            (outer.width.saturating_sub(inner.width), outer.height.saturating_sub(inner.height)),
            monitor.scale_factor(),
        );
        saved.width = width;
        saved.height = height;
    }
    if let Ok(mut latest) = LATEST_GEOMETRY.lock() {
        *latest = Some(saved.clone());
    }
    let _ = window.set_size(tauri::LogicalSize::new(saved.width, saved.height));
    if let (Ok(Some(monitor)), Ok(size)) = (window.current_monitor(), window.outer_size()) {
        let area = monitor.work_area();
        let _ = window.set_position(tauri::PhysicalPosition::new(
            area.position.x + (area.size.width.saturating_sub(size.width) / 2) as i32,
            area.position.y + (area.size.height.saturating_sub(size.height) / 2) as i32,
        ));
    }
    if saved.maximized {
        let _ = window.maximize();
    }
}

// Monitor work area excludes the taskbar; the window size API takes client size.
fn fit_size(desired: (u32, u32), work: (u32, u32), frame: (u32, u32), scale: f64) -> (u32, u32) {
    if !scale.is_finite() || scale <= 0.0 {
        return desired;
    }
    let width = (f64::from(work.0.saturating_sub(frame.0)) / scale).floor() as u32;
    let height = (f64::from(work.1.saturating_sub(frame.1)) / scale).floor() as u32;
    (desired.0.min(width.max(800)), desired.1.min(height.max(400)))
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
    if size.width < 800 || size.height < 400 {
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
    use super::{fit_size, geometry};
    #[test]
    fn initial_and_restored_sizes_fit_the_work_area_in_logical_pixels() {
        assert_eq!(fit_size((1280, 820), (1280, 752), (16, 39), 1.0), (1264, 713));
        assert_eq!(fit_size((1600, 1000), (2560, 1504), (32, 78), 2.0), (1264, 713));
        assert_eq!(fit_size((1280, 820), (1920, 1008), (24, 59), 1.5), (1264, 632));
        assert_eq!(fit_size((1280, 820), (1920, 984), (32, 78), 2.0), (944, 453));
        assert_eq!(fit_size((1100, 700), (1920, 1040), (16, 39), 1.0), (1100, 700));
        assert_eq!(fit_size((1280, 820), (0, 0), (16, 39), 1.0), (800, 400));
        assert_eq!(fit_size((1280, 820), (1280, 752), (16, 39), f64::NAN), (1280, 820));
    }
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
