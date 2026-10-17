#[cfg(all(test, windows))]
mod windows_tests;
mod platform;
mod path_text;
mod preview;
mod image_metadata;

mod archive;
mod commands;
mod contracts;
mod external;
mod open_with;
mod file_clipboard;
mod bulk_rename;
mod filesystem;
mod mutation;
mod navigation;
mod operation;
mod settings_service;
mod window_session;
mod shell_command;
#[cfg(test)]
mod tests;
use std::env;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_drag::init())
        .setup(|app| {
            window_session::restore(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            window_session::observe(window, event);
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(overlay) = window.app_handle().get_webview_window("drop-overlay") {
                    let _ = overlay.close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::health_check,
            commands::get_platform_info,
            commands::preview_trash_undo,
            commands::start_trash_undo,
            commands::preview_bulk_rename,
            commands::start_bulk_rename,
            commands::read_file_clipboard,
            commands::write_file_clipboard,
            commands::clear_file_clipboard,
            commands::list_dir,
            commands::get_metadata,
            commands::preview_file,
            commands::watch_path,
            commands::goto_path,
            commands::list_locations,
            commands::create_dir,
            commands::rename_entry,
            commands::start_copy,
            commands::start_move,
            commands::start_delete,
            commands::cancel_operation,
            commands::resolve_conflict,
            commands::archive_list,
            commands::archive_create,
            commands::archive_extract,
            commands::archive_add,
            commands::open_default,
            commands::list_open_with_apps,
            commands::open_with_app,
            commands::reveal_in_manager,
            commands::open_current_in_finder,
            commands::open_current_in_terminal,
            commands::prepare_shell_command,
            commands::run_shell_command,
            commands::load_settings,
            commands::save_settings,
            commands::show_drop_overlay,
            commands::hide_drop_overlay
        ])
        .run(tauri::generate_context!())
        .expect("failed to run BokslDirGUI Tauri application");
}

#[cfg(test)]
mod contract_tests;
