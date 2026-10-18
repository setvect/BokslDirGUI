use base64::Engine;
use std::path::Path;
use std::process::Command;

fn powershell_command(executable: &Path, directory: &Path) -> Command {
    let script = format!(
        "Set-Location -LiteralPath '{}'",
        directory.to_string_lossy().replace('\'', "''")
    );
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    let mut command = Command::new(executable);
    command.args([
        "-NoLogo",
        "-NoProfile",
        "-NoExit",
        "-EncodedCommand",
        &encoded,
    ]);
    command
}

#[cfg(windows)]
pub(crate) fn open(directory: &Path) -> crate::contracts::CommandResult<()> {
    use std::os::windows::process::CommandExt;
    use windows::Win32::System::SystemInformation::GetSystemDirectoryW;
    let mut buffer = vec![0u16; 32768];
    let length = unsafe { GetSystemDirectoryW(Some(&mut buffer)) } as usize;
    if length == 0 || length >= buffer.len() {
        return Err(crate::filesystem::map_io_error(
            std::io::Error::last_os_error(),
            Some(directory),
        ));
    }
    let system = std::path::PathBuf::from(String::from_utf16_lossy(&buffer[..length]));
    let powershell = system.join("WindowsPowerShell/v1.0/powershell.exe");
    // Fixed system executable; neither PATH nor the selected folder can supply a shell.
    if powershell.is_file() {
        powershell_command(&powershell, directory)
            .creation_flags(0x00000010) // CREATE_NEW_CONSOLE
            .spawn()
            .map_err(|e| crate::filesystem::map_io_error(e, Some(directory)))?;
        return Ok(());
    }
    // Optional Windows Terminal alias. Arguments remain separate; no cmd /c fallback.
    if let Some(alias) = dirs::data_local_dir().map(|p| p.join("Microsoft/WindowsApps/wt.exe")) {
        if alias.is_file() {
            Command::new(alias)
                .arg("-d")
                .arg(directory)
                .spawn()
                .map_err(|e| crate::filesystem::map_io_error(e, Some(directory)))?;
            return Ok(());
        }
    }
    Err(crate::contracts::AppError::new(
        "external_unavailable",
        "errors.externalCommandFailed",
        Some(directory),
        true,
    ))
}

#[cfg(test)]
mod tests {
    use super::powershell_command;
    use base64::Engine;
    use std::path::Path;

    #[test]
    fn terminal_encodes_literal_directory_including_quotes_and_shell_characters() {
        for path in [
            r"C:\한글 a\it's $HOME & $(exit) [1]",
            r"\\server\share\space name",
            r"\\?\C:\long path",
        ] {
            let cmd = powershell_command(Path::new("powershell.exe"), Path::new(path));
            let args: Vec<_> = cmd.get_args().collect();
            assert_eq!(
                &args[..4],
                &["-NoLogo", "-NoProfile", "-NoExit", "-EncodedCommand"]
            );
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(args[4].to_str().unwrap())
                .unwrap();
            let text = String::from_utf16(
                &bytes
                    .chunks_exact(2)
                    .map(|b| u16::from_le_bytes([b[0], b[1]]))
                    .collect::<Vec<_>>(),
            )
            .unwrap();
            assert_eq!(
                text,
                format!("Set-Location -LiteralPath '{}'", path.replace('\'', "''"))
            );
        }
    }
}
