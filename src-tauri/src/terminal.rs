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
    pub data: Vec<u8>,
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
    inner: Mutex<Option<PtyInner>>,
}

impl Default for PtySession {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

struct PtyInner {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send>,
}

fn kill_session(slot: &Mutex<Option<PtyInner>>) {
    let Ok(mut guard) = slot.lock() else {
        return;
    };
    if let Some(mut inner) = guard.take() {
        let _ = inner.child.kill();
    }
}

#[tauri::command]
pub fn terminal_spawn(
    app: AppHandle,
    session: State<PtySession>,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let root = validate_workspace_dir(&cwd)?;
    let path = Path::new(root);

    kill_session(&session.inner);

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
        *guard = Some(PtyInner {
            master,
            writer,
            child,
        });
    }

    let app_handle = app.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = buf[..n].to_vec();
                    if app_handle
                        .emit(TERM_DATA_EVENT, TerminalDataPayload { data })
                        .is_err()
                    {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = app_handle.emit(TERM_EXIT_EVENT, ());
    });

    Ok(())
}

#[tauri::command]
pub fn terminal_write(session: State<PtySession>, data: Vec<u8>) -> Result<(), String> {
    let mut guard = session
        .inner
        .lock()
        .map_err(|_| "terminal session lock poisoned".to_string())?;
    let Some(inner) = guard.as_mut() else {
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
pub fn terminal_resize(session: State<PtySession>, cols: u16, rows: u16) -> Result<(), String> {
    let guard = session
        .inner
        .lock()
        .map_err(|_| "terminal session lock poisoned".to_string())?;
    let Some(inner) = guard.as_ref() else {
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
pub fn terminal_kill(session: State<PtySession>) -> Result<(), String> {
    kill_session(&session.inner);
    Ok(())
}
