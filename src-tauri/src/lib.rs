use std::process::Command;

fn validated_github_https_url(url: &str) -> Result<String, String> {
    let u = url.trim();
    let without_suffix = u
        .strip_suffix('/')
        .unwrap_or(u)
        .strip_suffix(".git")
        .unwrap_or(u);
    let without_suffix = without_suffix.strip_suffix('/').unwrap_or(without_suffix);
    const PREFIX: &str = "https://github.com/";
    let Some(rest) = without_suffix.strip_prefix(PREFIX) else {
        return Err("Only HTTPS GitHub URLs are supported.".into());
    };
    let parts: Vec<&str> = rest.split('/').filter(|s| !s.is_empty()).collect();
    if parts.len() != 2 {
        return Err("Expected https://github.com/owner/repo".into());
    }
    for segment in &parts {
        if segment.is_empty() || segment.contains("..") {
            return Err("Invalid owner or repo name.".into());
        }
    }
    Ok(without_suffix.to_string())
}

/// Shallow clone `https://github.com/owner/repo` into a temporary directory.
/// Returns absolute path to the clone root or an error message.
#[tauri::command]
fn git_clone_repo(url: String) -> Result<String, String> {
    let clone_url = validated_github_https_url(&url)?;
    let parent = std::env::temp_dir().join("codar-github-clones");
    std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    let id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let dest = parent.join(format!("repo-{id}"));
    let output = Command::new("git")
        .args(["clone", "--depth", "1"])
        .arg(&clone_url)
        .arg(&dest)
        .output()
        .map_err(|e| format!("Failed to run git: {e}. Is git installed and on PATH?"))?;
    if !output.status.success() {
        let _ = std::fs::remove_dir_all(&dest);
        return Err(format!(
            "git clone failed:\n{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    dest.to_str()
        .map(|s| s.to_owned())
        .ok_or_else(|| "Clone path contained invalid Unicode.".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![git_clone_repo])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
