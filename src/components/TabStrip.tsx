import type { WorkspaceTabState } from "../tabModel";

import { Button } from "./ui/button";

export function TabStrip({
  tabs,
  activeTabId,
  tabDisplayName,
  onSelect,
  onNewTab,
  onCloseTab,
}: {
  tabs: WorkspaceTabState[];
  activeTabId: string | null;
  tabDisplayName: (tab: WorkspaceTabState) => string;
  onSelect: (id: string) => void;
  onNewTab: () => void;
  onCloseTab: (id: string) => void;
}) {
  return (
    <div
      className="tab-strip"
      role="tablist"
      aria-label="Workspaces"
    >
      <div className="tab-strip-scroll">
        {tabs.map((t) => {
          const active = t.id === activeTabId;
          const title = tabDisplayName(t);
          return (
            <div
              key={t.id}
              className={`tab-strip-item${active ? " tab-strip-item--active" : ""}`}
              role="presentation"
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className="tab-strip-label"
                onClick={() => onSelect(t.id)}
              >
                {title}
              </button>
              {tabs.length > 1 ? (
                <button
                  type="button"
                  className="tab-strip-close"
                  aria-label={`Close ${title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(t.id);
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="tab-strip-new shrink-0"
        onClick={onNewTab}
      >
        + Tab
      </Button>
    </div>
  );
}
