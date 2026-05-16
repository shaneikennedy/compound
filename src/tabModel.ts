export type ViewModeOption = "browse" | "diff" | "agent";

export type GitBranchListPayload = {
  ok: boolean;
  error: string | null;
  current: string | null;
  branches: string[];
};

export type BranchDiffFileEntry = {
  path: string;
  status: string;
  oldPath: string | null;
};

export type AgentWorktreeInfo = {
  path: string;
  branch: string;
  purpose: string;
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
  return s.info.path;
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
  diffBaseRef: string;
  diffHeadRef: string;
  branchList: GitBranchListPayload | null;
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

export function createWorkspaceTab(
  id: string,
  workspaceIndex: number,
  defaultDiffBaseRef: string,
): WorkspaceTabState {
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
    diffBaseRef: defaultDiffBaseRef,
    diffHeadRef: "HEAD",
    branchList: null,
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
