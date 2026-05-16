mod terminal;

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

fn validate_workspace_dir(root_path: &str) -> Result<&str, String> {
    let trimmed = root_path.trim();
    if trimmed.is_empty() {
        return Err("No workspace folder.".into());
    }
    let path = Path::new(trimmed);
    if !path.is_dir() {
        return Err("Workspace is not a directory on disk.".into());
    }
    Ok(trimmed)
}

fn ensure_git_worktree(root: &str) -> Result<(), String> {
    match run_git_stdout(root, &["rev-parse", "--is-inside-work-tree"]) {
        Ok(s) if s.trim() == "true" => Ok(()),
        Ok(_) => Err("Not a git working tree.".into()),
        Err(e) => Err(e),
    }
}

fn git_rev_verify(repo_root: &str, git_ref: &str) -> Result<(), String> {
    let r = git_ref.trim();
    if r.is_empty() {
        return Err("Git ref is empty.".into());
    }
    if r.starts_with('-') || r.contains([' ', '\t', '\n', '\r']) {
        return Err("Invalid git ref.".into());
    }
    run_git_stdout(repo_root, &["rev-parse", "--verify", &format!("{r}^{{}}")]).map(|_| ())
}

fn validate_repo_rel_path(path: &str) -> Result<(), String> {
    let p = path.trim();
    if p.is_empty() {
        return Err("Path is empty.".into());
    }
    if p.contains("..") || p.starts_with('/') || p.starts_with('\\') {
        return Err("Invalid path.".into());
    }
    Ok(())
}

// —— Default branch + agent worktrees ——

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultBranchInfo {
    /// e.g. `main`
    pub short_name: String,
    /// Suitable for `git worktree add … <start_point>` and default diff base.
    pub start_point: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeCreateResult {
    pub path: String,
    pub branch: String,
}

fn slugify_branch_segment(s: &str) -> String {
    let lower: String = s
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let mut collapsed = String::new();
    let mut prev_dash = true;
    for c in lower.chars() {
        if c == '-' {
            if !prev_dash {
                collapsed.push(c);
            }
            prev_dash = true;
        } else {
            prev_dash = false;
            collapsed.push(c);
        }
    }
    collapsed
        .trim_matches('-')
        .chars()
        .take(40)
        .collect()
}

/// Resolve `main` / `master` (or `origin/HEAD`) for new tabs and worktrees.
#[tauri::command]
fn git_resolve_default_branch(root_path: String) -> Result<DefaultBranchInfo, String> {
    let root = validate_workspace_dir(&root_path)?;
    ensure_git_worktree(root)?;

    if let Ok(sym) = run_git_stdout(
        root,
        &["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"],
    ) {
        let short = sym.trim();
        if let Some(bn) = short.strip_prefix("origin/") {
            if !bn.is_empty() {
                let origin_ref = format!("origin/{bn}");
                if git_rev_verify(root, &origin_ref).is_ok() {
                    return Ok(DefaultBranchInfo {
                        short_name: bn.to_string(),
                        start_point: origin_ref,
                    });
                }
            }
        }
    }

    for name in ["main", "master"] {
        let oref = format!("origin/{name}");
        if git_rev_verify(root, &oref).is_ok() {
            return Ok(DefaultBranchInfo {
                short_name: name.to_string(),
                start_point: oref,
            });
        }
        if git_rev_verify(root, name).is_ok() {
            return Ok(DefaultBranchInfo {
                short_name: name.to_string(),
                start_point: name.to_string(),
            });
        }
    }

    Ok(DefaultBranchInfo {
        short_name: "HEAD".to_string(),
        start_point: "HEAD".to_string(),
    })
}

/// Create a new branch + linked worktree from `base_start_point` under `.codar-worktrees/<repo>/…`.
#[tauri::command]
fn git_create_agent_worktree(
    root_path: String,
    purpose: String,
    base_start_point: String,
) -> Result<WorktreeCreateResult, String> {
    let root = validate_workspace_dir(&root_path)?;
    ensure_git_worktree(root)?;
    let base = base_start_point.trim();
    if base.is_empty() {
        return Err("Base ref is empty.".into());
    }
    git_rev_verify(root, base)?;

    let p = purpose.trim();
    if p.is_empty() {
        return Err("Describe what you are working on.".into());
    }
    let slug = slugify_branch_segment(p);
    if slug.is_empty() {
        return Err("Use letters or numbers in the description.".into());
    }

    let repo_path = Path::new(root).canonicalize().map_err(|e| e.to_string())?;
    let repo_name = repo_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("repo");

    let parent = repo_path
        .parent()
        .ok_or_else(|| "Repository has no parent directory.".to_string())?;
    let worktrees_root = parent.join(".codar-worktrees").join(repo_name);
    std::fs::create_dir_all(&worktrees_root).map_err(|e| e.to_string())?;

    let id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let dir_name = format!("{slug}-{id}");
    let wt_path = worktrees_root.join(dir_name);

    let branch_slug = slugify_branch_segment(&format!("{slug}-{}", id % 100_000));
    let branch_name = format!("codar/{branch_slug}");

    let output = Command::new("git")
        .current_dir(root)
        .arg("worktree")
        .arg("add")
        .arg("-b")
        .arg(&branch_name)
        .arg(&wt_path)
        .arg(base)
        .output()
        .map_err(|e| format!("git worktree: {e}"))?;

    if !output.status.success() {
        let _ = std::fs::remove_dir_all(&wt_path);
        return Err(format!(
            "git worktree add failed:\n{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    wt_path
        .to_str()
        .map(|path| WorktreeCreateResult {
            path: path.to_owned(),
            branch: branch_name,
        })
        .ok_or_else(|| "Worktree path was not valid Unicode.".into())
}

// —— Branch comparison (browse vs diff) ——

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchList {
    pub ok: bool,
    pub error: Option<String>,
    pub current: Option<String>,
    pub branches: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchDiffFileEntry {
    /// Path key for the file tree (`new` side for renames/copies).
    pub path: String,
    /// one of: added | modified | deleted | renamed
    pub status: String,
    pub old_path: Option<String>,
}

#[tauri::command]
fn git_branch_list(root_path: String) -> GitBranchList {
    let root = match validate_workspace_dir(&root_path) {
        Ok(r) => r,
        Err(e) => {
            return GitBranchList {
                ok: false,
                error: Some(e),
                current: None,
                branches: Vec::new(),
            }
        }
    };
    if let Err(e) = ensure_git_worktree(root) {
        return GitBranchList {
            ok: false,
            error: Some(e),
            current: None,
            branches: Vec::new(),
        };
    }

    let current = run_git_stdout(root, &["branch", "--show-current"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let heads_raw =
        match run_git_stdout(root, &["for-each-ref", "--format=%(refname:short)", "refs/heads/"]) {
            Ok(s) => s,
            Err(e) => {
                return GitBranchList {
                    ok: false,
                    error: Some(e),
                    current,
                    branches: Vec::new(),
                }
            }
        };

    let mut names: Vec<String> = heads_raw
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();

    if let Ok(remotes_raw) = run_git_stdout(
        root,
        &["for-each-ref", "--format=%(refname:short)", "refs/remotes/"],
    ) {
        for line in remotes_raw.lines() {
            let t = line.trim();
            if !t.is_empty() {
                names.push(t.to_string());
            }
        }
    }

    if !names.iter().any(|b| b == "HEAD") {
        names.push("HEAD".to_string());
    }

    names.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    names.dedup();

    GitBranchList {
        ok: true,
        error: None,
        current,
        branches: names,
    }
}

fn map_name_status_to_entry(parts: &[&str]) -> Option<BranchDiffFileEntry> {
    if parts.len() < 2 {
        return None;
    }
    let status_raw = parts[0].trim();
    let head = status_raw.chars().next()?;

    let (path, old_path, status) = if (head == 'R' || head == 'C') && parts.len() >= 3 {
        let old_p = parts[1].to_string();
        let new_p = parts[2].to_string();
        (
            new_p,
            Some(old_p),
            "renamed".to_string(),
        )
    } else if head == 'A' {
        (parts[1].to_string(), None, "added".to_string())
    } else if head == 'D' {
        (parts[1].to_string(), None, "deleted".to_string())
    } else if head == 'M' || head == 'T' || head == 'U' {
        (parts[1].to_string(), None, "modified".to_string())
    } else {
        (parts[1].to_string(), None, "modified".to_string())
    };

    Some(BranchDiffFileEntry {
        path,
        status,
        old_path,
    })
}

/// Files changed between `base_ref` and `head_ref` (two-dot tree diff).
#[tauri::command]
fn git_branch_diff_files(
    root_path: String,
    base_ref: String,
    head_ref: String,
) -> Result<Vec<BranchDiffFileEntry>, String> {
    let root = validate_workspace_dir(&root_path)?;
    ensure_git_worktree(root)?;
    let b = base_ref.trim();
    let h = head_ref.trim();
    git_rev_verify(root, b)?;
    git_rev_verify(root, h)?;

    let text = run_git_stdout(
        root,
        &[
            "-c",
            "core.quotepath=false",
            "diff",
            "--name-status",
            "-M",
            "-C",
            b,
            h,
        ],
    )?;

    let mut out = Vec::new();
    for line in text.lines() {
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split('\t').collect();
        if let Some(entry) = map_name_status_to_entry(&parts) {
            out.push(entry);
        }
    }
    Ok(out)
}

/// Unified diff for a single path between two refs (path is repo-relative, POSIX).
#[tauri::command]
fn git_branch_diff_patch(
    root_path: String,
    base_ref: String,
    head_ref: String,
    path: String,
) -> Result<String, String> {
    let root = validate_workspace_dir(&root_path)?;
    ensure_git_worktree(root)?;
    validate_repo_rel_path(&path)?;
    let b = base_ref.trim();
    let h = head_ref.trim();
    git_rev_verify(root, b)?;
    git_rev_verify(root, h)?;

    run_git_stdout(
        root,
        &[
            "-c",
            "core.quotepath=false",
            "diff",
            "--no-ext-diff",
            "-U3",
            b,
            h,
            "--",
            path.trim(),
        ],
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(terminal::PtySession::default())
        .invoke_handler(tauri::generate_handler![
            git_clone_repo,
            git_resolve_default_branch,
            git_create_agent_worktree,
            git_branch_list,
            git_branch_diff_files,
            git_branch_diff_patch,
            terminal::terminal_spawn,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
