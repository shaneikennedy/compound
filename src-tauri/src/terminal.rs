use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Mutex;
use std::thread;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

const TERM_DATA_EVENT: &str = "terminal:data";
const TERM_EXIT_EVENT: &str = "terminal:exit";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalDataPayload {
    pub session_id: String,
    pub data: Vec<u8>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitPayload {
    pub session_id: String,
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

#[cfg(windows)]
fn build_shell_command(cwd: &Path) -> CommandBuilder {
    let mut cmd = CommandBuilder::new("powershell.exe");
    cmd.cwd(cwd);
    cmd.args(["-NoLogo", "-NoExit"]);
    cmd
}

#[cfg(not(windows))]
fn build_shell_command(cwd: &Path) -> CommandBuilder {
    // `new_default_prog` runs the passwd/default shell with argv0 `-basename` (login shell),
    // so macOS `/etc/zprofile` / `path_helper` and `~/.zprofile` run like in Terminal.app.
    let mut cmd = CommandBuilder::new_default_prog();
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    cmd
}

pub struct PtySession {
    inner: Mutex<HashMap<String, PtyInner>>,
}

impl Default for PtySession {
    fn default() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }
}

struct PtyInner {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send>,
}

fn kill_one(slot: &Mutex<HashMap<String, PtyInner>>, id: &str) {
    let Ok(mut guard) = slot.lock() else {
        return;
    };
    if let Some(mut inner) = guard.remove(id) {
        let _ = inner.child.kill();
    }
}

#[tauri::command]
pub fn terminal_spawn(
    app: AppHandle,
    session: State<PtySession>,
    session_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sid = session_id.trim();
    if sid.is_empty() {
        return Err("Terminal session id is empty.".into());
    }

    let root = validate_workspace_dir(&cwd)?;
    let path = Path::new(root);

    kill_one(&session.inner, sid);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("pty: {e}"))?;

    let master = pair.master;
    let slave = pair.slave;

    let cmd = build_shell_command(path);
    let child = slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn shell: {e}"))?;

    let mut reader = master
        .try_clone_reader()
        .map_err(|e| format!("pty reader: {e}"))?;
    let writer = master
        .take_writer()
        .map_err(|e| format!("pty writer: {e}"))?;

    {
        let mut guard = session
            .inner
            .lock()
            .map_err(|_| "terminal session lock poisoned".to_string())?;
        guard.insert(
            sid.to_string(),
            PtyInner {
                master,
                writer,
                child,
            },
        );
    }

    let app_handle = app.clone();
    let sid_owned = sid.to_string();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = buf[..n].to_vec();
                    if app_handle
                        .emit(
                            TERM_DATA_EVENT,
                            TerminalDataPayload {
                                session_id: sid_owned.clone(),
                                data,
                            },
                        )
                        .is_err()
                    {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = app_handle.emit(
            TERM_EXIT_EVENT,
            TerminalExitPayload {
                session_id: sid_owned,
            },
        );
    });

    Ok(())
}

#[tauri::command]
pub fn terminal_write(
    session: State<PtySession>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let sid = session_id.trim();
    if sid.is_empty() {
        return Ok(());
    }
    let mut guard = session
        .inner
        .lock()
        .map_err(|_| "terminal session lock poisoned".to_string())?;
    let Some(inner) = guard.get_mut(sid) else {
        return Ok(());
    };
    inner
        .writer
        .write_all(&data)
        .map_err(|e| format!("pty write: {e}"))?;
    let _ = inner.writer.flush();
    Ok(())
}

#[tauri::command]
pub fn terminal_resize(
    session: State<PtySession>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sid = session_id.trim();
    if sid.is_empty() {
        return Ok(());
    }
    let guard = session
        .inner
        .lock()
        .map_err(|_| "terminal session lock poisoned".to_string())?;
    let Some(inner) = guard.get(sid) else {
        return Ok(());
    };
    inner
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("pty resize: {e}"))
}

#[tauri::command]
pub fn terminal_kill(session: State<PtySession>, session_id: String) -> Result<(), String> {
    let sid = session_id.trim();
    if !sid.is_empty() {
        kill_one(&session.inner, sid);
    }
    Ok(())
}
