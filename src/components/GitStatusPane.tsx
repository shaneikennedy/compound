import { useMemo } from "react";
import type { GitChangeArea, GitStatusFileEntry } from "../tabModel";
import { Button } from "./ui/button";

const AREA_LABELS: Record<GitChangeArea, string> = {
  staged: "Staged",
  unstaged: "Changes",
  untracked: "Untracked",
};

const STATUS_LABELS: Record<string, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
};

function statusBadge(entry: GitStatusFileEntry): string {
  return STATUS_LABELS[entry.status] ?? "M";
}

function areaActionLabel(area: GitChangeArea, bulk: boolean): string {
  if (area === "staged") return bulk ? "Unstage all" : "Unstage";
  return bulk ? "Stage all" : "Stage";
}

export function GitStatusPane({
  files,
  branch,
  selectedPath,
  selectedArea,
  actionBusy,
  onSelect,
  onStage,
  onUnstage,
  onStageAll,
  onUnstageAll,
}: {
  files: GitStatusFileEntry[];
  branch: string | null;
  selectedPath: string | null;
  selectedArea: GitChangeArea | null;
  actionBusy: boolean;
  onSelect: (path: string, area: GitChangeArea) => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onStageAll: (area: "unstaged" | "untracked") => void;
  onUnstageAll: () => void;
}) {
  const grouped = useMemo(() => {
    const sections: Record<GitChangeArea, GitStatusFileEntry[]> = {
      staged: [],
      unstaged: [],
      untracked: [],
    };
    for (const f of files) {
      sections[f.area].push(f);
    }
    return sections;
  }, [files]);

  const areas: GitChangeArea[] = ["staged", "unstaged", "untracked"];

  return (
    <div className="git-status-pane">
      <div className="git-status-pane-header">
        <span className="git-status-branch">
          {branch?.trim() ? branch : "(detached HEAD)"}
        </span>
      </div>
      <div className="git-status-sections">
        {areas.map((area) => {
          const sectionFiles = grouped[area];
          const bulkDisabled = actionBusy || sectionFiles.length === 0;
          return (
            <section key={area} className="git-status-section">
              <div className="git-status-section-head">
                <h3 className="git-status-section-title">
                  {AREA_LABELS[area]}
                  <span className="git-status-section-count">
                    {sectionFiles.length}
                  </span>
                </h3>
                {sectionFiles.length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="git-status-bulk-btn"
                    disabled={bulkDisabled}
                    onClick={() => {
                      if (area === "staged") onUnstageAll();
                      else onStageAll(area);
                    }}
                  >
                    {areaActionLabel(area, true)}
                  </Button>
                ) : null}
              </div>
              {sectionFiles.length === 0 ? (
                <p className="git-status-empty">No {AREA_LABELS[area].toLowerCase()} files.</p>
              ) : (
                <ul className="git-status-list">
                  {sectionFiles.map((entry) => {
                    const active =
                      selectedPath === entry.path && selectedArea === area;
                    const rowActionDisabled = actionBusy;
                    return (
                      <li key={`${area}:${entry.path}`}>
                        <div
                          className={`git-status-row${active ? " git-status-row--active" : ""}`}
                        >
                          <button
                            type="button"
                            className="git-status-row-main"
                            onClick={() => onSelect(entry.path, area)}
                          >
                            <span
                              className={`git-status-badge git-status-badge--${entry.status}`}
                              title={entry.status}
                            >
                              {statusBadge(entry)}
                            </span>
                            <span className="git-status-path" title={entry.path}>
                              {entry.oldPath
                                ? `${entry.oldPath} → ${entry.path}`
                                : entry.path}
                            </span>
                          </button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="git-status-row-action"
                            disabled={rowActionDisabled}
                            title={areaActionLabel(area, false)}
                            aria-label={`${areaActionLabel(area, false)} ${entry.path}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (area === "staged") onUnstage([entry.path]);
                              else onStage([entry.path]);
                            }}
                          >
                            {area === "staged" ? "−" : "+"}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
