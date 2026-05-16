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
import { DiffViewer } from "./components/DiffViewer";
import { FileSearchPalette } from "./components/FileSearchPalette";
import { RepoTreePane } from "./components/RepoTreePane";
import { Button } from "./components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import { ViewModeToggle } from "./components/ui/view-mode-toggle";
import { repoPathToAbsolute } from "./repo/absolutePath";
import { treePathsForTouchedFiles } from "./repo/diffTreePaths";
import type { GitStatusEntry } from "@pierre/trees";
import {
  loadTextFileAbsolute,
  scanWorkspaceRoot,
  type ScanWorkspaceResult,
} from "./repo/scanWorkspace";

const LAST_ROOT_STORAGE_KEY = "codar:last-repo-root";
const CODE_THEME_PREF_STORAGE_KEY = "codar:code-theme-preference";

type GitBranchListPayload = {
  ok: boolean;
  error: string | null;
  current: string | null;
  branches: string[];
};

type BranchDiffFileEntry = {
  path: string;
  status: string;
  oldPath: string | null;
};

function unionGitRefOptions(
  current: string | null | undefined,
  branches: readonly string[] | undefined,
  ...extra: (string | null | undefined)[]
): string[] {
  const s = new Set<string>();
  for (const x of [...extra, current, ...(branches ?? [])]) {
    const t = typeof x === "string" ? x.trim() : "";
    if (t.length > 0) s.add(t);
  }
  return [...s].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

function branchDiffToGitStatusEntry(e: BranchDiffFileEntry): GitStatusEntry {
  const st = e.status;
  if (
    st === "added" ||
    st === "modified" ||
    st === "deleted" ||
    st === "renamed"
  ) {
    return { path: e.path, status: st };
  }
  return { path: e.path, status: "modified" };
}

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
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [fileLoading, setFileLoading] = useState(false);
  const [filePaletteOpen, setFilePaletteOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"browse" | "diff">("browse");
  const [diffBaseRef, setDiffBaseRef] = useState("origin/main");
  const [diffHeadRef, setDiffHeadRef] = useState("HEAD");
  const [branchList, setBranchList] = useState<GitBranchListPayload | null>(
    null,
  );
  const [diffEntries, setDiffEntries] = useState<BranchDiffFileEntry[]>([]);
  const [diffListLoading, setDiffListLoading] = useState(false);
  const [diffListError, setDiffListError] = useState<string | null>(null);
  const [diffPatchText, setDiffPatchText] = useState<string | null>(null);
  const [diffPatchLoading, setDiffPatchLoading] = useState(false);
  const [diffPatchError, setDiffPatchError] = useState<string | null>(null);
  const [diffLoadGeneration, setDiffLoadGeneration] = useState(0);
  const [diffStyle, setDiffStyle] = useState<"unified" | "split">("unified");
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

  const branchRefOptions = useMemo(
    () =>
      unionGitRefOptions(
        branchList?.current,
        branchList?.branches,
        diffBaseRef,
        diffHeadRef,
        "origin/main",
        "main",
        "master",
        "HEAD",
      ),
    [branchList, diffBaseRef, diffHeadRef],
  );

  const diffTreeScan = useMemo((): ScanWorkspaceResult | null => {
    if (viewMode !== "diff" || !scan) return null;
    if (diffEntries.length === 0) return null;
    const paths = treePathsForTouchedFiles(diffEntries.map((e) => e.path));
    const filePaths = new Set(diffEntries.map((e) => e.path));
    return { paths, filePaths, readmePath: null };
  }, [viewMode, scan, diffEntries]);

  const diffGitStatusEntries = useMemo(
    () => diffEntries.map(branchDiffToGitStatusEntry),
    [diffEntries],
  );

  const diffTreeInstanceKey = useMemo(
    () =>
      `${diffBaseRef}\0${diffHeadRef}\0${diffEntries.map((e) => `${e.path}\t${e.status}`).join("\n")}`,
    [diffBaseRef, diffHeadRef, diffEntries],
  );

  const treeScanForPane = viewMode === "browse" ? scan : diffTreeScan;

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

  useEffect(() => {
    if (!rootPath || viewMode !== "diff") {
      setBranchList(null);
      setDiffEntries([]);
      setDiffListError(null);
      setDiffListLoading(false);
      setDiffPatchText(null);
      setDiffPatchError(null);
      setDiffPatchLoading(false);
      return;
    }

    let cancelled = false;
    setDiffListLoading(true);
    setDiffListError(null);
    (async () => {
      try {
        const bl = await invoke<GitBranchListPayload>("git_branch_list", {
          rootPath,
        });
        if (cancelled) return;
        setBranchList(bl);
        if (!bl.ok) {
          setDiffEntries([]);
          setDiffListError(bl.error ?? "Could not read repository branches.");
          return;
        }
        const files = await invoke<BranchDiffFileEntry[]>(
          "git_branch_diff_files",
          {
            rootPath,
            baseRef: diffBaseRef,
            headRef: diffHeadRef,
          },
        );
        if (cancelled) return;
        setDiffEntries(files);
        setSelectedRel((prev) => {
          if (prev && files.some((f) => f.path === prev)) return prev;
          return files[0]?.path ?? null;
        });
        setDiffListError(null);
      } catch (e) {
        if (!cancelled) {
          setDiffEntries([]);
          setDiffListError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setDiffListLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rootPath, viewMode, diffBaseRef, diffHeadRef, diffLoadGeneration]);

  useEffect(() => {
    if (!rootPath || viewMode !== "diff" || !selectedRel) {
      setDiffPatchText(null);
      setDiffPatchError(null);
      setDiffPatchLoading(false);
      return;
    }
    let cancelled = false;
    setDiffPatchLoading(true);
    setDiffPatchError(null);
    setDiffPatchText(null);
    (async () => {
      try {
        const patch = await invoke<string>("git_branch_diff_patch", {
          rootPath,
          baseRef: diffBaseRef,
          headRef: diffHeadRef,
          path: selectedRel,
        });
        if (!cancelled) {
          setDiffPatchText(patch);
          setDiffPatchError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setDiffPatchText(null);
          setDiffPatchError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setDiffPatchLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    rootPath,
    viewMode,
    selectedRel,
    diffBaseRef,
    diffHeadRef,
    diffLoadGeneration,
  ]);

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

    if (viewMode !== "browse") return;

    const preferred = scan.readmePath;
    setSelectedRel(preferred ?? null);
    void loadFileRel(preferred ?? null);
  }, [rootPath, scan, loadFileRel, viewMode]);

  const onSelectFileRel = useCallback(
    (relPath: string | null) => {
      setSelectedRel(relPath);
      if (viewMode === "browse") void loadFileRel(relPath);
    },
    [loadFileRel, viewMode],
  );

  /** When palette opens a file, move keyboard focus into the viewer after load. */
  useEffect(() => {
    const pending = palettePickFocusViewerPathRef.current;
    if (pending === null) return;

    if (viewMode === "browse") {
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
      return;
    }

    if (diffPatchLoading) return;

    if (selectedRel !== pending) {
      palettePickFocusViewerPathRef.current = null;
      return;
    }

    if (diffPatchError) {
      palettePickFocusViewerPathRef.current = null;
      return;
    }

    palettePickFocusViewerPathRef.current = null;
    requestAnimationFrame(() => {
      focusCodeViewerScrollSurface();
    });
  }, [
    viewMode,
    selectedRel,
    fileLoading,
    fileContents,
    fileError,
    diffPatchLoading,
    diffPatchError,
  ]);

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
      setCloneOpen(false);
    } catch (e) {
      setCloneError(
        typeof e === "string" ? e : e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  const breadcrumb =
    viewMode === "diff"
      ? selectedRel != null
        ? `${diffBaseRef} … ${diffHeadRef} · ${selectedRel}`
        : diffListLoading
          ? "Loading changed files…"
          : "—"
      : (selectedRel ??
        (rootPath && scanning ? "Indexing workspace…" : "—"));

  const indexingWorkspace = Boolean(rootPath && scanning);
  const diffSidebarLoading =
    viewMode === "diff" &&
    Boolean(rootPath) &&
    diffListLoading &&
    branchList?.ok !== false;

  const treeBusy = indexingWorkspace || diffSidebarLoading;

  return (
    <div ref={shellRef} className="app-shell">
      <header
        className="app-toolbar"
        data-focus-landmark=""
        data-focus-map-label="Toolbar"
        tabIndex={-1}
      >
        <div className="toolbar-primary">
          <span className="app-brand">Codar</span>
          <span className="toolbar-rule" aria-hidden />
          <div className="toolbar-cluster">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={pickLocalFolder}
              disabled={busy}
            >
              Open…
            </Button>
            <Popover open={cloneOpen} onOpenChange={setCloneOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                >
                  Clone
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-[min(340px,calc(100vw-48px))]"
              >
                <form
                  className="flex flex-wrap items-center gap-2"
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
                    className="min-w-[160px] flex-1 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-900 shadow-sm outline-none focus:ring-2 focus:ring-blue-500/35 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={busy || !cloneUrl.trim()}
                  >
                    Go
                  </Button>
                </form>
              </PopoverContent>
            </Popover>
          </div>
          <span className="toolbar-rule" aria-hidden />
          <ViewModeToggle
            value={viewMode}
            disabled={!rootPath}
            onChange={(v) => {
              if (v === "browse") {
                setViewMode("browse");
                if (scan?.readmePath) {
                  setSelectedRel(scan.readmePath);
                  void loadFileRel(scan.readmePath);
                }
              } else {
                setViewMode("diff");
              }
            }}
          />
          <span
            className={`toolbar-breadcrumb${treeBusy ? " toolbar-breadcrumb--busy" : ""}`}
            title={selectedRel ?? undefined}
          >
            {breadcrumb}
          </span>
          <span className="toolbar-rule" aria-hidden />
          <div className="toolbar-cluster toolbar-cluster--end">
            <Select
              value={codeThemePick}
              onValueChange={(v) => {
                setCodeThemePick(
                  v === "auto" || isKnownCodeViewerTheme(v) ? v : "auto",
                );
              }}
            >
              <SelectTrigger
                id="code-theme-select"
                className="h-7 max-w-[min(160px,28vw)] text-xs"
                aria-label="Syntax highlighting theme"
                title="Syntax highlighting (Shiki)"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto theme</SelectItem>
                {CODE_VIEWER_THEME_OPTIONS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {codeViewerThemeLabel(id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title="Search files — ⌘K or Ctrl+K"
              aria-label="Search files"
              onClick={() => setFilePaletteOpen((o) => !o)}
            >
              Find
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={sidebarOpen}
              aria-label={sidebarOpen ? "Hide file tree" : "Show file tree"}
              onClick={() => setSidebarOpen((o) => !o)}
            >
              {sidebarOpen ? "Hide tree" : "Tree"}
            </Button>
          </div>
        </div>
        {viewMode === "diff" && rootPath ? (
          <div
            className="toolbar-diff-bar"
            title="Compare git refs (two-dot). Refresh after fetch."
          >
            <label className="toolbar-diff-field">
              <span className="toolbar-diff-field-label">Base</span>
              <Select value={diffBaseRef} onValueChange={setDiffBaseRef}>
                <SelectTrigger className="h-[30px] max-w-[min(148px,24vw)] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {branchRefOptions.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="toolbar-diff-field">
              <span className="toolbar-diff-field-label">Compare</span>
              <Select value={diffHeadRef} onValueChange={setDiffHeadRef}>
                <SelectTrigger className="h-[30px] max-w-[min(148px,24vw)] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {branchRefOptions.map((r) => (
                    <SelectItem key={`cmp-${r}`} value={r}>
                      {r === "HEAD" && branchList?.current
                        ? `${r} (${branchList.current})`
                        : r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <div className="toolbar-diff-field">
              <span className="toolbar-diff-field-label" aria-hidden="true">
                &nbsp;
              </span>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="h-[30px] w-[30px] shrink-0 text-base"
                aria-label="Refresh diff"
                title="Reload branches and changed files"
                onClick={() => setDiffLoadGeneration((g) => g + 1)}
              >
                ↻
              </Button>
            </div>
            <label className="toolbar-diff-field">
              <span className="toolbar-diff-field-label">Layout</span>
              <Select
                value={diffStyle}
                onValueChange={(v) =>
                  setDiffStyle(v === "split" ? "split" : "unified")
                }
              >
                <SelectTrigger
                  className="h-[30px] max-w-[min(148px,24vw)] text-xs"
                  aria-label="Diff layout"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unified">Unified</SelectItem>
                  <SelectItem value="split">Split</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
        ) : null}
      </header>

      {cloneError ? (
        <div className="error-banner" role="alert">
          {cloneError}
        </div>
      ) : null}
      {fileError && viewMode === "browse" ? (
        <div className="error-banner" role="alert">
          {fileError}
        </div>
      ) : null}
      {viewMode === "diff" && diffPatchError ? (
        <div className="error-banner" role="alert">
          {diffPatchError}
        </div>
      ) : null}

      <div
        className="app-body"
        aria-busy={treeBusy || undefined}
      >
        <aside className={`tree-panel${sidebarOpen ? "" : " collapsed"}`}>
          <div
            className="tree-panel-inner"
            data-focus-landmark=""
            data-focus-map-label="File tree"
            tabIndex={-1}
          >
            {treeBusy ? (
              <WorkspaceIndexingPanel context="tree" />
            ) : viewMode === "diff" && diffListError ? (
              <div className="pane-placeholder pane-error">{diffListError}</div>
            ) : viewMode === "diff" && diffEntries.length === 0 ? (
              <div className="pane-placeholder">
                No changed files between these refs.
              </div>
            ) : treeScanForPane && treeScanForPane.paths.length > 0 ? (
              <RepoTreePane
                scan={treeScanForPane}
                workspaceKey={rootPath ?? ""}
                treeChromeTheme={treeChromeTheme}
                onSelectFileRel={onSelectFileRel}
                diffMode={
                  viewMode === "diff"
                    ? {
                        paths: diffTreeScan?.paths ?? [],
                        gitStatus: diffGitStatusEntries,
                        preferredSelectedRel: selectedRel,
                        instanceKey: diffTreeInstanceKey,
                      }
                    : null
                }
              />
            ) : (
              <div className="pane-placeholder">
                <p>No browsable files in this folder.</p>
              </div>
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
            {viewMode === "diff"
              ? diffSidebarLoading
                ? "Loading diff…"
                : selectedRel
                  ? (selectedRel.split("/").pop() ?? selectedRel)
                  : "Pick a changed file"
              : indexingWorkspace
                ? "Indexing workspace…"
                : selectedRel
                  ? (selectedRel.split("/").pop() ?? selectedRel)
                  : scan?.readmePath
                    ? "Select a file"
                    : "No README in root — pick a file"}
          </header>
          {treeBusy ? (
            <WorkspaceIndexingPanel context="viewer" />
          ) : viewMode === "diff" ? (
            !selectedRel ? (
              <div className="pane-placeholder">
                {diffEntries.length === 0
                  ? "No changes to show."
                  : "Choose a file from the tree."}
              </div>
            ) : diffPatchLoading ? (
              <div className="pane-placeholder">Loading patch…</div>
            ) : (
              <DiffViewer
                relativePath={selectedRel}
                patchText={diffPatchText ?? ""}
                theme={resolvedCodeViewerTheme}
                diffStyle={diffStyle}
              />
            )
          ) : indexingWorkspace ? (
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
        disabled={filePaletteOpen}
        landmarksRootRef={shellRef}
      />

      <FileSearchPalette
        open={filePaletteOpen}
        onClose={() => setFilePaletteOpen(false)}
        filePaths={
          viewMode === "diff" && diffEntries.length > 0
            ? new Set(diffEntries.map((e) => e.path))
            : (scan?.filePaths ?? null)
        }
        onPick={(path) => {
          palettePickFocusViewerPathRef.current = path;
          onSelectFileRel(path);
        }}
      />
    </div>
  );
}
