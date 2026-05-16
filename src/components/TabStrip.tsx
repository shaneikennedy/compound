import type { WorkspaceTabState } from "../tabModel";

import { Button } from "./ui/button";

export function TabStrip({
  tabs,
  activeTabId,
  onSelect,
  onNewTab,
  onCloseTab,
}: {
  tabs: WorkspaceTabState[];
  activeTabId: string | null;
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
                {t.label}
              </button>
              {tabs.length > 1 ? (
                <button
                  type="button"
                  className="tab-strip-close"
                  aria-label={`Close ${t.label}`}
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
