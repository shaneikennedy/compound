import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";

import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

const LAST_ROOT_STORAGE_KEY = "codar:last-repo-root";

export function ProjectOpenScreen({
  onProjectChosen,
}: {
  onProjectChosen: (rootPath: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneOpen, setCloneOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickLocalFolder = async () => {
    setError(null);
    try {
      const dir = await open({ directory: true, multiple: false });
      if (!dir) return;
      try {
        localStorage.setItem(LAST_ROOT_STORAGE_KEY, dir);
      } catch {
        /* ignore */
      }
      onProjectChosen(dir);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const cloneFromGithub = async () => {
    setError(null);
    setBusy(true);
    try {
      const path = await invoke<string>("git_clone_repo", {
        url: cloneUrl.trim(),
      });
      try {
        localStorage.setItem(LAST_ROOT_STORAGE_KEY, path);
      } catch {
        /* ignore */
      }
      setCloneUrl("");
      setCloneOpen(false);
      onProjectChosen(path);
    } catch (e) {
      setError(
        typeof e === "string" ? e : e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="project-open-screen">
      <div className="project-open-card">
        <h1 className="project-open-title">Codar</h1>
        <p className="project-open-lead">
          Open a git repository to begin. The project stays fixed for this
          window — use multiple tabs for parallel work.
        </p>
        <div className="project-open-actions">
          <Button
            type="button"
            variant="primary"
            size="default"
            onClick={pickLocalFolder}
            disabled={busy}
          >
            Open repository…
          </Button>
          <Popover open={cloneOpen} onOpenChange={setCloneOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                size="default"
                disabled={busy}
              >
                Clone from GitHub
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="center"
              className="w-[min(340px,calc(100vw-48px))]"
            >
              <form
                className="flex flex-col gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void cloneFromGithub();
                }}
              >
                <input
                  type="url"
                  placeholder="https://github.com/owner/repo"
                  value={cloneUrl}
                  onChange={(e) => setCloneUrl(e.currentTarget.value)}
                  autoComplete="off"
                  disabled={busy}
                  className="w-full rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-900 shadow-sm outline-none focus:ring-2 focus:ring-blue-500/35 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
                />
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  className="w-full"
                  disabled={busy || !cloneUrl.trim()}
                >
                  Clone
                </Button>
              </form>
            </PopoverContent>
          </Popover>
        </div>
        {error ? (
          <p className="project-open-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
