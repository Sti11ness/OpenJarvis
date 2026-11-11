//! Open the dedicated browser profile used by the personal Playwright MCP.

#[tauri::command]
pub fn open_account_browser() -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        Err("The personal Edge profile is configured for Windows.".into())
    }
    #[cfg(target_os = "windows")]
    {
        use std::{env, path::PathBuf, process::Command};

        let profile = env::var_os("OPENJARVIS_ACCOUNT_BROWSER_PROFILE")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .ok_or_else(|| "Запустите персональную сборку через её ярлык.".to_string())?;
        let edge = ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"]
            .into_iter()
            .filter_map(env::var_os)
            .map(PathBuf::from)
            .map(|dir| {
                dir.join("Microsoft")
                    .join("Edge")
                    .join("Application")
                    .join("msedge.exe")
            })
            .find(|file| file.is_file())
            .ok_or_else(|| "Не найден Microsoft Edge.".to_string())?;
        let mut profile_arg = std::ffi::OsString::from("--user-data-dir=");
        profile_arg.push(profile.as_os_str());
        Command::new(edge)
            .arg(profile_arg)
            .args(["--no-first-run", "about:blank"])
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("Не удалось открыть Edge: {error}"))
    }
}
