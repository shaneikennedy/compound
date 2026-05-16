import "./App.css";

import { invoke } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  isKnownCodeViewerTheme,
  type CodeViewerThemeId,
  type CodeViewerThemePick,
} from "./repo/codeViewerThemes";
import { AgentPurposeDialog } from "./components/AgentPurposeDialog";
import { PreferencesDialog } from "./components/PreferencesDialog";
import { AgentTerminal } from "./components/AgentTerminal";
import { FocusMapOverlay } from "./components/FocusMapOverlay";
import { CodeViewer } from "./components/CodeViewer";
import { DiffViewer } from "./components/DiffViewer";
import { FileSearchPalette } from "./components/FileSearchPalette";
import { ProjectOpenScreen } from "./components/ProjectOpenScreen";
import { RepoTreePane } from "./components/RepoTreePane";
import { TabStrip } from "./components/TabStrip";
import { Button } from "./components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import { ViewModeToggle } from "./components/ui/view-mode-toggle";
import { cn } from "./lib/utils";
import { repoPathToAbsolute } from "./repo/absolutePath";
import { treePathsForTouchedFiles } from "./repo/diffTreePaths";
import type { GitStatusEntry } from "@pierre/trees";
import {
  loadTextFileAbsolute,
  scanWorkspaceRoot,
  type ScanWorkspaceResult,
} from "./repo/scanWorkspace";
import {
  type BranchDiffFileEntry,
  type GitBranchListPayload,
  agentSessionConfigured,
  agentShellRoot,
  createWorkspaceTab,
  type WorkspaceTabState,
} from "./tabModel";

const LAST_ROOT_STORAGE_KEY = "codar:last-repo-root";
const CODE_THEME_PREF_STORAGE_KEY = "codar:code-theme-preference";

type DefaultBranchInfo = {
  shortName: string;
  startPoint: string;
};

function readInitialProjectRoot(): string | null {
  try {
    const p = localStorage.getItem(LAST_ROOT_STORAGE_KEY);
    return p?.trim() || null;
  } catch {
    return null;
  }
}

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

function WorkspaceIndexingPanel({
  context,
}: {
  context: "tree" | "viewer";
}) {
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

function focusCodeViewerScrollSurface() {
  document
    .querySelector<HTMLElement>("[data-focus-scroll-surface]")
    ?.focus({ preventScroll: true });
}

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

function isSpaceTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  if (el.getAttribute("role") === "textbox") return true;
  return false;
}

function preferencesShortcutIgnoreTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest("[data-codar-agent-terminal]")) return false;
  return isSpaceTypingTarget(el);
}

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

  const [projectRoot, setProjectRoot] = useState<string | null>(
    readInitialProjectRoot,
  );
  const [defaultBranchInfo, setDefaultBranchInfo] =
    useState<DefaultBranchInfo | null>(null);
  const [tabs, setTabs] = useState<WorkspaceTabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const [scan, setScan] = useState<ScanWorkspaceResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [agentDialogBusy, setAgentDialogBusy] = useState(false);
  const [agentDialogError, setAgentDialogError] = useState<string | null>(null);

  const [codeThemePick, setCodeThemePick] = useState<CodeViewerThemePick>(() => {
    try {
      return parseCodeThemePick(
        localStorage.getItem(CODE_THEME_PREF_STORAGE_KEY),
      );
    } catch {
      return "auto";
    }
  });
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  const activeTabIdRef = useRef<string | null>(null);
  activeTabIdRef.current = activeTabId;

  const readmeOpenedKeyRef = useRef<string>("");
  const shellRef = useRef<HTMLDivElement | null>(null);
  const palettePickFocusViewerPathRef = useRef<string | null>(null);
  const prefersLightChrome = useSystemAppearanceLight();

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId],
  );

  const patchTab = useCallback((id: string, patch: Partial<WorkspaceTabState>) => {
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const fileTreeRoot = useMemo(() => {
    if (!projectRoot || !activeTab) return null;
    if (
      activeTab.viewMode === "agent" &&
      activeTab.agentSession.kind === "worktree"
    ) {
      return activeTab.agentSession.info.path;
    }
    return projectRoot;
  }, [projectRoot, activeTab]);

  const defaultStartPoint =
    defaultBranchInfo?.startPoint ?? "origin/main";

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
    setAgentDialogOpen(false);
    setAgentDialogError(null);
  }, [activeTabId]);

  /** Bind repository + default branch; reset tabs (one project per window). */
  useEffect(() => {
    if (!projectRoot) {
      setDefaultBranchInfo(null);
      setTabs([]);
      setActiveTabId(null);
      setScan(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const info = await invoke<{
          shortName: string;
          startPoint: string;
        }>("git_resolve_default_branch", { rootPath: projectRoot });
        if (cancelled) return;
        setDefaultBranchInfo({
          shortName: info.shortName,
          startPoint: info.startPoint,
        });
        const id = crypto.randomUUID();
        setTabs([
          createWorkspaceTab(id, "Workspace 1", info.startPoint),
        ]);
        setActiveTabId(id);
      } catch {
        if (cancelled) return;
        setDefaultBranchInfo({
          shortName: "main",
          startPoint: "origin/main",
        });
        const id = crypto.randomUUID();
        setTabs([
          createWorkspaceTab(id, "Workspace 1", "origin/main"),
        ]);
        setActiveTabId(id);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectRoot]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key?.toLowerCase() !== "k") return;
      if (!activeTabId) return;
      e.preventDefault();
      setTabs((ts) =>
        ts.map((t) =>
          t.id === activeTabId
            ? { ...t, filePaletteOpen: !t.filePaletteOpen }
            : t,
        ),
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTabId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key?.toLowerCase() ?? "";
      if (k !== "," && e.code !== "Comma") return;
      if (preferencesShortcutIgnoreTypingTarget(e.target)) return;
      e.preventDefault();
      setPreferencesOpen((o) => !o);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const switchProject = useCallback(() => {
    try {
      localStorage.removeItem(LAST_ROOT_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setProjectRoot(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!fileTreeRoot) {
        setScan(null);
        setScanning(false);
        return;
      }
      setScan(null);
      if (activeTabId) {
        patchTab(activeTabId, {
          fileError: null,
          selectedRel: null,
          fileContents: null,
        });
      }
      setScanning(true);
      try {
        const result = await scanWorkspaceRoot(fileTreeRoot);
        if (!cancelled) setScan(result);
      } catch (e) {
        if (!cancelled) {
          setScan(null);
          if (activeTabId) {
            patchTab(activeTabId, {
              fileError:
                e instanceof Error ? e.message : "Failed to scan directory.",
            });
          }
        }
      } finally {
        if (!cancelled) setScanning(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [fileTreeRoot, activeTabId, patchTab]);

  const viewMode = activeTab?.viewMode ?? "browse";
  const diffBaseRef = activeTab?.diffBaseRef ?? defaultStartPoint;
  const diffHeadRef = activeTab?.diffHeadRef ?? "HEAD";
  const diffLoadGeneration = activeTab?.diffLoadGeneration ?? 0;
  const diffStyle = activeTab?.diffStyle ?? "unified";
  const selectedRel = activeTab?.selectedRel ?? null;
  const branchList = activeTab?.branchList ?? null;
  const diffEntries = activeTab?.diffEntries ?? [];
  const diffListLoading = activeTab?.diffListLoading ?? false;
  const diffListError = activeTab?.diffListError ?? null;
  const diffPatchText = activeTab?.diffPatchText ?? null;
  const diffPatchLoading = activeTab?.diffPatchLoading ?? false;
  const diffPatchError = activeTab?.diffPatchError ?? null;
  const sidebarOpen = activeTab?.sidebarOpen ?? true;
  const filePaletteOpen = activeTab?.filePaletteOpen ?? false;
  const fileLoading = activeTab?.fileLoading ?? false;
  const fileContents = activeTab?.fileContents ?? null;
  const fileError = activeTab?.fileError ?? null;
  const agentSession = activeTab?.agentSession ?? { kind: "unset" };
  const agentConfigured = agentSessionConfigured(agentSession);
  const agentShellCwd = useMemo(
    () =>
      projectRoot ? agentShellRoot(projectRoot, agentSession) : null,
    [projectRoot, agentSession],
  );

  const branchRefOptions = useMemo(
    () =>
      unionGitRefOptions(
        branchList?.current,
        branchList?.branches,
        diffBaseRef,
        diffHeadRef,
        defaultBranchInfo?.startPoint,
        "origin/main",
        "main",
        "master",
        "HEAD",
      ),
    [branchList, diffBaseRef, diffHeadRef, defaultBranchInfo?.startPoint],
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

  const treeScanForPane =
    viewMode === "browse"
      ? scan
      : viewMode === "diff"
        ? diffTreeScan
        : null;

  useEffect(() => {
    if (!projectRoot || !activeTabId || viewMode !== "diff") {
      if (activeTabId) {
        patchTab(activeTabId, {
          branchList: null,
          diffEntries: [],
          diffListError: null,
          diffListLoading: false,
          diffPatchText: null,
          diffPatchError: null,
          diffPatchLoading: false,
        });
      }
      return;
    }

    let cancelled = false;
    const tid = activeTabId;
    patchTab(tid, {
      diffListLoading: true,
      diffListError: null,
    });

    (async () => {
      try {
        const bl = await invoke<GitBranchListPayload>("git_branch_list", {
          rootPath: projectRoot,
        });
        if (cancelled || activeTabIdRef.current !== tid) return;
        patchTab(tid, { branchList: bl });
        if (!bl.ok) {
          patchTab(tid, {
            diffEntries: [],
            diffListError: bl.error ?? "Could not read repository branches.",
            diffListLoading: false,
          });
          return;
        }
        const files = await invoke<BranchDiffFileEntry[]>(
          "git_branch_diff_files",
          {
            rootPath: projectRoot,
            baseRef: diffBaseRef,
            headRef: diffHeadRef,
          },
        );
        if (cancelled || activeTabIdRef.current !== tid) return;
        setTabs((ts) =>
          ts.map((t) => {
            if (t.id !== tid) return t;
            const cur = t.selectedRel;
            const nextSel =
              cur && files.some((f) => f.path === cur)
                ? cur
                : files[0]?.path ?? null;
            return {
              ...t,
              diffEntries: files,
              diffListError: null,
              diffListLoading: false,
              selectedRel: nextSel,
            };
          }),
        );
      } catch (e) {
        if (!cancelled && activeTabIdRef.current === tid) {
          patchTab(tid, {
            diffEntries: [],
            diffListError: e instanceof Error ? e.message : String(e),
            diffListLoading: false,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    projectRoot,
    activeTabId,
    viewMode,
    diffBaseRef,
    diffHeadRef,
    diffLoadGeneration,
    patchTab,
  ]);

  useEffect(() => {
    if (!projectRoot || !activeTabId || viewMode !== "diff" || !selectedRel) {
      if (activeTabId) {
        patchTab(activeTabId, {
          diffPatchText: null,
          diffPatchError: null,
          diffPatchLoading: false,
        });
      }
      return;
    }

    let cancelled = false;
    const tid = activeTabId;
    patchTab(tid, {
      diffPatchLoading: true,
      diffPatchError: null,
      diffPatchText: null,
    });

    (async () => {
      try {
        const patch = await invoke<string>("git_branch_diff_patch", {
          rootPath: projectRoot,
          baseRef: diffBaseRef,
          headRef: diffHeadRef,
          path: selectedRel,
        });
        if (!cancelled && activeTabIdRef.current === tid) {
          patchTab(tid, {
            diffPatchText: patch,
            diffPatchError: null,
            diffPatchLoading: false,
          });
        }
      } catch (e) {
        if (!cancelled && activeTabIdRef.current === tid) {
          patchTab(tid, {
            diffPatchText: null,
            diffPatchError: e instanceof Error ? e.message : String(e),
            diffPatchLoading: false,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    projectRoot,
    activeTabId,
    viewMode,
    selectedRel,
    diffBaseRef,
    diffHeadRef,
    diffLoadGeneration,
    patchTab,
  ]);

  const loadFileRel = useCallback(
    async (rel: string | null) => {
      if (!activeTabId || !fileTreeRoot || !rel) {
        if (activeTabId) {
          patchTab(activeTabId, {
            fileContents: null,
            fileError: null,
            fileLoading: false,
          });
        }
        return;
      }
      patchTab(activeTabId, {
        fileError: null,
        fileContents: null,
        fileLoading: true,
      });
      try {
        const abs = await repoPathToAbsolute(fileTreeRoot, rel);
        const result = await loadTextFileAbsolute(abs);
        if (result.ok) {
          patchTab(activeTabId, {
            fileContents: result.content,
            fileError: null,
            fileLoading: false,
          });
        } else {
          patchTab(activeTabId, {
            fileContents: null,
            fileError: result.message,
            fileLoading: false,
          });
        }
      } catch (e) {
        patchTab(activeTabId, {
          fileContents: null,
          fileError: e instanceof Error ? e.message : String(e),
          fileLoading: false,
        });
      }
    },
    [activeTabId, fileTreeRoot, patchTab],
  );

  useEffect(() => {
    if (!scan || !activeTabId || viewMode !== "browse" || !fileTreeRoot) {
      return;
    }
    const key = `${activeTabId}:${fileTreeRoot}`;
    if (readmeOpenedKeyRef.current === key) return;
    readmeOpenedKeyRef.current = key;
    const preferred = scan.readmePath;
    patchTab(activeTabId, { selectedRel: preferred ?? null });
    void loadFileRel(preferred ?? null);
  }, [scan, activeTabId, viewMode, fileTreeRoot, loadFileRel, patchTab]);

  const onSelectFileRel = useCallback(
    (relPath: string | null) => {
      if (!activeTabId) return;
      patchTab(activeTabId, { selectedRel: relPath });
      if (viewMode === "browse") void loadFileRel(relPath);
    },
    [activeTabId, loadFileRel, patchTab, viewMode],
  );

  useEffect(() => {
    const pending = palettePickFocusViewerPathRef.current;
    if (pending === null || !activeTabId) return;

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
    activeTabId,
    viewMode,
    selectedRel,
    fileLoading,
    fileContents,
    fileError,
    diffPatchLoading,
    diffPatchError,
  ]);

  const addTab = useCallback(() => {
    const id = crypto.randomUUID();
    setTabs((ts) => {
      const n = ts.length + 1;
      return [
        ...ts,
        createWorkspaceTab(id, `Workspace ${n}`, defaultStartPoint),
      ];
    });
    setActiveTabId(id);
    readmeOpenedKeyRef.current = "";
  }, [defaultStartPoint]);

  const closeTab = useCallback(
    (id: string) => {
      setTabs((ts) => {
        if (ts.length <= 1) return ts;
        const i = ts.findIndex((t) => t.id === id);
        const next = ts.filter((t) => t.id !== id);
        const fallback =
          next[Math.max(0, i - 1)]?.id ?? next[0]?.id ?? null;
        setActiveTabId((cur) => (cur === id ? fallback : cur));
        readmeOpenedKeyRef.current = "";
        return next;
      });
    },
    [],
  );

  const onEnterAgentThisRepository = useCallback(() => {
    if (!activeTabId) return;
    setAgentDialogError(null);
    patchTab(activeTabId, {
      viewMode: "agent",
      agentSession: { kind: "main_repository" },
    });
    setAgentDialogOpen(false);
  }, [activeTabId, patchTab]);

  const onConfirmAgentPurpose = useCallback(
    async (purpose: string) => {
      if (!projectRoot || !activeTabId) return;
      setAgentDialogError(null);
      setAgentDialogBusy(true);
      try {
        const wt = await invoke<{ path: string; branch: string }>(
          "git_create_agent_worktree",
          {
            rootPath: projectRoot,
            purpose,
            baseStartPoint: defaultStartPoint,
          },
        );
        const shortLabel =
          purpose.length > 26 ? `${purpose.slice(0, 26)}…` : purpose;
        patchTab(activeTabId, {
          agentSession: {
            kind: "worktree",
            info: {
              path: wt.path,
              branch: wt.branch,
              purpose,
            },
          },
          viewMode: "agent",
          label: shortLabel,
        });
        setAgentDialogOpen(false);
      } catch (e) {
        setAgentDialogError(
          typeof e === "string"
            ? e
            : e instanceof Error
              ? e.message
              : String(e),
        );
      } finally {
        setAgentDialogBusy(false);
      }
    },
    [projectRoot, activeTabId, defaultStartPoint, patchTab],
  );

  const breadcrumb =
    viewMode === "agent"
      ? agentSession.kind === "worktree"
        ? `Agent · ${agentSession.info.branch}`
        : "Agent · this repository"
      : viewMode === "diff"
        ? selectedRel != null
          ? `${diffBaseRef} … ${diffHeadRef} · ${selectedRel}`
          : diffListLoading
            ? "Loading changed files…"
            : "—"
        : (selectedRel ??
          (projectRoot && scanning ? "Indexing workspace…" : "—"));

  const indexingWorkspace = Boolean(projectRoot && scanning);
  const diffSidebarLoading =
    viewMode === "diff" &&
    Boolean(projectRoot) &&
    diffListLoading &&
    branchList?.ok !== false;

  const treeBusy =
    viewMode !== "agent" && (indexingWorkspace || diffSidebarLoading);

  if (!projectRoot) {
    return (
      <div ref={shellRef} className="app-shell">
        <ProjectOpenScreen
          onProjectChosen={(path) => {
            try {
              localStorage.setItem(LAST_ROOT_STORAGE_KEY, path);
            } catch {
              /* ignore */
            }
            setProjectRoot(path);
          }}
        />
        <PreferencesDialog
          open={preferencesOpen}
          onOpenChange={setPreferencesOpen}
          projectRoot={null}
          codeThemePick={codeThemePick}
          onThemeChange={setCodeThemePick}
          onSwitchProject={switchProject}
        />
        <FocusMapOverlay
          disabled={true}
          landmarksRootRef={shellRef}
        />
      </div>
    );
  }

  if (!activeTab) {
    return (
      <div ref={shellRef} className="app-shell">
        <div className="pane-placeholder" style={{ flex: 1, margin: 24 }}>
          Loading project…
        </div>
        <PreferencesDialog
          open={preferencesOpen}
          onOpenChange={setPreferencesOpen}
          projectRoot={projectRoot}
          codeThemePick={codeThemePick}
          onThemeChange={setCodeThemePick}
          onSwitchProject={switchProject}
        />
      </div>
    );
  }

  const browseWorkspaceMain = (
    <>
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
              workspaceKey={fileTreeRoot ?? projectRoot}
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
            {!projectRoot
              ? "Open a repository to begin."
              : !selectedRel && !fileError
                ? "Choose a file from the tree."
                : null}
          </div>
        )}
      </section>
    </>
  );

  const agentViewFront = viewMode === "agent";

  return (
    <div ref={shellRef} className="app-shell">
      <TabStrip
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={setActiveTabId}
        onNewTab={addTab}
        onCloseTab={closeTab}
      />

      <header
        className="app-toolbar"
        data-focus-landmark=""
        data-focus-map-label="Toolbar"
        tabIndex={-1}
      >
        <div className="toolbar-primary">
          <ViewModeToggle
            value={viewMode}
            disabled={!projectRoot}
            onChange={(v) => {
              if (!activeTabId) return;
              if (v === "browse") {
                patchTab(activeTabId, { viewMode: "browse" });
                if (scan?.readmePath) {
                  patchTab(activeTabId, {
                    selectedRel: scan.readmePath,
                  });
                  void loadFileRel(scan.readmePath);
                }
              } else if (v === "diff") {
                patchTab(activeTabId, { viewMode: "diff" });
              } else {
                setAgentDialogError(null);
                if (agentSessionConfigured(activeTab.agentSession)) {
                  patchTab(activeTabId, { viewMode: "agent" });
                } else {
                  setAgentDialogOpen(true);
                }
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
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title="Preferences — ⌘, or Ctrl+,"
              aria-label="Preferences"
              onClick={() => {
                setPreferencesOpen(true);
              }}
            >
              Preferences
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title="Search files — ⌘K or Ctrl+K"
              aria-label="Search files"
              onClick={() => {
                if (!activeTabId) return;
                patchTab(activeTabId, {
                  filePaletteOpen: !filePaletteOpen,
                });
              }}
            >
              Find
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={sidebarOpen}
              aria-label={sidebarOpen ? "Hide file tree" : "Show file tree"}
              onClick={() => {
                if (!activeTabId) return;
                patchTab(activeTabId, {
                  sidebarOpen: !sidebarOpen,
                });
              }}
            >
              {sidebarOpen ? "Hide tree" : "Tree"}
            </Button>
          </div>
        </div>
        {viewMode === "diff" && projectRoot ? (
          <div
            className="toolbar-diff-bar"
            title="Compare git refs (two-dot). Refresh after fetch."
          >
            <label className="toolbar-diff-field">
              <span className="toolbar-diff-field-label">Base</span>
              <Select
                value={diffBaseRef}
                onValueChange={(v) => {
                  if (activeTabId) patchTab(activeTabId, { diffBaseRef: v });
                }}
              >
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
              <Select
                value={diffHeadRef}
                onValueChange={(v) => {
                  if (activeTabId) patchTab(activeTabId, { diffHeadRef: v });
                }}
              >
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
                onClick={() => {
                  if (!activeTabId) return;
                  patchTab(activeTabId, {
                    diffLoadGeneration:
                      (activeTab?.diffLoadGeneration ?? 0) + 1,
                  });
                }}
              >
                ↻
              </Button>
            </div>
            <label className="toolbar-diff-field">
              <span className="toolbar-diff-field-label">Layout</span>
              <Select
                value={diffStyle}
                onValueChange={(v) => {
                  if (!activeTabId) return;
                  patchTab(activeTabId, {
                    diffStyle: v === "split" ? "split" : "unified",
                  });
                }}
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

      {fileError && (viewMode === "browse" || viewMode === "agent") ? (
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
        className={cn("app-body", agentConfigured && "app-body--stacked")}
        aria-busy={treeBusy || undefined}
      >
        {agentConfigured && agentShellCwd ? (
          <div
            className={cn(
              "app-stack-layer app-stack-agent",
              agentViewFront
                ? "app-stack-layer--front"
                : "app-stack-layer--back",
            )}
            inert={!agentViewFront}
            aria-hidden={!agentViewFront}
          >
            <section className="agent-panel" tabIndex={-1}>
              <header>
                {agentSession.kind === "worktree" ? (
                  <>
                    <span className="text-zinc-600 dark:text-zinc-400">
                      {agentSession.info.purpose}
                    </span>
                    <span className="mx-2 text-zinc-400">·</span>
                    <span className="font-mono text-xs opacity-90">
                      {agentSession.info.path}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-zinc-600 dark:text-zinc-400">
                      This repository
                    </span>
                    <span className="mx-2 text-zinc-400">·</span>
                    <span className="font-mono text-xs opacity-90">
                      {projectRoot}
                    </span>
                  </>
                )}
              </header>
              <AgentTerminal
                key={`${activeTabId}:${agentShellCwd}`}
                rootPath={agentShellCwd}
                lightChrome={prefersLightChrome}
                visible={agentViewFront}
              />
            </section>
          </div>
        ) : null}
        {agentConfigured ? (
          <div
            className={cn(
              "app-stack-layer app-stack-browse",
              agentViewFront
                ? "app-stack-layer--back"
                : "app-stack-layer--front",
            )}
            inert={agentViewFront}
            aria-hidden={agentViewFront}
          >
            {browseWorkspaceMain}
          </div>
        ) : (
          browseWorkspaceMain
        )}
      </div>

      <AgentPurposeDialog
        open={agentDialogOpen}
        onOpenChange={(open) => {
          if (agentDialogBusy) return;
          setAgentDialogOpen(open);
          if (!open) setAgentDialogError(null);
        }}
        onConfirm={(purpose) => {
          void onConfirmAgentPurpose(purpose);
        }}
        onUseThisRepository={onEnterAgentThisRepository}
        busy={agentDialogBusy}
        error={agentDialogError}
        defaultBranchLabel={
          defaultBranchInfo
            ? `${defaultBranchInfo.shortName} (${defaultBranchInfo.startPoint})`
            : defaultStartPoint
        }
      />

      <PreferencesDialog
        open={preferencesOpen}
        onOpenChange={setPreferencesOpen}
        projectRoot={projectRoot}
        codeThemePick={codeThemePick}
        onThemeChange={setCodeThemePick}
        onSwitchProject={switchProject}
      />

      <FocusMapOverlay
        disabled={filePaletteOpen || preferencesOpen}
        landmarksRootRef={shellRef}
      />

      <FileSearchPalette
        open={filePaletteOpen}
        onClose={() => {
          if (activeTabId) patchTab(activeTabId, { filePaletteOpen: false });
        }}
        filePaths={
          viewMode === "diff" && diffEntries.length > 0
            ? new Set(diffEntries.map((e) => e.path))
            : (scan?.filePaths ?? null)
        }
        onPick={(path) => {
          palettePickFocusViewerPathRef.current = path;
          if (!activeTabId) return;
          if (viewMode === "agent") {
            patchTab(activeTabId, { viewMode: "browse" });
            patchTab(activeTabId, { selectedRel: path });
            void loadFileRel(path);
            return;
          }
          onSelectFileRel(path);
        }}
      />
    </div>
  );
}
