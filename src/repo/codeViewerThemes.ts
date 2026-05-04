import type { BundledTheme } from "shiki";
import { bundledThemesInfo } from "shiki";

/**
 * Themes registered directly on @pierre/diffs shared highlighter
 * (`shared_highlighter.js` registers only these).
 */
export const PIERRE_DIFF_THEME_IDS = ["pierre-dark", "pierre-light"] as const;
export type PierreDiffThemeId = (typeof PIERRE_DIFF_THEME_IDS)[number];

/** Any single-string theme accepted by `@pierre/diffs`: Pierre + Shiki bundled. */
export type CodeViewerThemeId = PierreDiffThemeId | BundledTheme;

export type CodeViewerThemePick = "auto" | CodeViewerThemeId;

const KNOWN_THEME_SET = new Set<string>([
  ...PIERRE_DIFF_THEME_IDS,
  ...bundledThemesInfo.map((t) => t.id),
]);

export const CODE_VIEWER_THEME_OPTIONS: CodeViewerThemeId[] = [
  ...PIERRE_DIFF_THEME_IDS,
  ...bundledThemesInfo
    .slice()
    .sort((a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, {
        sensitivity: "base",
      }),
    )
    .map((t) => t.id as BundledTheme),
];

const DISPLAY = new Map<string, string>(
  bundledThemesInfo.map((t) => [t.id, t.displayName]),
);

export function codeViewerThemeLabel(id: CodeViewerThemeId): string {
  if (id === "pierre-dark") return "Pierre Dark";
  if (id === "pierre-light") return "Pierre Light";
  return DISPLAY.get(id) ?? id;
}

export function isKnownCodeViewerTheme(value: string): value is CodeViewerThemeId {
  return KNOWN_THEME_SET.has(value);
}
