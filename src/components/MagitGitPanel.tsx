import { invoke } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

export type MagitSnapshot = {
  ok: boolean;
  error: string | null;
  branchLabel: string | null;
  headLine: string | null;
  recentCommits: { hash: string; subject: string }[];
  staged: { status: string; path: string }[];
  unstaged: { status: string; path: string }[];
  untracked: string[];
};

function repoBasename(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts.length > 0 ? (parts[parts.length - 1] ?? path) : path;
}

function MagitSection({
  title,
  shortcut,
  children,
  empty,
}: {
  title: string;
  shortcut?: string;
  children: React.ReactNode;
  empty: boolean;
}) {
  return (
    <section className="magit-section magit-section-static">
      <div className="magit-section-heading">
        <span className="magit-section-lead">▶</span>
        <h3 className="magit-section-title">{title}</h3>
        {shortcut ? (
          <kbd className="magit-section-kbd">{shortcut}</kbd>
        ) : null}
      </div>
      {empty ? (
        <div className="magit-section-empty">nothing to show</div>
      ) : (
        <ul className="magit-section-list">{children}</ul>
      )}
    </section>
  );
}

function MagitFoldableSection({
  title,
  shortcut,
  count,
  expanded,
  onToggle,
  empty,
  toggleKey,
  children,
}: {
  title: string;
  shortcut?: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  empty: boolean;
  toggleKey: string;
  children: React.ReactNode;
}) {
  const idBody = `magit-fold-${toggleKey}`;
  return (
    <section className="magit-section magit-section-foldable">
      <button
        type="button"
        id={`magit-heading-${toggleKey}`}
        className="magit-section-heading magit-section-toggle"
        aria-expanded={expanded}
        aria-controls={idBody}
        onClick={onToggle}
      >
        <span className="magit-section-lead magit-fold-chevron" aria-hidden>
          {expanded ? "▼" : "▶"}
        </span>
        <span className="magit-section-title">{title}</span>
        {count > 0 ? (
          <span className="magit-fold-count" aria-hidden>
            ({count})
          </span>
        ) : null}
        {shortcut ? (
          <kbd className="magit-section-kbd">{shortcut}</kbd>
        ) : null}
      </button>
      <div
        id={idBody}
        role="region"
        aria-labelledby={`magit-heading-${toggleKey}`}
        hidden={!expanded}
        className="magit-fold-body"
      >
        {empty ? (
          <div className="magit-section-empty">nothing to show</div>
        ) : (
          <ul className="magit-section-list">{children}</ul>
        )}
      </div>
    </section>
  );
}

export function MagitGitPanel({
  open,
  onClose,
  rootPath,
}: {
  open: boolean;
  onClose: () => void;
  rootPath: string | null;
}) {
  const [snap, setSnap] = useState<MagitSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [commitsExpanded, setCommitsExpanded] = useState(false);
  const [untrackedExpanded, setUntrackedExpanded] = useState(false);

  const refresh = useCallback(async () => {
    if (!rootPath) return;
    setLoading(true);
    setFetchError(null);
    try {
      const data = await invoke<MagitSnapshot>("git_magit_snapshot", {
        rootPath,
      });
      setSnap(data);
    } catch (e) {
      setSnap(null);
      setFetchError(
        e instanceof Error ? e.message : "Could not load git status.",
      );
    } finally {
      setLoading(false);
    }
  }, [rootPath]);

  useEffect(() => {
    if (!open) {
      setSnap(null);
      setFetchError(null);
      return;
    }
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) {
      setCommitsExpanded(false);
      setUntrackedExpanded(false);
    }
  }, [open]);

  const sheetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => {
      sheetRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const typing = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
        return true;
      if (t.isContentEditable) return true;
      if (t.getAttribute("role") === "textbox") return true;
      if (t.closest(".file-palette-backdrop")) return true;
      return false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (typing(e.target)) return;

      if (e.key === "Escape" || e.key === "q" || e.key === "Q") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "g") {
        e.preventDefault();
        void refresh();
        return;
      }
      if (e.key === "l") {
        e.preventDefault();
        setCommitsExpanded((v) => !v);
        return;
      }
      if (e.key === "z") {
        e.preventDefault();
        setUntrackedExpanded((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, refresh]);

  if (!open) return null;

  const repoLabel = rootPath ? repoBasename(rootPath) : "—";

  const onBackdropKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return createPortal(
    <div
      className="magit-backdrop"
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
      onKeyDown={onBackdropKeyDown}
      tabIndex={-1}
    >
      <div
        ref={sheetRef}
        className="magit-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="magit-dialog-title"
        aria-busy={loading || undefined}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="magit-header magit-ban">
          <div className="magit-banner-bar" aria-hidden />
          <div className="magit-header-copy">
            <h2 id="magit-dialog-title" className="magit-title">
              Magit:&nbsp;
              <span className="magit-title-repo">{repoLabel}</span>
            </h2>
            {loading ? (
              <span className="magit-banner-meta magit-busy-msg">
                refreshing…
              </span>
            ) : snap?.ok ? (
              <span className="magit-banner-meta">
                {(snap.branchLabel ?? "HEAD").startsWith("(HEAD detached")
                  ? snap.branchLabel
                  : `${snap.branchLabel ?? "HEAD"}`}
                {snap.headLine ? (
                  <span className="magit-head-dim"> · {snap.headLine}</span>
                ) : null}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="magit-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        {!rootPath ? (
          <div className="magit-pane magit-msg">
            Open a workspace folder first.
          </div>
        ) : fetchError ? (
          <div className="magit-pane magit-msg magit-msg-err">{fetchError}</div>
        ) : snap && !snap.ok && snap.error ? (
          <div className="magit-pane magit-msg magit-msg-err">{snap.error}</div>
        ) : snap ? (
          <div className="magit-pane magit-scroll">
            <MagitFoldableSection
              title="Recent commits"
              shortcut="l"
              toggleKey="commits"
              count={snap.recentCommits.length}
              expanded={commitsExpanded}
              onToggle={() => setCommitsExpanded((v) => !v)}
              empty={snap.recentCommits.length === 0}
            >
              {snap.recentCommits.map((c) => (
                <li key={c.hash + c.subject} className="magit-row magit-commit">
                  <span className="magit-hash">{c.hash}</span>
                  <span className="magit-subject">{c.subject}</span>
                </li>
              ))}
            </MagitFoldableSection>

            <MagitSection
              title="Unstaged changes"
              shortcut="u"
              empty={snap.unstaged.length === 0}
            >
              {snap.unstaged.map((e, i) => (
                <li key={`${e.path}:${e.status}:${i}`} className="magit-row">
                  <span className={`magit-st magit-st-${statusClass(e.status)}`}>
                    {e.status.padEnd(2, " ").slice(0, 2)}
                  </span>
                  <span className="magit-path">{e.path}</span>
                </li>
              ))}
            </MagitSection>

            <MagitSection
              title="Staged changes"
              shortcut="s"
              empty={snap.staged.length === 0}
            >
              {snap.staged.map((e, i) => (
                <li key={`s-${e.path}:${e.status}:${i}`} className="magit-row">
                  <span className={`magit-st magit-st-${statusClass(e.status)}`}>
                    {e.status.padEnd(2, " ").slice(0, 2)}
                  </span>
                  <span className="magit-path">{e.path}</span>
                </li>
              ))}
            </MagitSection>

            <MagitFoldableSection
              title="Untracked files"
              shortcut="z"
              toggleKey="untracked"
              count={snap.untracked.length}
              expanded={untrackedExpanded}
              onToggle={() => setUntrackedExpanded((v) => !v)}
              empty={snap.untracked.length === 0}
            >
              {snap.untracked.map((p) => (
                <li key={p} className="magit-row">
                  <span className="magit-st magit-st-untracked">??</span>
                  <span className="magit-path">{p}</span>
                </li>
              ))}
            </MagitFoldableSection>

            <footer className="magit-popup-hint magit-mini">
              <span>
                <kbd>q</kbd> quit
              </span>
              <span>
                <kbd>Esc</kbd> quit
              </span>
              <span>
                <kbd>g</kbd> refresh
              </span>
              <span>
                <kbd>l</kbd> / <kbd>z</kbd> fold commits / untracked
              </span>
              <span className="magit-mini-muted">
                Interactive stage/commit UI can follow (“Magit-lite” viewer).
              </span>
            </footer>
          </div>
        ) : (
          <div className="magit-pane magit-msg">Loading…</div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function statusClass(s: string): string {
  const t = s.trim().replace(/\s+/g, "");
  const first = t[0] ?? "";
  if (!first || t === "?") return "misc";
  if (first === "A" || t === "A") return "added";
  if (first === "M" || t === "M") return "modified";
  if (first === "D" || t === "D") return "deleted";
  if (first === "R") return "renamed";
  if (first === "C") return "copied";
  if (first === "U") return "unmerged";
  if (first === "T") return "typechange";
  return "misc";
}