import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";

export type ListedWorktreeRow = {
  path: string;
  branchShort: string | null;
  detached: boolean;
  isCurrentWorkspace: boolean;
};

export function AgentResumeWorktreeDialog({
  open,
  onOpenChange,
  onBack,
  loading,
  error,
  worktrees,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBack: () => void;
  loading: boolean;
  error: string | null;
  worktrees: ListedWorktreeRow[];
  onPick: (row: ListedWorktreeRow) => void;
}) {
  const pickable = worktrees.filter((w) => !w.isCurrentWorkspace);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="agent-resume-wt-desc"
        className="max-h-[min(560px,85vh)] overflow-hidden flex flex-col"
        onPointerDownOutside={(e) => {
          if (loading) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (loading) e.preventDefault();
        }}
      >
        <DialogTitle>Resume existing worktree</DialogTitle>
        <DialogDescription id="agent-resume-wt-desc">
          Choose a linked git worktree for this repository. The Agent terminal opens
          in that folder.
        </DialogDescription>

        <div className="mt-3 min-h-0 flex flex-1 flex-col gap-2">
          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            {loading ? (
              <div className="pane-placeholder px-3 py-6 text-sm text-zinc-500">
                Loading worktrees…
              </div>
            ) : worktrees.length === 0 ? (
              <div className="pane-placeholder px-3 py-6 text-sm text-zinc-500">
                No linked worktrees found.
              </div>
            ) : (
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {worktrees.map((w) => {
                  const disabled = w.isCurrentWorkspace || loading;
                  const label = w.detached
                    ? "(detached HEAD)"
                    : (w.branchShort ?? "—");
                  return (
                    <li key={w.path}>
                      <button
                        type="button"
                        disabled={disabled}
                        title={
                          disabled && w.isCurrentWorkspace
                            ? "This checkout is already the workspace folder."
                            : undefined
                        }
                        className={`flex w-full flex-col gap-0.5 px-3 py-2.5 text-left text-sm transition-colors ${
                          disabled
                            ? "cursor-not-allowed opacity-50"
                            : "hover:bg-zinc-100 dark:hover:bg-zinc-900"
                        }`}
                        onClick={() => {
                          if (!disabled) onPick(w);
                        }}
                      >
                        <span className="font-medium text-zinc-900 dark:text-zinc-50">
                          {label}
                          {w.isCurrentWorkspace ? (
                            <span className="ml-2 font-normal text-zinc-500">
                              · this workspace
                            </span>
                          ) : null}
                        </span>
                        <span className="break-all font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                          {w.path}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {!loading && pickable.length === 0 && worktrees.length > 0 ? (
            <p className="text-xs text-zinc-500">
              Only this folder is checked out. Create a worktree first, then you can resume
              it here.
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={loading}
            onClick={onBack}
          >
            Back
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
