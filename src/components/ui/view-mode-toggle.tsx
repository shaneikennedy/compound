import { cn } from "../../lib/utils";

export type ViewModeOption = "browse" | "diff" | "agent";

export function ViewModeToggle({
  value,
  onChange,
  disabled,
}: {
  value: ViewModeOption;
  onChange: (v: ViewModeOption) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="inline-flex h-8 max-w-full min-w-0 items-center rounded-md border border-zinc-200 bg-zinc-100/60 p-0.5 dark:border-zinc-800 dark:bg-zinc-900/60"
      role="group"
      aria-label="View mode"
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("browse")}
        className={cn(
          "h-7 shrink-0 rounded px-2 text-xs font-medium transition-colors",
          value === "browse"
            ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-100 dark:text-zinc-900"
            : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-500 dark:hover:text-zinc-200",
        )}
      >
        Browse
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("diff")}
        className={cn(
          "h-7 shrink-0 rounded px-2 text-xs font-medium transition-colors",
          value === "diff"
            ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-100 dark:text-zinc-900"
            : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-500 dark:hover:text-zinc-200",
        )}
      >
        Diff
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("agent")}
        className={cn(
          "h-7 shrink-0 rounded px-2 text-xs font-medium transition-colors",
          value === "agent"
            ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-100 dark:text-zinc-900"
            : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-500 dark:hover:text-zinc-200",
        )}
      >
        Agent
      </button>
    </div>
  );
}
