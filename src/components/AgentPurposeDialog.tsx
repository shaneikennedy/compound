import { useEffect, useState } from "react";

import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";

export function AgentPurposeDialog({
  open,
  onOpenChange,
  onConfirm,
  onUseThisRepository,
  busy,
  error,
  defaultBranchLabel,
  useCheckoutBranchName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (purpose: string) => void;
  onUseThisRepository: () => void;
  busy: boolean;
  error: string | null;
  defaultBranchLabel: string;
  /** Short branch name for "Use …" (e.g. `main`) — stay on this checkout, no worktree. */
  useCheckoutBranchName: string;
}) {
  const [purpose, setPurpose] = useState("");

  useEffect(() => {
    if (open) setPurpose("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="agent-purpose-desc"
        onPointerDownOutside={(e) => {
          if (busy) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <DialogTitle>Agent workspace</DialogTitle>
        <DialogDescription id="agent-purpose-desc">
          Create a new git worktree and branch from{" "}
          <span className="font-mono text-zinc-700 dark:text-zinc-300">
            {defaultBranchLabel}
          </span>
          , or use the terminal in this folder (your current branch, no new
          worktree).
        </DialogDescription>
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm(purpose.trim());
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-800 dark:text-zinc-200">
              What are you working on?
            </span>
            <textarea
              value={purpose}
              onChange={(e) => setPurpose(e.currentTarget.value)}
              rows={3}
              disabled={busy}
              placeholder="e.g. Fix login redirect on OAuth callback"
              className="resize-y rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-blue-500/35 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
              autoFocus
            />
          </label>
          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  onUseThisRepository();
                }}
              >
                Use {useCheckoutBranchName}
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={busy || !purpose.trim()}
              >
                {busy ? "Creating worktree…" : "Create worktree"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
