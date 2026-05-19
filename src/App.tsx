import "./App.css";

import { invoke } from "@tauri-apps/api/core";
import {
  Component,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  DEFAULT_AGENT_CLI_STORAGE_KEY,
  defaultAgentStartupCommand,
  parseDefaultAgentCliId,
  type DefaultAgentCliId,
} from "./repo/defaultAgentPreference";
import {
  isKnownCodeViewerTheme,
  type CodeViewerThemeId,
  type CodeViewerThemePick,
} from "./repo/codeViewerThemes";
import { AgentPurposeDialog } from "./components/AgentPurposeDialog";
import type { ListedWorktreeRow } from "./components/AgentResumeWorktreeDialog";
import { AgentResumeWorktreeDialog } from "./components/AgentResumeWorktreeDialog";
import { PreferencesDialog } from "./components/PreferencesDialog";
import { AgentTerminal } from "./components/AgentTerminal";
import { FocusMapOverlay } from "./components/FocusMapOverlay";
import { CodeViewer } from "./components/CodeViewer";
import { DiffViewer } from "./components/DiffViewer";
import { GitStatusPane } from "./components/GitStatusPane";
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
  type AgentSession,
  type BranchDiffFileEntry,
  type GitChangeArea,
  type GitWorktreeStatus,
  type ViewModeOption,
  agentSessionConfigured,
  agentShellRoot,
  agentWorktreeBrowseRoot,
  createWorkspaceTab,
  type WorkspaceTabState,
  workspaceTabDisplayName,
} from "./tabModel";

const LAST_ROOT_STORAGE_KEY = "compound:last-repo-root";
const CODE_THEME_PREF_STORAGE_KEY = "compound:code-theme-preference";

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

class WorkspaceChromeErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="pane-placeholder pane-error"
          style={{ flex: 1, padding: 24, overflow: "auto" }}
        >
          <p style={{ marginTop: 0 }}>Workspace UI crashed to a render error.</p>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: 12,
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            type="button"
            className="mt-3 rounded-md border border-zinc-300 bg-zinc-100 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            onClick={() => this.setState({ error: null })}
          >
            Dismiss
          </button>
        </div>
      );
    }
    return this.props.children;
  }
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
  if (el.closest("[data-compound-agent-terminal]")) return false;
  return isSpaceTypingTarget(el);
}

function composeAgentStartupShellLine(
  agentSession: AgentSession,
  defaultAgentCli: DefaultAgentCliId,
): string | null {
  const cliPart = defaultAgentStartupCommand(defaultAgentCli)?.trim();

  if (agentSession.kind === "worktree") {
    const b = agentSession.info.bootstrapShellCommand?.trim();
    if (b && cliPart) return `${b} && ${cliPart}`;
    if (b) return b;
    return cliPart ?? null;
  }

  return cliPart ?? null;
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

  const [agentResumeDialogOpen, setAgentResumeDialogOpen] = useState(false);
  const [agentResumeLoading, setAgentResumeLoading] = useState(false);
  const [agentResumeError, setAgentResumeError] = useState<string | null>(null);
  const [agentResumeRows, setAgentResumeRows] = useState<ListedWorktreeRow[]>(
    [],
  );

  const [codeThemePick, setCodeThemePick] = useState<CodeViewerThemePick>(() => {
    try {
      return parseCodeThemePick(
        localStorage.getItem(CODE_THEME_PREF_STORAGE_KEY),
      );
    } catch {
      return "auto";
    }
  });
  const [defaultAgentCli, setDefaultAgentCli] = useState<DefaultAgentCliId>(
    () => {
      try {
        return parseDefaultAgentCliId(
          localStorage.getItem(DEFAULT_AGENT_CLI_STORAGE_KEY),
        );
      } catch {
        return "none";
      }
    },
  );
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  const activeTabIdRef = useRef<string | null>(null);
  activeTabIdRef.current = activeTabId;

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

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

  const clearWorktreeBootstrapForTab = useCallback((tabId: string) => {
    setTabs((ts) =>
      ts.map((t) => {
        if (t.id !== tabId || t.agentSession.kind !== "worktree") return t;
        const cmd = t.agentSession.info.bootstrapShellCommand?.trim();
        if (!cmd) return t;
        return {
          ...t,
          agentSession: {
            kind: "worktree",
            info: { ...t.agentSession.info, bootstrapShellCommand: null },
          },
        };
      }),
    );
  }, []);

  const fileTreeRoot = useMemo(() => {
    if (!projectRoot || !activeTab) return null;
    // Filesystem scan uses the Tauri FS scope from "Open repository" (`projectRoot`).
    // Linked worktree paths are usually outside that directory, so scanning them returns
    // nothing. Only use the worktree path in Agent view, where the tree should match
    // the PTY/checkout (Diff still uses git on the worktree via `gitCheckoutRootForDiff`).
    if (
      activeTab.viewMode === "agent" &&
      activeTab.agentSession.kind === "worktree"
    ) {
      return agentWorktreeBrowseRoot(projectRoot, activeTab.agentSession.info);
    }
    return projectRoot;
  }, [projectRoot, activeTab]);

  /** `git diff` / status root: agent worktree checkout when this tab targets one, else the opened project folder. */
  const gitCheckoutRootForDiff = useMemo(() => {
    if (!projectRoot) return null;
    if (!activeTab) return projectRoot;
    if (activeTab.agentSession.kind === "worktree") {
      return agentWorktreeBrowseRoot(projectRoot, activeTab.agentSession.info);
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

  useEffect(() => {
    try {
      localStorage.setItem(DEFAULT_AGENT_CLI_STORAGE_KEY, defaultAgentCli);
    } catch {
      /* ignore */
    }
  }, [defaultAgentCli]);

  const resolvedCodeViewerTheme = useMemo((): CodeViewerThemeId => {
    if (codeThemePick !== "auto") return codeThemePick;
    return prefersLightChrome ? "pierre-light" : "pierre-dark";
  }, [codeThemePick, prefersLightChrome]);

  const treeChromeTheme =
    prefersLightChrome ? "pierre-light" : "pierre-dark";

  useEffect(() => {
    setAgentDialogOpen(false);
    setAgentDialogError(null);
    setAgentResumeDialogOpen(false);
    setAgentResumeError(null);
    setAgentResumeRows([]);
  }, [activeTabId]);

  useEffect(() => {
    if (!agentResumeDialogOpen || !projectRoot) return;
    let cancelled = false;
    setAgentResumeLoading(true);
    setAgentResumeError(null);
    (async () => {
      try {
        const rows = await invoke<ListedWorktreeRow[]>("git_list_worktrees", {
          rootPath: projectRoot,
        });
        if (!cancelled) setAgentResumeRows(rows);
      } catch (e) {
        if (!cancelled) {
          setAgentResumeRows([]);
          setAgentResumeError(
            e instanceof Error ? e.message : String(e),
          );
        }
      } finally {
        if (!cancelled) setAgentResumeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentResumeDialogOpen, projectRoot]);

  /** Bind repository + default branch; reset tabs (one project per window). */
  useEffect(() => {
    const killAgentsForStaleTabs = () => {
      for (const t of tabsRef.current) {
        if (agentSessionConfigured(t.agentSession)) {
          void invoke("terminal_kill", { sessionId: t.id }).catch(() => {});
        }
      }
    };

    if (!projectRoot) {
      killAgentsForStaleTabs();
      setDefaultBranchInfo(null);
      setTabs([]);
      setActiveTabId(null);
      setScan(null);
      return;
    }

    killAgentsForStaleTabs();

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
          createWorkspaceTab(id, 1),
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
          createWorkspaceTab(id, 1),
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
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab || tab.viewMode !== "browse") return;
      if (preferencesShortcutIgnoreTypingTarget(e.target)) return;
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
  }, [activeTabId, tabs]);

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
  const diffLoadGeneration = activeTab?.diffLoadGeneration ?? 0;
  const diffStyle = activeTab?.diffStyle ?? "unified";
  const selectedRel = activeTab?.selectedRel ?? null;
  const diffEntries = activeTab?.diffEntries ?? [];
  const diffListLoading = activeTab?.diffListLoading ?? false;
  const diffListError = activeTab?.diffListError ?? null;
  const diffPatchText = activeTab?.diffPatchText ?? null;
  const diffPatchLoading = activeTab?.diffPatchLoading ?? false;
  const diffPatchError = activeTab?.diffPatchError ?? null;
  const gitStatus = activeTab?.gitStatus ?? null;
  const gitStatusLoading = activeTab?.gitStatusLoading ?? false;
  const gitStatusError = activeTab?.gitStatusError ?? null;
  const gitSelectedArea = activeTab?.gitSelectedArea ?? null;
  const gitPatchText = activeTab?.gitPatchText ?? null;
  const gitPatchLoading = activeTab?.gitPatchLoading ?? false;
  const gitPatchError = activeTab?.gitPatchError ?? null;
  const gitLoadGeneration = activeTab?.gitLoadGeneration ?? 0;
  const gitCommitMessage = activeTab?.gitCommitMessage ?? "";
  const gitActionBusy = activeTab?.gitActionBusy ?? false;
  const gitActionError = activeTab?.gitActionError ?? null;
  const gitActionNotice = activeTab?.gitActionNotice ?? null;
  const sidebarOpen = activeTab?.sidebarOpen ?? true;
  const filePaletteOpen = activeTab?.filePaletteOpen ?? false;
  const fileLoading = activeTab?.fileLoading ?? false;
  const fileContents = activeTab?.fileContents ?? null;
  const fileError = activeTab?.fileError ?? null;
  const agentSession = activeTab?.agentSession ?? { kind: "unset" };
  const agentConfigured = agentSessionConfigured(agentSession);
  const tabsWithAgentSession = useMemo(
    () => tabs.filter((t) => agentSessionConfigured(t.agentSession)),
    [tabs],
  );
  const showAgentDeck =
    !!projectRoot && tabsWithAgentSession.length > 0;

  const diffTreeScan = useMemo((): ScanWorkspaceResult | null => {
    if (viewMode !== "diff") return null;
    if (diffEntries.length === 0) return null;
    const paths = treePathsForTouchedFiles(diffEntries.map((e) => e.path));
    const filePaths = new Set(diffEntries.map((e) => e.path));
    return { paths, filePaths, readmePath: null };
  }, [viewMode, diffEntries]);

  const diffGitStatusEntries = useMemo(
    () => diffEntries.map(branchDiffToGitStatusEntry),
    [diffEntries],
  );

  const diffTreeInstanceKey = useMemo(
    () => diffEntries.map((e) => `${e.path}\t${e.status}`).join("\n"),
    [diffEntries],
  );

  const treeScanForPane =
    viewMode === "browse"
      ? scan
      : viewMode === "diff"
        ? diffTreeScan
        : null;

  useEffect(() => {
    if (!gitCheckoutRootForDiff || !activeTabId || viewMode !== "diff") {
      if (activeTabId) {
        patchTab(activeTabId, {
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
        const files = await invoke<BranchDiffFileEntry[]>(
          "git_worktree_diff_files",
          {
            rootPath: gitCheckoutRootForDiff,
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
    gitCheckoutRootForDiff,
    activeTabId,
    viewMode,
    diffLoadGeneration,
    patchTab,
  ]);

  useEffect(() => {
    if (
      !gitCheckoutRootForDiff ||
      !activeTabId ||
      viewMode !== "diff" ||
      !selectedRel
    ) {
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
        const patch = await invoke<string>("git_worktree_diff_patch", {
          rootPath: gitCheckoutRootForDiff,
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
    gitCheckoutRootForDiff,
    activeTabId,
    viewMode,
    selectedRel,
    diffLoadGeneration,
    patchTab,
  ]);

  useEffect(() => {
    if (!gitCheckoutRootForDiff || !activeTabId || viewMode !== "git") {
      if (activeTabId) {
        patchTab(activeTabId, {
          gitStatus: null,
          gitStatusError: null,
          gitStatusLoading: false,
          gitPatchText: null,
          gitPatchError: null,
          gitPatchLoading: false,
        });
      }
      return;
    }

    let cancelled = false;
    const tid = activeTabId;
    patchTab(tid, {
      gitStatusLoading: true,
      gitStatusError: null,
    });

    (async () => {
      try {
        const status = await invoke<GitWorktreeStatus>("git_worktree_status", {
          rootPath: gitCheckoutRootForDiff,
        });
        if (cancelled || activeTabIdRef.current !== tid) return;
        setTabs((ts) =>
          ts.map((t) => {
            if (t.id !== tid) return t;
            const curPath = t.selectedRel;
            const curArea = t.gitSelectedArea;
            const stillSelected =
              curPath != null &&
              curArea != null &&
              status.files.some(
                (f) => f.path === curPath && f.area === curArea,
              );
            const first = status.files[0] ?? null;
            return {
              ...t,
              gitStatus: status,
              gitStatusError: null,
              gitStatusLoading: false,
              selectedRel: stillSelected ? curPath : (first?.path ?? null),
              gitSelectedArea: stillSelected
                ? curArea
                : (first?.area ?? null),
            };
          }),
        );
      } catch (e) {
        if (!cancelled && activeTabIdRef.current === tid) {
          patchTab(tid, {
            gitStatus: null,
            gitStatusError: e instanceof Error ? e.message : String(e),
            gitStatusLoading: false,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    gitCheckoutRootForDiff,
    activeTabId,
    viewMode,
    gitLoadGeneration,
    patchTab,
  ]);

  useEffect(() => {
    if (
      !gitCheckoutRootForDiff ||
      !activeTabId ||
      viewMode !== "git" ||
      !selectedRel ||
      !gitSelectedArea
    ) {
      if (activeTabId) {
        patchTab(activeTabId, {
          gitPatchText: null,
          gitPatchError: null,
          gitPatchLoading: false,
        });
      }
      return;
    }

    let cancelled = false;
    const tid = activeTabId;
    const area = gitSelectedArea;
    const path = selectedRel;
    patchTab(tid, {
      gitPatchLoading: true,
      gitPatchError: null,
      gitPatchText: null,
    });

    (async () => {
      try {
        const patch = await invoke<string>("git_status_diff_patch", {
          rootPath: gitCheckoutRootForDiff,
          path,
          area,
        });
        if (!cancelled && activeTabIdRef.current === tid) {
          patchTab(tid, {
            gitPatchText: patch,
            gitPatchError: null,
            gitPatchLoading: false,
          });
        }
      } catch (e) {
        if (!cancelled && activeTabIdRef.current === tid) {
          patchTab(tid, {
            gitPatchText: null,
            gitPatchError: e instanceof Error ? e.message : String(e),
            gitPatchLoading: false,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    gitCheckoutRootForDiff,
    activeTabId,
    viewMode,
    selectedRel,
    gitSelectedArea,
    gitLoadGeneration,
    patchTab,
  ]);

  const refreshGitStatus = useCallback(() => {
    if (!activeTabId) return;
    patchTab(activeTabId, {
      gitLoadGeneration: gitLoadGeneration + 1,
      gitActionNotice: null,
    });
  }, [activeTabId, gitLoadGeneration, patchTab]);

  const runGitMutation = useCallback(
    async (fn: () => Promise<void>) => {
      if (!activeTabId) return;
      patchTab(activeTabId, {
        gitActionBusy: true,
        gitActionError: null,
        gitActionNotice: null,
      });
      try {
        await fn();
        refreshGitStatus();
      } catch (e) {
        patchTab(activeTabId, {
          gitActionError: e instanceof Error ? e.message : String(e),
        });
      } finally {
        patchTab(activeTabId, { gitActionBusy: false });
      }
    },
    [activeTabId, patchTab, refreshGitStatus],
  );

  const onGitStagePaths = useCallback(
    (paths: string[]) => {
      if (!gitCheckoutRootForDiff || paths.length === 0) return;
      void runGitMutation(async () => {
        await invoke("git_stage_paths", {
          rootPath: gitCheckoutRootForDiff,
          paths,
        });
      });
    },
    [gitCheckoutRootForDiff, runGitMutation],
  );

  const onGitUnstagePaths = useCallback(
    (paths: string[]) => {
      if (!gitCheckoutRootForDiff || paths.length === 0) return;
      void runGitMutation(async () => {
        await invoke("git_unstage_paths", {
          rootPath: gitCheckoutRootForDiff,
          paths,
        });
      });
    },
    [gitCheckoutRootForDiff, runGitMutation],
  );

  const onGitStageAll = useCallback(
    (area: "unstaged" | "untracked") => {
      const paths =
        gitStatus?.files.filter((f) => f.area === area).map((f) => f.path) ??
        [];
      onGitStagePaths(paths);
    },
    [gitStatus, onGitStagePaths],
  );

  const onGitUnstageAll = useCallback(() => {
    const paths =
      gitStatus?.files.filter((f) => f.area === "staged").map((f) => f.path) ??
      [];
    onGitUnstagePaths(paths);
  }, [gitStatus, onGitUnstagePaths]);

  const onGitCommit = useCallback(() => {
    if (!gitCheckoutRootForDiff || !activeTabId) return;
    const message = gitCommitMessage.trim();
    if (!message) {
      patchTab(activeTabId, { gitActionError: "Commit message is required." });
      return;
    }
    void runGitMutation(async () => {
      const result = await invoke<{ revision: string; summary: string }>(
        "git_commit",
        {
          rootPath: gitCheckoutRootForDiff,
          message,
        },
      );
      patchTab(activeTabId, {
        gitCommitMessage: "",
        gitActionNotice: result.summary || `Committed ${result.revision}`,
      });
    });
  }, [
    gitCheckoutRootForDiff,
    activeTabId,
    gitCommitMessage,
    patchTab,
    runGitMutation,
  ]);

  const onGitPush = useCallback(() => {
    if (!gitCheckoutRootForDiff || !activeTabId) return;
    void runGitMutation(async () => {
      const result = await invoke<{ summary: string }>("git_push", {
        rootPath: gitCheckoutRootForDiff,
      });
      patchTab(activeTabId, {
        gitActionNotice: result.summary,
      });
    });
  }, [gitCheckoutRootForDiff, activeTabId, patchTab, runGitMutation]);

  const onSelectGitFile = useCallback(
    (path: string, area: GitChangeArea) => {
      if (!activeTabId) return;
      patchTab(activeTabId, { selectedRel: path, gitSelectedArea: area });
    },
    [activeTabId, patchTab],
  );

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

  const defaultBranchShortName = defaultBranchInfo?.shortName ?? "main";

  const workspaceTabTitle = useCallback(
    (t: WorkspaceTabState) =>
      workspaceTabDisplayName(t, defaultBranchShortName),
    [defaultBranchShortName],
  );

  const applyViewMode = useCallback(
    (v: ViewModeOption) => {
      if (!activeTabId || !activeTab) return;
      setPreferencesOpen(false);
      setAgentDialogError(null);
      setAgentResumeDialogOpen(false);

      if (v === "browse") {
        setAgentDialogOpen(false);
        patchTab(activeTabId, {
          viewMode: "browse",
          filePaletteOpen: false,
        });
        if (scan?.readmePath) {
          patchTab(activeTabId, { selectedRel: scan.readmePath });
          void loadFileRel(scan.readmePath);
        }
      } else if (v === "diff") {
        setAgentDialogOpen(false);
        patchTab(activeTabId, {
          viewMode: "diff",
          filePaletteOpen: false,
        });
      } else if (v === "git") {
        setAgentDialogOpen(false);
        patchTab(activeTabId, {
          viewMode: "git",
          filePaletteOpen: false,
        });
      } else if (agentSessionConfigured(activeTab.agentSession)) {
        setAgentDialogOpen(false);
        patchTab(activeTabId, {
          viewMode: "agent",
          filePaletteOpen: false,
        });
      } else {
        patchTab(activeTabId, { filePaletteOpen: false });
        setAgentDialogOpen(true);
      }
    },
    [activeTabId, activeTab, patchTab, scan, loadFileRel],
  );

  const addTab = useCallback(() => {
    const id = crypto.randomUUID();
    setTabs((ts) => {
      const n = ts.length + 1;
      return [...ts, createWorkspaceTab(id, n)];
    });
    setActiveTabId(id);
    readmeOpenedKeyRef.current = "";
  }, []);

  const navigateTab = useCallback(
    (delta: -1 | 1) => {
      if (tabs.length < 2) return;
      const i = tabs.findIndex((t) => t.id === activeTabId);
      if (i < 0) return;
      const next = (i + delta + tabs.length) % tabs.length;
      setActiveTabId(tabs[next]!.id);
      readmeOpenedKeyRef.current = "";
    },
    [tabs, activeTabId],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.altKey) return;
      if (!projectRoot || !activeTabId || !activeTab) return;

      if (e.code === "BracketLeft" || e.code === "BracketRight") {
        e.preventDefault();
        navigateTab(e.code === "BracketLeft" ? -1 : 1);
        return;
      }

      if (e.shiftKey) return;

      if (e.code === "KeyT") {
        e.preventDefault();
        addTab();
        return;
      }
      if (e.code === "KeyB") {
        e.preventDefault();
        applyViewMode("browse");
        return;
      }
      if (e.code === "KeyD") {
        e.preventDefault();
        applyViewMode("diff");
        return;
      }
      if (e.code === "KeyG") {
        e.preventDefault();
        applyViewMode("git");
        return;
      }
      if (e.code === "KeyA") {
        e.preventDefault();
        applyViewMode("agent");
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    projectRoot,
    activeTabId,
    activeTab,
    addTab,
    navigateTab,
    applyViewMode,
  ]);

  const closeTab = useCallback(
    (id: string) => {
      const tabBeingClosed = tabsRef.current.find((t) => t.id === id);
      if (
        tabBeingClosed &&
        agentSessionConfigured(tabBeingClosed.agentSession)
      ) {
        void invoke("terminal_kill", { sessionId: id }).catch(() => {});
      }
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
        const wt = await invoke<{
          path: string;
          branch: string;
          bootstrapShellCommand: string;
        }>(
          "git_create_agent_worktree",
          {
            rootPath: projectRoot,
            purpose,
            baseStartPoint: defaultStartPoint,
          },
        );
        patchTab(activeTabId, {
          agentSession: {
            kind: "worktree",
            info: {
              path: wt.path,
              branch: wt.branch,
              purpose,
              bootstrapShellCommand: wt.bootstrapShellCommand,
            },
          },
          viewMode: "agent",
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

  const onPickResumedWorktree = useCallback(
    (row: ListedWorktreeRow) => {
      if (!activeTabId) return;
      const branchLabel = row.branchShort ?? "(detached)";
      const purpose =
        row.branchShort != null &&
        row.branchShort.length > 0 &&
        !row.detached
          ? `Resumed (${row.branchShort})`
          : "Resumed (detached HEAD)";
      setAgentResumeError(null);
      patchTab(activeTabId, {
        viewMode: "agent",
        agentSession: {
          kind: "worktree",
          info: {
            path: row.path,
            branch: branchLabel,
            purpose,
            bootstrapShellCommand: null,
            resumedFromWorktreePicker: true,
          },
        },
      });
      setAgentResumeDialogOpen(false);
    },
    [activeTabId, patchTab],
  );

  const openResumeExistingWorktrees = useCallback(() => {
    setAgentDialogError(null);
    setAgentResumeError(null);
    setAgentDialogOpen(false);
    setAgentResumeDialogOpen(true);
  }, []);

  const backResumeDialogToPurpose = useCallback(() => {
    setAgentResumeDialogOpen(false);
    setAgentResumeError(null);
    setAgentDialogOpen(true);
  }, []);

  const breadcrumb =
    viewMode === "agent"
      ? agentSession.kind === "worktree"
        ? `Agent · ${agentSession.info.branch}`
        : `Agent · ${defaultBranchShortName}`
      : viewMode === "diff"
        ? selectedRel != null
          ? `Local · ${selectedRel}`
          : diffListLoading
            ? "Loading changed files…"
            : "—"
        : viewMode === "git"
          ? selectedRel != null && gitSelectedArea
            ? `${gitSelectedArea === "staged" ? "Staged" : gitSelectedArea === "untracked" ? "Untracked" : "Unstaged"} · ${selectedRel}`
            : gitStatusLoading
              ? "Loading git status…"
              : gitStatus?.branch
                ? `Git · ${gitStatus.branch}`
                : "Git"
        : (selectedRel ??
          (projectRoot && scanning ? "Indexing workspace…" : "—"));

  const indexingWorkspace = Boolean(projectRoot && scanning);
  const diffListBusy = Boolean(projectRoot && diffListLoading);
  const gitListBusy = Boolean(projectRoot && gitStatusLoading);
  const diffSidebarLoading = viewMode === "diff" && diffListBusy;
  const gitSidebarLoading = viewMode === "git" && gitListBusy;
  /** Browse uses filesystem scan; diff only waits on the git changed-file list (not unrelated indexing). */
  const treeSidebarBusy =
    viewMode !== "agent" &&
    (viewMode === "browse"
      ? indexingWorkspace
      : viewMode === "git"
        ? gitListBusy
        : diffListBusy);

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
          defaultAgentCli={defaultAgentCli}
          onDefaultAgentCliChange={setDefaultAgentCli}
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
          defaultAgentCli={defaultAgentCli}
          onDefaultAgentCliChange={setDefaultAgentCli}
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
          {treeSidebarBusy ? (
            <WorkspaceIndexingPanel context="tree" />
          ) : viewMode === "git" && gitStatusError ? (
            <div className="pane-placeholder pane-error">{gitStatusError}</div>
          ) : viewMode === "git" ? (
            <GitStatusPane
              files={gitStatus?.files ?? []}
              branch={gitStatus?.branch ?? null}
              selectedPath={selectedRel}
              selectedArea={gitSelectedArea}
              actionBusy={gitActionBusy}
              onSelect={onSelectGitFile}
              onStage={onGitStagePaths}
              onUnstage={onGitUnstagePaths}
              onStageAll={onGitStageAll}
              onUnstageAll={onGitUnstageAll}
            />
          ) : viewMode === "diff" && diffListError ? (
            <div className="pane-placeholder pane-error">{diffListError}</div>
          ) : viewMode === "diff" && diffEntries.length === 0 ? (
            <div className="pane-placeholder">
              Working tree matches HEAD — nothing to diff locally.
            </div>
          ) : treeScanForPane && treeScanForPane.paths.length > 0 ? (
            <RepoTreePane
              scan={treeScanForPane}
              workspaceKey={fileTreeRoot ?? projectRoot}
              treeChromeTheme={treeChromeTheme}
              onSelectFileRel={onSelectFileRel}
              committedSelectedRel={selectedRel}
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
            : viewMode === "git"
              ? gitSidebarLoading
                ? "Loading changes…"
                : selectedRel
                  ? (selectedRel.split("/").pop() ?? selectedRel)
                  : gitStatus?.files.length
                    ? "Pick a changed file"
                    : "No local changes"
            : indexingWorkspace
              ? "Indexing workspace…"
              : selectedRel
                ? (selectedRel.split("/").pop() ?? selectedRel)
                : scan?.readmePath
                  ? "Select a file"
                  : "No README in root — pick a file"}
        </header>
        {treeSidebarBusy ? (
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
        ) : viewMode === "git" ? (
          !selectedRel || !gitSelectedArea ? (
            <div className="pane-placeholder">
              {(gitStatus?.files.length ?? 0) === 0
                ? "Working tree is clean."
                : "Choose a file from the list."}
            </div>
          ) : gitPatchLoading ? (
            <div className="pane-placeholder">Loading patch…</div>
          ) : (
            <DiffViewer
              relativePath={selectedRel}
              patchText={gitPatchText ?? ""}
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
      <WorkspaceChromeErrorBoundary>
        <TabStrip
          tabs={tabs}
          activeTabId={activeTabId}
          tabDisplayName={workspaceTabTitle}
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
              applyViewMode(v);
            }}
          />
          <span
            className={`toolbar-breadcrumb${treeSidebarBusy ? " toolbar-breadcrumb--busy" : ""}`}
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
              disabled={!projectRoot || viewMode !== "browse"}
              title={
                viewMode !== "browse"
                  ? "Search files is only available in Browse mode"
                  : "Search files — ⌘K or Ctrl+K"
              }
              aria-label="Search files"
              onClick={() => {
                if (!activeTabId || viewMode !== "browse") return;
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
            title="Uncommitted local changes vs HEAD. Refresh after edits."
          >
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
                title="Reload changed files"
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
        {viewMode === "git" && projectRoot ? (
          <div
            className="toolbar-diff-bar toolbar-git-bar"
            title="Stage, commit, and push local changes."
          >
            <div className="toolbar-diff-field">
              <span className="toolbar-diff-field-label" aria-hidden="true">
                &nbsp;
              </span>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="h-[30px] w-[30px] shrink-0 text-base"
                aria-label="Refresh git status"
                title="Reload git status"
                disabled={gitActionBusy}
                onClick={refreshGitStatus}
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
            <label className="toolbar-git-commit-field">
              <span className="toolbar-diff-field-label">Commit message</span>
              <input
                type="text"
                className="toolbar-git-commit-input"
                placeholder="Describe your changes"
                value={gitCommitMessage}
                disabled={gitActionBusy}
                onChange={(e) => {
                  if (!activeTabId) return;
                  patchTab(activeTabId, {
                    gitCommitMessage: e.target.value,
                    gitActionError: null,
                  });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    onGitCommit();
                  }
                }}
              />
            </label>
            <div className="toolbar-git-actions">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={
                  gitActionBusy ||
                  !gitCommitMessage.trim() ||
                  (gitStatus?.files.filter((f) => f.area === "staged").length ??
                    0) === 0
                }
                onClick={onGitCommit}
              >
                Commit
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={gitActionBusy}
                onClick={onGitPush}
              >
                Push
              </Button>
            </div>
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
      {viewMode === "git" && gitPatchError ? (
        <div className="error-banner" role="alert">
          {gitPatchError}
        </div>
      ) : null}
      {viewMode === "git" && gitActionError ? (
        <div className="error-banner" role="alert">
          {gitActionError}
        </div>
      ) : null}
      {viewMode === "git" && gitActionNotice ? (
        <div className="git-notice-banner" role="status">
          {gitActionNotice}
        </div>
      ) : null}

      <div
        className={cn("app-body", agentConfigured && "app-body--stacked")}
        aria-busy={treeSidebarBusy || undefined}
      >
        {showAgentDeck ? (
          <div
            className={cn(
              "app-stack-layer app-stack-agent",
              agentViewFront && agentConfigured
                ? "app-stack-layer--front"
                : "app-stack-layer--back",
            )}
            inert={!(agentViewFront && agentConfigured)}
            aria-hidden={!(agentViewFront && agentConfigured)}
          >
            {agentConfigured ? (
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
                {tabsWithAgentSession.map((t) => {
                  const shellCwd = agentShellRoot(projectRoot!, t.agentSession)!;
                  const inMainAgentLayout =
                    activeTab != null &&
                    t.id === activeTab.id &&
                    agentSessionConfigured(activeTab.agentSession);
                  return (
                    <div
                      key={`${t.id}:${shellCwd}`}
                      className={cn(
                        "flex min-h-0 flex-col",
                        inMainAgentLayout
                          ? "min-h-0 flex-1"
                          : "pointer-events-none fixed top-0 -left-[9999px] h-[420px] w-[min(100vw,800px)] opacity-0",
                      )}
                    >
                      <AgentTerminal
                        sessionId={t.id}
                        rootPath={shellCwd}
                        lightChrome={prefersLightChrome}
                        visible={t.id === activeTabId && agentViewFront}
                        startupShellLine={composeAgentStartupShellLine(
                          t.agentSession,
                          defaultAgentCli,
                        )}
                        onStartupShellLineConsumed={() =>
                          clearWorktreeBootstrapForTab(t.id)
                        }
                      />
                    </div>
                  );
                })}
              </section>
            ) : (
              <div
                aria-hidden
                className="pointer-events-none fixed top-0 -left-[9999px] h-[420px] w-[min(100vw,800px)] opacity-0"
              >
                {tabsWithAgentSession.map((t) => {
                  const shellCwd = agentShellRoot(projectRoot!, t.agentSession)!;
                  return (
                    <div key={`${t.id}:${shellCwd}`}>
                      <AgentTerminal
                        sessionId={t.id}
                        rootPath={shellCwd}
                        lightChrome={prefersLightChrome}
                        visible={false}
                        startupShellLine={composeAgentStartupShellLine(
                          t.agentSession,
                          defaultAgentCli,
                        )}
                        onStartupShellLineConsumed={() =>
                          clearWorktreeBootstrapForTab(t.id)
                        }
                      />
                    </div>
                  );
                })}
              </div>
            )}
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

      </WorkspaceChromeErrorBoundary>

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
        onResumeExistingWorktree={openResumeExistingWorktrees}
        busy={agentDialogBusy}
        error={agentDialogError}
        defaultBranchLabel={
          defaultBranchInfo
            ? `${defaultBranchInfo.shortName} (${defaultBranchInfo.startPoint})`
            : defaultStartPoint
        }
        useCheckoutBranchName={defaultBranchInfo?.shortName ?? "main"}
      />

      <AgentResumeWorktreeDialog
        open={agentResumeDialogOpen}
        onOpenChange={(open) => {
          if (agentResumeLoading) return;
          setAgentResumeDialogOpen(open);
          if (!open) setAgentResumeError(null);
        }}
        onBack={backResumeDialogToPurpose}
        loading={agentResumeLoading}
        error={agentResumeError}
        worktrees={agentResumeRows}
        onPick={onPickResumedWorktree}
      />

      <PreferencesDialog
        open={preferencesOpen}
        onOpenChange={setPreferencesOpen}
        projectRoot={projectRoot}
        codeThemePick={codeThemePick}
        onThemeChange={setCodeThemePick}
        defaultAgentCli={defaultAgentCli}
        onDefaultAgentCliChange={setDefaultAgentCli}
        onSwitchProject={switchProject}
      />

      <FocusMapOverlay
        disabled={
          filePaletteOpen || preferencesOpen || agentResumeDialogOpen
        }
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
