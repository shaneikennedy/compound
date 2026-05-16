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

export type WorkspaceTabState = {
  id: string;
  label: string;
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
  agentWorktree: AgentWorktreeInfo | null;
};

export function createWorkspaceTab(
  id: string,
  label: string,
  defaultDiffBaseRef: string,
): WorkspaceTabState {
  return {
    id,
    label,
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
    agentWorktree: null,
  };
}
