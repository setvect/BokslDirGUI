#[cfg(all(test, windows))]
mod windows_tests;
mod platform;
mod path_text;
mod preview;
mod image_metadata;

mod archive;
mod archive_provider;
mod archive_tar;
mod commands;
mod contracts;
mod external;
#[cfg(any(windows, test))]
mod external_terminal;
#[cfg(windows)]
mod windows_shell;
#[cfg(windows)]
mod windows_open_with;
mod open_with;
mod file_clipboard;
mod bulk_rename;
mod filesystem;
mod mutation;
mod navigation;
mod operation;
mod settings_service;
#[cfg(any(windows, test))]
mod native_drop;
mod window_session;
mod shell_command;
mod remote;
mod watch_service;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod test_util;
use std::env;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    #[cfg(windows)]
    let context = {
        let mut context = context;
        native_drop::configure_windows(&mut context.config_mut().app.windows);
        context
    };
    tauri::Builder::default()
        .plugin(tauri_plugin_drag::init())
        .setup(|app| {
            archive_provider::set_resource_directory(app.path().resource_dir()?);
            window_session::restore(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(windows)]
            native_drop::forward(window, event);
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
            commands::unwatch_path,
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
            commands::open_current_in_file_manager,
            commands::open_current_in_terminal,
            commands::prepare_shell_command,
            commands::run_shell_command,
            commands::load_settings,
            commands::save_settings,
            commands::prepare_native_file_drag,
            commands::show_drop_overlay,
            commands::remote_connect,
            commands::remote_auth_respond,
            commands::remote_auth_cancel,
            commands::remote_trust_host_key,
            commands::remote_disconnect,
            commands::remote_sessions
        ])
        .run(context)
        .expect("failed to run BokslDirGUI Tauri application");
}

#[cfg(test)]
mod contract_tests;
