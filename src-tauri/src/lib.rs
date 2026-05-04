use std::path::Path;
use std::process::Command;

use serde::Serialize;

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

// —— Magit-style status buffer (read-only) ——

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MagitNameStatusEntry {
    pub status: String,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MagitCommitLine {
    pub hash: String,
    pub subject: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MagitSnapshot {
    pub ok: bool,
    pub error: Option<String>,
    pub branch_label: Option<String>,
    pub head_line: Option<String>,
    pub recent_commits: Vec<MagitCommitLine>,
    pub staged: Vec<MagitNameStatusEntry>,
    pub unstaged: Vec<MagitNameStatusEntry>,
    pub untracked: Vec<String>,
}

fn run_git_stdout(repo_root: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .current_dir(repo_root)
        .args(args)
        .output()
        .map_err(|e| format!("Could not run git: {e}. Is git installed and on PATH?"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if err.is_empty() {
            Err("git command failed.".into())
        } else {
            Err(err)
        }
    }
}

fn parse_name_status_block(text: &str) -> Vec<MagitNameStatusEntry> {
    let mut v = Vec::new();
    for line in text.lines() {
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 2 {
            continue;
        }
        let status = parts[0].to_string();
        let path =
            if parts.len() >= 3 && (status.starts_with('R') || status.starts_with('C')) {
                format!("{} → {}", parts[1], parts[2])
            } else {
                parts[1].to_string()
            };
        v.push(MagitNameStatusEntry { status, path });
    }
    v
}

fn parse_recent_log(text: &str) -> Vec<MagitCommitLine> {
    text.lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| line.find('\t').map(|i| MagitCommitLine {
            hash: line[..i].trim().to_string(),
            subject: line[i + 1..].trim_end().to_string(),
        }))
        .collect()
}

fn snapshot_error(msg: impl Into<String>) -> MagitSnapshot {
    MagitSnapshot {
        ok: false,
        error: Some(msg.into()),
        branch_label: None,
        head_line: None,
        recent_commits: Vec::new(),
        staged: Vec::new(),
        unstaged: Vec::new(),
        untracked: Vec::new(),
    }
}

/// Working-tree snapshot for Magit-style UI (`git diff`, `branch`, recent log).
#[tauri::command]
fn git_magit_snapshot(root_path: String) -> MagitSnapshot {
    let trimmed = root_path.trim().to_owned();
    if trimmed.is_empty() {
        return snapshot_error("No workspace folder.");
    }
    let path = Path::new(&trimmed);
    if !path.is_dir() {
        return snapshot_error("Workspace is not a directory on disk.");
    }
    let root = trimmed.as_str();

    match run_git_stdout(root, &["rev-parse", "--is-inside-work-tree"]) {
        Ok(s) if s.trim() == "true" => {}
        Ok(_) => return snapshot_error("Not a git working tree."),
        Err(e) => return snapshot_error(e),
    }

    let branch_label =
        match run_git_stdout(root, &["branch", "--show-current"]) {
            Ok(s) => {
                let t = s.trim().to_string();
                if t.is_empty() {
                    run_git_stdout(root, &["describe", "--tags", "--always"])
                        .ok()
                        .map(|d| d.trim().to_string())
                } else {
                    Some(t)
                }
            }
            Err(_) => run_git_stdout(root, &["describe", "--tags", "--always"]).ok(),
        };

    let head_line = run_git_stdout(root, &["log", "-1", "--pretty=format:%h %s"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let staged = run_git_stdout(root, &["diff", "--cached", "--name-status"])
        .map(|t| parse_name_status_block(&t))
        .unwrap_or_default();

    let unstaged = run_git_stdout(root, &["diff", "--name-status"])
        .map(|t| parse_name_status_block(&t))
        .unwrap_or_default();

    let untracked_raw =
        run_git_stdout(root, &["ls-files", "-o", "--exclude-standard"]).unwrap_or_default();
    let untracked = untracked_raw
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect::<Vec<_>>();

    let log_text = run_git_stdout(
        root,
        &[
            "-c",
            "core.quotepath=false",
            "log",
            "-20",
            "--pretty=format:%h\t%s%n",
        ],
    )
    .unwrap_or_default();
    let recent_commits = parse_recent_log(&log_text);

    MagitSnapshot {
        ok: true,
        error: None,
        branch_label,
        head_line,
        recent_commits,
        staged,
        unstaged,
        untracked,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            git_clone_repo,
            git_magit_snapshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
