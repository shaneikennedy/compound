export type ViewModeOption = "browse" | "diff" | "agent";

export type BranchDiffFileEntry = {
  path: string;
  status: string;
  oldPath: string | null;
};

export type AgentWorktreeInfo = {
  path: string;
  branch: string;
  purpose: string;
  /**
   * `git worktree add … && cd …` (or PowerShell variant) pasted once into the Agent PTY.
   * Cleared after injection so rerenders do not replay the bootstrap or change the compose key.
   */
  bootstrapShellCommand: string | null;
  /** Picked from “Resume existing worktree”; shell starts in `path` (no bootstrap `cd`). */
  resumedFromWorktreePicker?: boolean;
};

/** Per-tab agent context: unset until user picks main repo or creates a worktree. */
export type AgentSession =
  | { kind: "unset" }
  | { kind: "main_repository" }
  | { kind: "worktree"; info: AgentWorktreeInfo };

export function agentSessionConfigured(s: AgentSession): boolean {
  return s.kind !== "unset";
}

export function agentShellRoot(projectRoot: string, s: AgentSession): string | null {
  if (s.kind === "unset") return null;
  if (s.kind === "main_repository") return projectRoot;
  const pendingBootstrap = s.info.bootstrapShellCommand?.trim();
  if (pendingBootstrap) return projectRoot;
  if (s.info.resumedFromWorktreePicker) return s.info.path;
  return projectRoot;
}

/** Browse / workspace scan root while Agent + worktree tab is pending `git worktree add` vs after the worktree exists. */
export function agentWorktreeBrowseRoot(
  projectRoot: string,
  info: AgentWorktreeInfo,
): string {
  const raw = info.bootstrapShellCommand;
  const pending = raw != null && raw.trim().length > 0;
  return pending ? projectRoot : info.path;
}

export type WorkspaceTabState = {
  id: string;
  /** Stable slot number for "Workspace n" before agent setup. */
  workspaceIndex: number;
  viewMode: ViewModeOption;
  sidebarOpen: boolean;
  filePaletteOpen: boolean;
  selectedRel: string | null;
  fileContents: string | null;
  fileError: string | null;
  fileLoading: boolean;
  diffEntries: BranchDiffFileEntry[];
  diffListLoading: boolean;
  diffListError: string | null;
  diffPatchText: string | null;
  diffPatchLoading: boolean;
  diffPatchError: string | null;
  diffLoadGeneration: number;
  diffStyle: "unified" | "split";
  agentSession: AgentSession;
};

/** Strip title: `Workspace n` until the agent session is chosen; then branch or default short name. */
export function workspaceTabDisplayName(
  tab: WorkspaceTabState,
  defaultBranchShortName: string,
): string {
  if (tab.agentSession.kind === "unset") {
    return `Workspace ${tab.workspaceIndex}`;
  }
  if (tab.agentSession.kind === "main_repository") {
    return defaultBranchShortName;
  }
  return tab.agentSession.info.branch;
}

export function createWorkspaceTab(id: string, workspaceIndex: number): WorkspaceTabState {
  return {
    id,
    workspaceIndex,
    viewMode: "browse",
    sidebarOpen: true,
    filePaletteOpen: false,
    selectedRel: null,
    fileContents: null,
    fileError: null,
    fileLoading: false,
    diffEntries: [],
    diffListLoading: false,
    diffListError: null,
    diffPatchText: null,
    diffPatchLoading: false,
    diffPatchError: null,
    diffLoadGeneration: 0,
    diffStyle: "unified",
    agentSession: { kind: "unset" },
  };
}
