; settings_service::settings_path uses the shared BokslDirGUI directory,
; whereas Tauri's default cleanup only covers the bundle identifier directory.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    ; Remove only the application's known files; preserve unrelated contents.
    ; Custom BOKSLDIRGUI_SETTINGS_PATH locations are deliberately untouched.
    Delete "$APPDATA\BokslDirGUI\settings.json"
    Delete "$APPDATA\BokslDirGUI\settings.json.tmp"
    RMDir "$APPDATA\BokslDirGUI"
  ${EndIf}
!macroend
