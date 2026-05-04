import "./App.css";

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  CODE_VIEWER_THEME_OPTIONS,
  codeViewerThemeLabel,
  isKnownCodeViewerTheme,
  type CodeViewerThemeId,
  type CodeViewerThemePick,
} from "./repo/codeViewerThemes";
import { FocusMapOverlay } from "./components/FocusMapOverlay";
import { CodeViewer } from "./components/CodeViewer";
import { FileSearchPalette } from "./components/FileSearchPalette";
import { MagitGitPanel } from "./components/MagitGitPanel";
import { RepoTreePane } from "./components/RepoTreePane";
import { repoPathToAbsolute } from "./repo/absolutePath";
import {
  loadTextFileAbsolute,
  scanWorkspaceRoot,
  type ScanWorkspaceResult,
} from "./repo/scanWorkspace";

const LAST_ROOT_STORAGE_KEY = "codar:last-repo-root";
const CODE_THEME_PREF_STORAGE_KEY = "codar:code-theme-preference";

function parseCodeThemePick(raw: string | null): CodeViewerThemePick {
  if (raw === "auto" || raw === null) return "auto";
  if (typeof raw === "string" && isKnownCodeViewerTheme(raw)) return raw;
  return "auto";
}

function useSystemAppearanceLight(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia("(prefers-color-scheme: light)");
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => window.matchMedia("(prefers-color-scheme: light)").matches,
    () => false,
  );
}

/** Shown while `scanWorkspaceRoot` indexes the repository. */
function WorkspaceIndexingPanel({ context }: { context: "tree" | "viewer" }) {
  return (
    <div
      className={`workspace-indexing workspace-indexing--${context}`}
      aria-live="polite"
      aria-busy="true"
    >
      <span className="workspace-indexing-spinner" aria-hidden />
      <div className="workspace-indexing-copy">
        <p className="workspace-indexing-title">Indexing workspace</p>
        <p className="workspace-indexing-hint">
          Building the file list. Large repos can take a minute.
        </p>
      </div>
    </div>
  );
}

/** After ⌘K palette pick, focus the code scroll region once the file is open. */
function focusCodeViewerScrollSurface() {
  document
    .querySelector<HTMLElement>("[data-focus-scroll-surface]")
    ?.focus({ preventScroll: true });
}

/** Show styled scrollbars briefly while any scrollable surface is moving (capture phase). */
function useScrollFlashClass() {
  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    const reveal = () => {
      document.documentElement.dataset.scrolling = "true";
      if (hideTimer !== undefined) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        delete document.documentElement.dataset.scrolling;
      }, 900);
    };

    document.addEventListener("scroll", reveal, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", reveal, { capture: true });
      if (hideTimer !== undefined) clearTimeout(hideTimer);
      delete document.documentElement.dataset.scrolling;
    };
  }, []);
}

/** Inputs need Space for typing; tree rows / viewer need chord + arrow scroll without paging. */
function isSpaceTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  if (el.getAttribute("role") === "textbox") return true;
  return false;
}

/** Space paging on scroll-focused panes clashes with Space+Space focus map. */
function useSuppressSpacePagingInTreeAndViewer() {
  useEffect(() => {
    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key !== " ") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest(".file-palette-backdrop")) return;
      if (t.closest(".magit-backdrop")) return;

      let inViewer = false;
      let inExpandedTreeInner = false;
      for (const node of e.composedPath()) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches(".code-viewer-scroll")) {
          inViewer = true;
        }
        if (node.matches(".tree-panel-inner")) {
          const panel = node.closest(".tree-panel");
          if (
            panel instanceof HTMLElement &&
            !panel.classList.contains("collapsed")
          ) {
            inExpandedTreeInner = true;
          }
        }
      }

      if (!inViewer && !inExpandedTreeInner) return;

      if (inViewer) {
        e.preventDefault();
        return;
      }
      if (inExpandedTreeInner && !isSpaceTypingTarget(t)) {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDownCapture, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDownCapture, { capture: true });
  }, []);
}

export default function App() {
  useScrollFlashClass();
  useSuppressSpacePagingInTreeAndViewer();
  const [rootPath, setRootPath] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_ROOT_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [scan, setScan] = useState<ScanWorkspaceResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [selectedRel, setSelectedRel] = useState<string | null>(null);
  const [fileContents, setFileContents] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [fileLoading, setFileLoading] = useState(false);
  const [filePaletteOpen, setFilePaletteOpen] = useState(false);
  const [magitOpen, setMagitOpen] = useState(false);
  const [codeThemePick, setCodeThemePick] = useState<CodeViewerThemePick>(() => {
    try {
      return parseCodeThemePick(
        localStorage.getItem(CODE_THEME_PREF_STORAGE_KEY),
      );
    } catch {
      return "auto";
    }
  });

  const lastAutoOpenedRoot = useRef<string | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const palettePickFocusViewerPathRef = useRef<string | null>(null);
  const prefersLightChrome = useSystemAppearanceLight();

  useEffect(() => {
    try {
      localStorage.setItem(CODE_THEME_PREF_STORAGE_KEY, codeThemePick);
    } catch {
      /* ignore */
    }
  }, [codeThemePick]);

  const resolvedCodeViewerTheme = useMemo((): CodeViewerThemeId => {
    if (codeThemePick !== "auto") return codeThemePick;
    return prefersLightChrome ? "pierre-light" : "pierre-dark";
  }, [codeThemePick, prefersLightChrome]);

  const treeChromeTheme =
    prefersLightChrome ? "pierre-light" : "pierre-dark";

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key?.toLowerCase() !== "k") return;
      e.preventDefault();
      setFilePaletteOpen((o) => !o);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== "G") return;
      if (isSpaceTypingTarget(e.target)) return;
      e.preventDefault();
      setMagitOpen((o) => !o);
      setFilePaletteOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!rootPath) {
        setScan(null);
        setScanning(false);
        return;
      }
      setScan(null);
      setFileError(null);
      setSelectedRel(null);
      setFileContents(null);
      setScanning(true);
      try {
        const result = await scanWorkspaceRoot(rootPath);
        if (!cancelled) setScan(result);
      } catch (e) {
        if (!cancelled) {
          setScan(null);
          setFileError(
            e instanceof Error ? e.message : "Failed to scan directory.",
          );
        }
      } finally {
        if (!cancelled) setScanning(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  const loadFileRel = useCallback(
    async (rel: string | null) => {
      if (!rootPath || !rel) {
        setFileContents(null);
        setFileError(null);
        setFileLoading(false);
        return;
      }
      setFileError(null);
      setFileContents(null);
      setFileLoading(true);
      try {
        const abs = await repoPathToAbsolute(rootPath, rel);
        const result = await loadTextFileAbsolute(abs);
        if (result.ok) setFileContents(result.content);
        else {
          setFileContents(null);
          setFileError(result.message);
        }
      } catch (e) {
        setFileContents(null);
        setFileError(e instanceof Error ? e.message : String(e));
      } finally {
        setFileLoading(false);
      }
    },
    [rootPath],
  );

  useEffect(() => {
    if (!rootPath) {
      lastAutoOpenedRoot.current = null;
      setSelectedRel(null);
      setFileContents(null);
      setFileError(null);
      return;
    }

    if (!scan) return;

    if (lastAutoOpenedRoot.current === rootPath) return;
    lastAutoOpenedRoot.current = rootPath;

    const preferred = scan.readmePath;
    setSelectedRel(preferred ?? null);
    void loadFileRel(preferred ?? null);
  }, [rootPath, scan, loadFileRel]);

  const onSelectFileRel = useCallback(
    (relPath: string | null) => {
      setSelectedRel(relPath);
      void loadFileRel(relPath);
    },
    [loadFileRel],
  );

  /** When palette opens a file, move keyboard focus into the viewer after load. */
  useEffect(() => {
    const pending = palettePickFocusViewerPathRef.current;
    if (pending === null) return;
    if (fileLoading) return;

    if (selectedRel !== pending) {
      palettePickFocusViewerPathRef.current = null;
      return;
    }

    if (fileContents === null || fileError) {
      palettePickFocusViewerPathRef.current = null;
      return;
    }

    palettePickFocusViewerPathRef.current = null;
    requestAnimationFrame(() => {
      focusCodeViewerScrollSurface();
    });
  }, [selectedRel, fileLoading, fileContents, fileError]);

  const pickLocalFolder = async () => {
    setFileError(null);
    setCloneError(null);
    try {
      const dir = await open({ directory: true, multiple: false });
      if (!dir) return;
      setRootPath(dir);
      try {
        localStorage.setItem(LAST_ROOT_STORAGE_KEY, dir);
      } catch {
        /* ignore storage failures */
      }
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    }
  };

  const cloneFromGithub = async () => {
    setCloneError(null);
    setBusy(true);
    try {
      const path = await invoke<string>("git_clone_repo", {
        url: cloneUrl.trim(),
      });
      setRootPath(path);
      try {
        localStorage.setItem(LAST_ROOT_STORAGE_KEY, path);
      } catch {
        /* ignore */
      }
      setCloneUrl("");
    } catch (e) {
      setCloneError(
        typeof e === "string" ? e : e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  const breadcrumb =
    selectedRel ??
    (rootPath && scanning ? "Indexing workspace…" : "—");

  const indexingWorkspace = Boolean(rootPath && scanning);

  return (
    <div ref={shellRef} className="app-shell">
      <header
        className="app-toolbar"
        data-focus-landmark=""
        data-focus-map-label="Toolbar"
        tabIndex={-1}
      >
        <h1>Codar</h1>
        <button type="button" onClick={pickLocalFolder} disabled={busy}>
          Open folder…
        </button>
        <form
          className="github-form"
          onSubmit={(e) => {
            e.preventDefault();
            void cloneFromGithub();
          }}
        >
          <input
            type="url"
            name="github-url"
            placeholder="https://github.com/owner/repo"
            value={cloneUrl}
            onChange={(e) => setCloneUrl(e.currentTarget.value)}
            autoComplete="off"
            disabled={busy}
          />
          <button type="submit" disabled={busy || !cloneUrl.trim()}>
            Clone
          </button>
        </form>
        <span className="toolbar-spacer" />
        <div className="toolbar-theme-picker">
          <label htmlFor="code-theme-select" className="toolbar-theme-picker-label">
            Code theme
          </label>
          <select
            id="code-theme-select"
            className="toolbar-code-theme-select"
            value={codeThemePick}
            title="Syntax highlighting theme for the file viewer (@pierre/diffs + Shiki)"
            onChange={(e) => {
              const v = e.currentTarget.value;
              setCodeThemePick(v === "auto" || isKnownCodeViewerTheme(v) ? v : "auto");
            }}
          >
            <option value="auto">Auto (match system)</option>
            {CODE_VIEWER_THEME_OPTIONS.map((id) => (
              <option key={id} value={id}>
                {codeViewerThemeLabel(id)}
              </option>
            ))}
          </select>
        </div>
        <span
          className="toolbar-palette-hint"
          title="Search files (⌘K or Ctrl+K)"
          aria-hidden
        >
          <kbd>⌘</kbd>
          <kbd>K</kbd>
        </span>
        <span
          className="toolbar-magit-hint"
          title="Git status (Shift+G)"
          aria-hidden
        >
          <kbd>⇧</kbd>
          <kbd>G</kbd>
        </span>
        <span
          className={`breadcrumb${indexingWorkspace ? " breadcrumb-indexing" : ""}`}
          title={selectedRel ?? undefined}
        >
          {breadcrumb}
        </span>
        <button
          type="button"
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen((o) => !o)}
        >
          {sidebarOpen ? "Hide tree" : "Show tree"}
        </button>
      </header>

      {cloneError ? (
        <div className="error-banner" role="alert">
          {cloneError}
        </div>
      ) : null}
      {fileError ? (
        <div className="error-banner" role="alert">
          {fileError}
        </div>
      ) : null}

      <div
        className="app-body"
        aria-busy={indexingWorkspace || undefined}
      >
        <aside className={`tree-panel${sidebarOpen ? "" : " collapsed"}`}>
          <div
            className="tree-panel-inner"
            data-focus-landmark=""
            data-focus-map-label="File tree"
            tabIndex={-1}
          >
            {indexingWorkspace ? (
              <WorkspaceIndexingPanel context="tree" />
            ) : (
              <RepoTreePane
                scan={scan}
                workspaceKey={rootPath ?? ""}
                treeChromeTheme={treeChromeTheme}
                onSelectFileRel={onSelectFileRel}
              />
            )}
          </div>
        </aside>
        <section
          className="viewer-panel"
          data-focus-landmark=""
          data-focus-map-label="File viewer"
          tabIndex={-1}
        >
          <header>
            {indexingWorkspace
              ? "Indexing workspace…"
              : selectedRel
                ? (selectedRel.split("/").pop() ?? selectedRel)
                : scan?.readmePath
                  ? "Select a file"
                  : "No README in root — pick a file"}
          </header>
          {indexingWorkspace ? (
            <WorkspaceIndexingPanel context="viewer" />
          ) : selectedRel && fileLoading ? (
            <div className="pane-placeholder">Loading file…</div>
          ) : selectedRel && fileContents !== null ? (
            <CodeViewer
              relativePath={selectedRel}
              contents={fileContents}
              theme={resolvedCodeViewerTheme}
            />
          ) : (
            <div className="pane-placeholder">
              {!rootPath
                ? "Open a local folder or clone a GitHub repo to begin."
                : !selectedRel && !fileError
                  ? "Choose a file from the tree."
                  : null}
            </div>
          )}
        </section>
      </div>

      <FocusMapOverlay
        disabled={filePaletteOpen || magitOpen}
        landmarksRootRef={shellRef}
      />

      <FileSearchPalette
        open={filePaletteOpen}
        onClose={() => setFilePaletteOpen(false)}
        filePaths={scan?.filePaths ?? null}
        onPick={(path) => {
          palettePickFocusViewerPathRef.current = path;
          onSelectFileRel(path);
        }}
      />

      <MagitGitPanel
        open={magitOpen}
        onClose={() => setMagitOpen(false)}
        rootPath={rootPath}
      />
    </div>
  );
}
