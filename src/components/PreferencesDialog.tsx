import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import type { CodeViewerThemePick } from "../repo/codeViewerThemes";
import {
  CODE_VIEWER_THEME_OPTIONS,
  codeViewerThemeLabel,
  isKnownCodeViewerTheme,
} from "../repo/codeViewerThemes";
import {
  DEFAULT_AGENT_CLI_OPTIONS,
  type DefaultAgentCliId,
  isDefaultAgentCliId,
} from "../repo/defaultAgentPreference";

export function PreferencesDialog({
  open,
  onOpenChange,
  projectRoot,
  codeThemePick,
  onThemeChange,
  defaultAgentCli,
  onDefaultAgentCliChange,
  onSwitchProject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectRoot: string | null;
  codeThemePick: CodeViewerThemePick;
  onThemeChange: (v: CodeViewerThemePick) => void;
  defaultAgentCli: DefaultAgentCliId;
  onDefaultAgentCliChange: (v: DefaultAgentCliId) => void;
  onSwitchProject: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="prefs-desc">
        <DialogTitle>Preferences</DialogTitle>
        <DialogDescription id="prefs-desc">
          Syntax theme and agent terminal defaults; switch repository when a
          project is open. Press ⌘, or Ctrl+, to toggle this dialog.
        </DialogDescription>

        <div className="mt-4 flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              Code &amp; diff syntax theme
            </span>
            <Select
              value={codeThemePick}
              onValueChange={(v) => {
                onThemeChange(
                  v === "auto" || isKnownCodeViewerTheme(v) ? v : "auto",
                );
              }}
            >
              <SelectTrigger
                id="prefs-code-theme-select"
                className="h-9 w-full max-w-none text-sm"
                aria-label="Syntax highlighting theme"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[600]">
                <SelectItem value="auto">Auto theme</SelectItem>
                {CODE_VIEWER_THEME_OPTIONS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {codeViewerThemeLabel(id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Shiki themes for the code and diff viewers.
            </p>
          </div>

          <div className="flex flex-col gap-1.5 border-t border-zinc-200 pt-5 dark:border-zinc-800">
            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              Default CLI in Agent tab
            </span>
            <Select
              value={defaultAgentCli}
              onValueChange={(v) => {
                onDefaultAgentCliChange(
                  isDefaultAgentCliId(v) ? v : "none",
                );
              }}
            >
              <SelectTrigger
                id="prefs-default-agent-cli-select"
                className="h-9 w-full max-w-none text-sm"
                aria-label="Default agent CLI terminal command"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[600]">
                {DEFAULT_AGENT_CLI_OPTIONS.map((opt) => (
                  <SelectItem key={opt.id} value={opt.id}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {
                DEFAULT_AGENT_CLI_OPTIONS.find(
                  (o) => o.id === defaultAgentCli,
                )?.description
              }
            </p>
          </div>

          {projectRoot ? (
            <div className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                Repository
              </span>
              <p
                className="break-all font-mono text-xs text-zinc-600 dark:text-zinc-400"
                title={projectRoot}
              >
                {projectRoot}
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="self-start"
                onClick={() => {
                  onSwitchProject();
                  onOpenChange(false);
                }}
              >
                Switch project…
              </Button>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Returns to the open / clone screen. Tabs and sessions in this
                window are cleared.
              </p>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
