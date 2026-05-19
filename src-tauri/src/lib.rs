mod terminal;

use std::collections::HashMap;
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
    let parent = std::env::temp_dir().join("compound-github-clones");
    std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    let id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let dest = parent.join(format!("repo-{id}"));
    let output = git_command_spawn(None)
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

fn git_command_spawn(repo_root: Option<&Path>) -> Command {
    let mut cmd = Command::new("git");
    if let Some(root) = repo_root {
        cmd.current_dir(root);
    }
    // Clear repo-scoping env inherited from shells / direnv hooks so `current_dir` always wins,
    // including for linked git worktrees (`.git` is a pointer file).
    cmd.env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_PAGER", "cat")
        .arg("--no-optional-locks")
        .arg("-c")
        .arg("core.pager=cat")
        .arg("-c")
        .arg("safe.directory=*");
    cmd
}

fn git_error_message(operation: &str, output: &std::process::Output) -> String {
    let code = output.status.code();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    let mut msg = format!("Git {operation}");
    match code {
        Some(c) => msg.push_str(&format!(" failed (exit {c})")),
        None => msg.push_str(" failed"),
    }
    if !stderr.is_empty() {
        msg.push_str(":\n");
        msg.push_str(&stderr);
    } else if !stdout.is_empty() {
        msg.push_str(":\n");
        msg.push_str(&stdout);
    } else {
        msg.push('.');
        msg.push_str(" Git produced no stderr or stdout.");
    }
    msg
}

/// `git diff` exits with status **1** when there are differences and **0** when trees match.
/// Higher exit codes or signal exits indicate failure (see `git help diff`, EXIT STATUS).
fn git_diff_ok(status: std::process::ExitStatus) -> bool {
    status.success() || status.code() == Some(1)
}

fn run_git_stdout(repo_root: &str, args: &[&str]) -> Result<String, String> {
    let output = git_command_spawn(Some(Path::new(repo_root)))
        .args(args)
        .output()
        .map_err(|e| format!("Could not run git: {e}. Is git installed and on PATH?"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(git_error_message("command", &output))
    }
}

fn run_git_diff_stdout(repo_root: &str, args: &[&str]) -> Result<String, String> {
    let output = git_command_spawn(Some(Path::new(repo_root)))
        .args(args)
        .output()
        .map_err(|e| format!("Could not run git: {e}. Is git installed and on PATH?"))?;
    if git_diff_ok(output.status) {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(git_error_message("diff", &output))
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
    /// Shell command injected into the in-app Agent PTY (`git worktree add …`; POSIX uses `bash`/`sh` syntax, Windows targets PowerShell).
    pub bootstrap_shell_command: String,
}

fn shell_single_quote_escape(s: &str) -> String {
    // Safe for POSIX-ish shells: wrap in single quotes; `'` becomes `'"'"'`.
    format!("'{}'", s.replace('\'', "'\"'\"'"))
}

#[cfg(windows)]
fn pwsh_single_quoted_literal(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
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

/// Plan a linked worktree under `.compound-worktrees/<repo>/…` (creates parents only).
/// Actual `git worktree add` runs in the Agent PTY so Git LFS and shell env match the user's setup.
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
    let worktrees_root = parent.join(".compound-worktrees").join(repo_name);
    std::fs::create_dir_all(&worktrees_root).map_err(|e| e.to_string())?;

    let id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let dir_name = format!("{slug}-{id}");
    let branch_slug = slugify_branch_segment(&format!("{slug}-{}", id % 100_000));
    let branch_name = format!("compound/{branch_slug}");

    // `git worktree add` runs in the in-app Agent terminal instead of here so Git LFS
    // and direnv-augmented PATH match the user's interactive shell.
    let worktrees_canon = worktrees_root.canonicalize().map_err(|e| e.to_string())?;
    let wt_abs_path = worktrees_canon.join(&dir_name);
    let wt_abs_str = wt_abs_path
        .to_str()
        .ok_or_else(|| "Canonical worktree path was not valid Unicode.".to_string())?;

    let bootstrap_shell_command = {
        #[cfg(not(windows))]
        {
            format!(
                "git worktree add -b {} {} {} && cd {}",
                shell_single_quote_escape(&branch_name),
                shell_single_quote_escape(wt_abs_str),
                shell_single_quote_escape(base),
                shell_single_quote_escape(wt_abs_str),
            )
        }
        #[cfg(windows)]
        {
            format!(
                "git worktree add -b {} {} {}; Set-Location -LiteralPath {}",
                pwsh_single_quoted_literal(&branch_name),
                pwsh_single_quoted_literal(wt_abs_str),
                pwsh_single_quoted_literal(base),
                pwsh_single_quoted_literal(wt_abs_str),
            )
        }
    };

    Ok(WorktreeCreateResult {
        path: wt_abs_str.to_owned(),
        branch: branch_name,
        bootstrap_shell_command,
    })
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

fn parse_diff_name_status_into_map(
    map: &mut HashMap<String, BranchDiffFileEntry>,
    text: &str,
) {
    for line in text.lines() {
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split('\t').collect();
        if let Some(entry) = map_name_status_to_entry(&parts) {
            map.insert(entry.path.clone(), entry);
        }
    }
}

/// Staged + unstaged changes vs `HEAD`, plus untracked files (repo-relative paths).
#[tauri::command]
fn git_worktree_diff_files(root_path: String) -> Result<Vec<BranchDiffFileEntry>, String> {
    let root = validate_workspace_dir(&root_path)?;
    ensure_git_worktree(root)?;

    let mut map: HashMap<String, BranchDiffFileEntry> = HashMap::new();
    let has_head = run_git_stdout(root, &["rev-parse", "--verify", "HEAD"]).is_ok();

    if has_head {
        let text = run_git_diff_stdout(
            root,
            &[
                "-c",
                "core.quotepath=false",
                "diff",
                "--name-status",
                "-M",
                "-C",
                "HEAD",
            ],
        )?;
        parse_diff_name_status_into_map(&mut map, &text);
    } else {
        let cached = run_git_diff_stdout(
            root,
            &[
                "-c",
                "core.quotepath=false",
                "diff",
                "--name-status",
                "--cached",
            ],
        )?;
        parse_diff_name_status_into_map(&mut map, &cached);
        let unstaged = run_git_diff_stdout(
            root,
            &["-c", "core.quotepath=false", "diff", "--name-status"],
        )?;
        parse_diff_name_status_into_map(&mut map, &unstaged);
    }

    let untracked = run_git_stdout(
        root,
        &[
            "-c",
            "core.quotepath=false",
            "ls-files",
            "--others",
            "--exclude-standard",
        ],
    )?;
    for line in untracked.lines() {
        if line.is_empty() {
            continue;
        }
        let p = line.to_string();
        if map.contains_key(&p) {
            continue;
        }
        map.insert(
            p.clone(),
            BranchDiffFileEntry {
                path: p,
                status: "added".to_string(),
                old_path: None,
            },
        );
    }

    let mut out: Vec<BranchDiffFileEntry> = map.into_values().collect();
    out.sort_by(|a, b| {
        a.path
            .cmp(&b.path)
            .then_with(|| a.status.cmp(&b.status))
    });
    Ok(out)
}

/// Unified diff for one locally changed path (`HEAD` vs worktree + index; untracked vs `/dev/null`).
#[tauri::command]
fn git_worktree_diff_patch(root_path: String, path: String) -> Result<String, String> {
    let root = validate_workspace_dir(&root_path)?;
    ensure_git_worktree(root)?;
    validate_repo_rel_path(&path)?;
    let p = path.trim();
    let has_head = run_git_stdout(root, &["rev-parse", "--verify", "HEAD"]).is_ok();

    if has_head {
        let patch = run_git_diff_stdout(
            root,
            &[
                "-c",
                "core.quotepath=false",
                "diff",
                "--no-ext-diff",
                "-U3",
                "HEAD",
                "--",
                p,
            ],
        );
        match patch {
            Ok(text) if !text.trim().is_empty() => return Ok(text),
            Ok(_) => {}
            Err(e) => return Err(e),
        }
    } else {
        let mut combined = String::new();
        if let Ok(a) = run_git_diff_stdout(
            root,
            &[
                "-c",
                "core.quotepath=false",
                "diff",
                "--no-ext-diff",
                "-U3",
                "--cached",
                "--",
                p,
            ],
        ) {
            combined.push_str(&a);
        }
        if let Ok(b) = run_git_diff_stdout(
            root,
            &[
                "-c",
                "core.quotepath=false",
                "diff",
                "--no-ext-diff",
                "-U3",
                "--",
                p,
            ],
        ) {
            combined.push_str(&b);
        }
        if !combined.trim().is_empty() {
            return Ok(combined);
        }
    }

    let abs = Path::new(root).join(p);
    if !abs.is_file() {
        return Err("No local patch available for this path.".into());
    }

    run_git_diff_stdout(
        root,
        &[
            "-c",
            "core.quotepath=false",
            "diff",
            "--no-ext-diff",
            "-U3",
            "--no-index",
            "--text",
            "--",
            "/dev/null",
            p,
        ],
    )
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitListedWorktree {
    pub path: String,
    pub branch_short: Option<String>,
    pub detached: bool,
    pub is_current_workspace: bool,
}

fn parse_git_worktree_porcelain(output: &str) -> Vec<(String, Option<String>, bool)> {
    #[derive(Default)]
    struct Rec {
        path: Option<String>,
        branch: Option<String>,
        detached: bool,
    }
    let mut records: Vec<Rec> = Vec::new();

    let mut cur = Rec::default();
    for raw in output.lines() {
        let line = raw.trim_end();
        if line.is_empty() {
            continue;
        }
        if let Some(p) = line.strip_prefix("worktree ") {
            if cur.path.is_some() {
                records.push(cur);
                cur = Rec::default();
            }
            cur.path = Some(p.trim().to_string());
            continue;
        }
        if cur.path.is_none() {
            continue;
        }
        if let Some(b) = line.strip_prefix("branch ") {
            cur.branch = Some(b.trim().to_string());
            continue;
        }
        if line == "detached" {
            cur.detached = true;
        }
    }
    if cur.path.is_some() {
        records.push(cur);
    }

    records
        .into_iter()
        .filter_map(|r| {
            let path = r.path?;
            let branch_short = if r.detached {
                None
            } else {
                r.branch.map(|b| {
                    b.strip_prefix("refs/heads/")
                        .unwrap_or(&b)
                        .to_string()
                })
                .filter(|s| !s.is_empty())
            };
            let detached = r.detached || branch_short.is_none();
            Some((path, branch_short, detached))
        })
        .collect()
}

// —— Working tree status (stage / commit / push) ——

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusFileEntry {
    pub path: String,
    /// added | modified | deleted | renamed
    pub status: String,
    pub old_path: Option<String>,
    /// staged | unstaged | untracked
    pub area: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeStatus {
    pub branch: Option<String>,
    pub files: Vec<GitStatusFileEntry>,
}

fn parse_name_status_lines(text: &str, area: &str) -> Vec<GitStatusFileEntry> {
    let mut out = Vec::new();
    for line in text.lines() {
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split('\t').collect();
        if let Some(entry) = map_name_status_to_entry(&parts) {
            out.push(GitStatusFileEntry {
                path: entry.path,
                status: entry.status,
                old_path: entry.old_path,
                area: area.to_string(),
            });
        }
    }
    out
}

/// Staged, unstaged, and untracked paths for the Git tab.
#[tauri::command]
fn git_worktree_status(root_path: String) -> Result<GitWorktreeStatus, String> {
    let root = validate_workspace_dir(&root_path)?;
    ensure_git_worktree(root)?;

    let branch = run_git_stdout(root, &["branch", "--show-current"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let mut files: Vec<GitStatusFileEntry> = Vec::new();

    let staged = run_git_diff_stdout(
        root,
        &[
            "-c",
            "core.quotepath=false",
            "diff",
            "--name-status",
            "-M",
            "-C",
            "--cached",
        ],
    )
    .unwrap_or_default();
    files.extend(parse_name_status_lines(&staged, "staged"));

    let unstaged = run_git_diff_stdout(
        root,
        &[
            "-c",
            "core.quotepath=false",
            "diff",
            "--name-status",
            "-M",
            "-C",
        ],
    )
    .unwrap_or_default();
    files.extend(parse_name_status_lines(&unstaged, "unstaged"));

    let untracked = run_git_stdout(
        root,
        &[
            "-c",
            "core.quotepath=false",
            "ls-files",
            "--others",
            "--exclude-standard",
        ],
    )
    .unwrap_or_default();
    for line in untracked.lines() {
        if line.is_empty() {
            continue;
        }
        files.push(GitStatusFileEntry {
            path: line.to_string(),
            status: "added".to_string(),
            old_path: None,
            area: "untracked".to_string(),
        });
    }

    files.sort_by(|a, b| {
        a.area
            .cmp(&b.area)
            .then_with(|| a.path.cmp(&b.path))
    });

    Ok(GitWorktreeStatus { branch, files })
}

fn validate_git_change_area(area: &str) -> Result<&str, String> {
    match area.trim() {
        "staged" | "unstaged" | "untracked" => Ok(area.trim()),
        _ => Err("Invalid change area.".into()),
    }
}

/// Unified diff for one path in staged, unstaged, or untracked area.
#[tauri::command]
fn git_status_diff_patch(
    root_path: String,
    path: String,
    area: String,
) -> Result<String, String> {
    let root = validate_workspace_dir(&root_path)?;
    ensure_git_worktree(root)?;
    validate_repo_rel_path(&path)?;
    let p = path.trim();
    let area = validate_git_change_area(&area)?;

    match area {
        "staged" => run_git_diff_stdout(
            root,
            &[
                "-c",
                "core.quotepath=false",
                "diff",
                "--no-ext-diff",
                "-U3",
                "--cached",
                "--",
                p,
            ],
        ),
        "unstaged" => run_git_diff_stdout(
            root,
            &[
                "-c",
                "core.quotepath=false",
                "diff",
                "--no-ext-diff",
                "-U3",
                "--",
                p,
            ],
        ),
        "untracked" => {
            let abs = Path::new(root).join(p);
            if !abs.is_file() {
                return Err("Untracked path is not a regular file.".into());
            }
            run_git_diff_stdout(
                root,
                &[
                    "-c",
                    "core.quotepath=false",
                    "diff",
                    "--no-ext-diff",
                    "-U3",
                    "--no-index",
                    "--text",
                    "--",
                    "/dev/null",
                    p,
                ],
            )
        }
        _ => unreachable!(),
    }
}

fn validate_repo_rel_paths(paths: &[String]) -> Result<Vec<String>, String> {
    let mut out = Vec::with_capacity(paths.len());
    for path in paths {
        validate_repo_rel_path(path)?;
        out.push(path.trim().to_string());
    }
    Ok(out)
}

/// Stage paths (`git add`). Untracked paths are added; tracked paths are staged.
#[tauri::command]
fn git_stage_paths(root_path: String, paths: Vec<String>) -> Result<(), String> {
    let root = validate_workspace_dir(&root_path)?;
    ensure_git_worktree(root)?;
    let paths = validate_repo_rel_paths(&paths)?;
    if paths.is_empty() {
        return Err("No paths to stage.".into());
    }
    let mut cmd = git_command_spawn(Some(Path::new(root)));
    cmd.arg("add").arg("--");
    for p in &paths {
        cmd.arg(p);
    }
    let output = cmd
        .output()
        .map_err(|e| format!("Could not run git: {e}. Is git installed and on PATH?"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(git_error_message("add", &output))
    }
}

/// Unstage paths (`git restore --staged`).
#[tauri::command]
fn git_unstage_paths(root_path: String, paths: Vec<String>) -> Result<(), String> {
    let root = validate_workspace_dir(&root_path)?;
    ensure_git_worktree(root)?;
    let paths = validate_repo_rel_paths(&paths)?;
    if paths.is_empty() {
        return Err("No paths to unstage.".into());
    }
    let mut cmd = git_command_spawn(Some(Path::new(root)));
    cmd.arg("restore").arg("--staged").arg("--");
    for p in &paths {
        cmd.arg(p);
    }
    let output = cmd
        .output()
        .map_err(|e| format!("Could not run git: {e}. Is git installed and on PATH?"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(git_error_message("restore --staged", &output))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitResult {
    pub revision: String,
    pub summary: String,
}

/// Create a commit with the given message.
#[tauri::command]
fn git_commit(root_path: String, message: String) -> Result<GitCommitResult, String> {
    let root = validate_workspace_dir(&root_path)?;
    ensure_git_worktree(root)?;
    let msg = message.trim();
    if msg.is_empty() {
        return Err("Commit message is required.".into());
    }

    let output = git_command_spawn(Some(Path::new(root)))
        .args(["commit", "-m", msg])
        .output()
        .map_err(|e| format!("Could not run git: {e}. Is git installed and on PATH?"))?;
    if !output.status.success() {
        return Err(git_error_message("commit", &output));
    }

    let revision = run_git_stdout(root, &["rev-parse", "--short", "HEAD"]).unwrap_or_default();
    let summary = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(GitCommitResult {
        revision: revision.trim().to_string(),
        summary,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPushResult {
    pub summary: String,
}

/// Push the current branch to its upstream (or set upstream on first push).
#[tauri::command]
fn git_push(root_path: String) -> Result<GitPushResult, String> {
    let root = validate_workspace_dir(&root_path)?;
    ensure_git_worktree(root)?;

    let branch = run_git_stdout(root, &["branch", "--show-current"])?
        .trim()
        .to_string();
    if branch.is_empty() {
        return Err("Cannot push from detached HEAD.".into());
    }

    let upstream = run_git_stdout(
        root,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{u}",
        ],
    );

    let output = if upstream.is_ok() {
        git_command_spawn(Some(Path::new(root)))
            .arg("push")
            .output()
    } else {
        git_command_spawn(Some(Path::new(root)))
            .args(["push", "-u", "origin", &branch])
            .output()
    }
    .map_err(|e| format!("Could not run git: {e}. Is git installed and on PATH?"))?;

    if !output.status.success() {
        return Err(git_error_message("push", &output));
    }

    let summary = {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "Push completed.".to_string()
        }
    };

    Ok(GitPushResult { summary })
}

/// Linked worktrees (`git worktree list --porcelain`).
#[tauri::command]
fn git_list_worktrees(root_path: String) -> Result<Vec<GitListedWorktree>, String> {
    let root = validate_workspace_dir(&root_path)?;
    ensure_git_worktree(root)?;

    let porcelain = run_git_stdout(root, &["worktree", "list", "--porcelain"])?;
    let root_canon = Path::new(root).canonicalize().ok();

    Ok(parse_git_worktree_porcelain(&porcelain)
        .into_iter()
        .map(|(path, branch_short, detached)| {
            let wt_canon = Path::new(&path).canonicalize().ok();
            let is_current_workspace = match (&root_canon, &wt_canon) {
                (Some(a), Some(b)) => a == b,
                _ => path == root,
            };
            GitListedWorktree {
                path,
                branch_short,
                detached,
                is_current_workspace,
            }
        })
        .collect())
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
            git_worktree_diff_files,
            git_worktree_diff_patch,
            git_worktree_status,
            git_status_diff_patch,
            git_stage_paths,
            git_unstage_paths,
            git_commit,
            git_push,
            git_list_worktrees,
            terminal::terminal_spawn,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
