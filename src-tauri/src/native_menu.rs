//! macOS 기본 메뉴 막대: Tauri 기본 메뉴와 같은 구성·시스템 동작(입력란 복사·붙여넣기, 창 닫기, 종료 등)에
//! 설정 언어의 제목만 입힘. 파일 관리 기능은 앱 화면 안 메뉴가 담당하고, 이 메뉴는 macOS 관례용.
#[cfg(target_os = "macos")]
use std::sync::{Mutex, OnceLock};

/// 기본 메뉴 막대의 제목. 시스템 항목의 동작은 그대로이고 표시 이름만 바꿈.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct NativeMenuText {
    pub(crate) about: &'static str,
    pub(crate) services: &'static str,
    pub(crate) hide: &'static str,
    pub(crate) hide_others: &'static str,
    pub(crate) quit: &'static str,
    pub(crate) file: &'static str,
    pub(crate) close_window: &'static str,
    pub(crate) edit: &'static str,
    pub(crate) undo: &'static str,
    pub(crate) redo: &'static str,
    pub(crate) cut: &'static str,
    pub(crate) copy: &'static str,
    pub(crate) paste: &'static str,
    pub(crate) select_all: &'static str,
    pub(crate) view: &'static str,
    pub(crate) fullscreen: &'static str,
    pub(crate) window: &'static str,
    pub(crate) minimize: &'static str,
    pub(crate) maximize: &'static str,
    pub(crate) help: &'static str,
}

/// 설정 언어(`ko`·`en`)의 제목. 알 수 없는 값은 앱 기본 언어인 한국어.
/// 한국어는 macOS 한국어판 메뉴 용어(오려두기·붙이기·전체 선택·가리기)를 따름.
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
pub(crate) fn text(language: &str) -> NativeMenuText {
    match language {
        "en" => NativeMenuText {
            about: "About BokslDir",
            services: "Services",
            hide: "Hide BokslDir",
            hide_others: "Hide Others",
            quit: "Quit BokslDir",
            file: "File",
            close_window: "Close Window",
            edit: "Edit",
            undo: "Undo",
            redo: "Redo",
            cut: "Cut",
            copy: "Copy",
            paste: "Paste",
            select_all: "Select All",
            view: "View",
            fullscreen: "Enter Full Screen",
            window: "Window",
            minimize: "Minimize",
            maximize: "Zoom",
            help: "Help",
        },
        _ => NativeMenuText {
            about: "복슬Dir에 관하여",
            services: "서비스",
            hide: "복슬Dir 가리기",
            hide_others: "기타 가리기",
            quit: "복슬Dir 종료",
            file: "파일",
            close_window: "윈도우 닫기",
            edit: "편집",
            undo: "실행 취소",
            redo: "실행 복귀",
            cut: "오려두기",
            copy: "복사하기",
            paste: "붙이기",
            select_all: "전체 선택",
            view: "보기",
            fullscreen: "전체 화면 시작",
            window: "윈도우",
            minimize: "최소화",
            maximize: "확대/축소",
            help: "도움말",
        },
    }
}

/// Tauri `Menu::default`와 같은 구성(macOS)을 설정 언어 제목으로 만듦.
#[cfg(target_os = "macos")]
pub(crate) fn build<R: tauri::Runtime>(app: &tauri::AppHandle<R>, language: &str) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{AboutMetadata, Menu, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID, WINDOW_SUBMENU_ID};
    let text = text(language);
    let package = app.package_info();
    let about = AboutMetadata {
        name: Some(package.name.clone()),
        version: Some(package.version.to_string()),
        ..Default::default()
    };
    let window = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        text.window,
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(text.minimize))?,
            &PredefinedMenuItem::maximize(app, Some(text.maximize))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some(text.close_window))?,
        ],
    )?;
    let help = Submenu::with_id_and_items(app, HELP_SUBMENU_ID, text.help, true, &[])?;
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                package.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app, Some(text.about), Some(about))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, Some(text.services))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, Some(text.hide))?,
                    &PredefinedMenuItem::hide_others(app, Some(text.hide_others))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, Some(text.quit))?,
                ],
            )?,
            &Submenu::with_items(app, text.file, true, &[&PredefinedMenuItem::close_window(app, Some(text.close_window))?])?,
            &Submenu::with_items(
                app,
                text.edit,
                true,
                &[
                    &PredefinedMenuItem::undo(app, Some(text.undo))?,
                    &PredefinedMenuItem::redo(app, Some(text.redo))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, Some(text.cut))?,
                    &PredefinedMenuItem::copy(app, Some(text.copy))?,
                    &PredefinedMenuItem::paste(app, Some(text.paste))?,
                    &PredefinedMenuItem::select_all(app, Some(text.select_all))?,
                ],
            )?,
            &Submenu::with_items(app, text.view, true, &[&PredefinedMenuItem::fullscreen(app, Some(text.fullscreen))?])?,
            &window,
            &help,
        ],
    )
}

/// 앱 시작 때 기억해 둔 핸들과 현재 메뉴 언어. 설정 저장 명령이 언어 변경을 알려 줌.
#[cfg(target_os = "macos")]
fn state() -> &'static OnceLock<(tauri::AppHandle, Mutex<String>)> {
    static STATE: OnceLock<(tauri::AppHandle, Mutex<String>)> = OnceLock::new();
    &STATE
}

#[cfg(target_os = "macos")]
pub(crate) fn remember(app: tauri::AppHandle, language: &str) {
    let _ = state().set((app, Mutex::new(language.to_string())));
}

/// 설정 언어가 바뀌면 기본 메뉴 막대를 다시 만듦(macOS 외에는 메뉴 막대가 없어 아무 일 없음).
pub(crate) fn apply_language(language: &str) {
    #[cfg(target_os = "macos")]
    if let Some((app, current)) = state().get() {
        let mut current = current.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if *current != language {
            if let Ok(menu) = build(app, language) {
                if app.set_menu(menu).is_ok() {
                    *current = language.to_string();
                }
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = language;
}

#[cfg(test)]
mod tests {
    use super::text;

    fn titles(language: &str) -> Vec<&'static str> {
        let text = text(language);
        vec![
            text.about, text.services, text.hide, text.hide_others, text.quit, text.file, text.close_window, text.edit,
            text.undo, text.redo, text.cut, text.copy, text.paste, text.select_all, text.view, text.fullscreen,
            text.window, text.minimize, text.maximize, text.help,
        ]
    }

    #[test]
    fn korean_menu_titles_are_korean_and_english_titles_are_english() {
        let hangul = |title: &str| title.chars().any(|ch| ('\u{AC00}'..='\u{D7A3}').contains(&ch));
        assert!(titles("ko").iter().all(|title| hangul(title)), "{:?}", titles("ko"));
        assert!(titles("en").iter().all(|title| !hangul(title)), "{:?}", titles("en"));
        assert_eq!(text("ko").paste, "붙이기");
        assert_eq!(text("en").select_all, "Select All");
    }

    #[test]
    fn unknown_languages_fall_back_to_the_default_korean_titles() {
        assert_eq!(text("fr"), text("ko"));
        assert_eq!(text(""), text("ko"));
    }
}
