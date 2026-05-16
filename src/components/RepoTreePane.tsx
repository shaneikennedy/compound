import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  prepareFileTreeInput,
  themeToTreeStyles,
  type GitStatusEntry,
} from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { ScanWorkspaceResult } from "../repo/scanWorkspace";
import type { PierreDiffThemeId } from "../repo/codeViewerThemes";
import pierreDarkJson from "@pierre/theme/themes/pierre-dark.json";
import pierreLightJson from "@pierre/theme/themes/pierre-light.json";

type VsCodeThemeJsonLike = {
  type: string;
  colors: Record<string, string>;
};

const TREE_THEME_JSON: Record<PierreDiffThemeId, VsCodeThemeJsonLike> = {
  "pierre-dark": pierreDarkJson as VsCodeThemeJsonLike,
  "pierre-light": pierreLightJson as VsCodeThemeJsonLike,
};

/*
 * Passed to `@pierre/trees` unsafeCSS — the library wraps this in `@layer unsafe { … }`
 * (`wrapUnsafeCSS`). Do NOT add another `@layer` here or rules lose the cascade duel.
 *
 * Overrides Pierre defaults: scrollbar-gutter stable leaves a perpetual gutter lane;
 * viewer uses implicit auto gutter + transparent thumb until scroll.
 */
const FILE_TREE_OVERLAY_SCROLLBARS_CSS = `
  [data-file-tree-virtualized-scroll] {
    scrollbar-gutter: auto;
    scrollbar-width: thin;
    scrollbar-color: transparent transparent;
  }
  [data-file-tree-virtualized-scroll]::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }
  [data-file-tree-virtualized-scroll]::-webkit-scrollbar-track {
    background: transparent;
  }
  [data-file-tree-virtualized-scroll]::-webkit-scrollbar-thumb {
    background-color: transparent !important;
    border: 3px solid transparent;
    background-clip: content-box;
    border-radius: 5px;
    transition: background-color 0.25s ease;
  }
  :host(.compound-tree-scrollbar-reveal) [data-file-tree-virtualized-scroll],
  :host-context(html[data-scrolling="true"]) [data-file-tree-virtualized-scroll] {
    scrollbar-color: var(--scrollbar-thumb-active) transparent;
  }
  :host(.compound-tree-scrollbar-reveal) [data-file-tree-virtualized-scroll]::-webkit-scrollbar-thumb,
  :host-context(html[data-scrolling="true"]) [data-file-tree-virtualized-scroll]::-webkit-scrollbar-thumb {
    background-color: var(--scrollbar-thumb-active) !important;
  }
  :host(.compound-tree-scrollbar-reveal) [data-file-tree-virtualized-scroll]::-webkit-scrollbar-thumb:hover,
  :host-context(html[data-scrolling="true"]) [data-file-tree-virtualized-scroll]::-webkit-scrollbar-thumb:hover {
    background-color: var(--scrollbar-thumb-hover) !important;
  }
`;

/** Stronger git lane colors in diff mode (green / yellow / red / orange). */
const DIFF_MODE_TREE_GIT_COLORS_CSS = `
  :host {
    --trees-git-added-color-override: oklch(58% 0.16 145);
    --trees-git-modified-color-override: oklch(78% 0.16 95);
    --trees-git-deleted-color-override: oklch(62% 0.2 25);
    --trees-git-renamed-color-override: oklch(70% 0.17 55);
  }
`;


function toTreeThemeInput(raw: VsCodeThemeJsonLike) {
  return {
    type: raw.type as "dark" | "light",
    colors: raw.colors,
    bg: raw.colors["editor.background"],
    fg: raw.colors["editor.foreground"],
  };
}

const TreeBody = memo(function TreeBody({
  scan,
  treeChromeTheme,
  onSelectFileRel,
  committedSelectedRel,
  diffMode,
  treeInstanceId,
}: {
  scan: ScanWorkspaceResult;
  treeChromeTheme: PierreDiffThemeId;
  onSelectFileRel: (relPath: string | null) => void;
  /** Tab state's file selection; avoids sync loops when `selectedPaths` is a new array each render. */
  committedSelectedRel: string | null;
  diffMode: {
    paths: string[];
    gitStatus: GitStatusEntry[];
    preferredSelectedRel: string | null;
  } | null;
  treeInstanceId: string;
}) {
  const preparedInput = useMemo(
    () =>
      prepareFileTreeInput(diffMode ? diffMode.paths : scan.paths, {
        flattenEmptyDirectories: true,
        sort: "default",
      }),
    [scan.paths, diffMode],
  );

  const treeUnsafeCss = diffMode
    ? `${FILE_TREE_OVERLAY_SCROLLBARS_CSS}\n${DIFF_MODE_TREE_GIT_COLORS_CSS}`
    : FILE_TREE_OVERLAY_SCROLLBARS_CSS;

  const treeHostStyle = useMemo(() => {
    return themeToTreeStyles(
      toTreeThemeInput(TREE_THEME_JSON[treeChromeTheme]),
    );
  }, [treeChromeTheme]);

  const readme = scan.readmePath;
  const treePaneRootRef = useRef<HTMLDivElement | null>(null);
  const onSelectRef = useRef(onSelectFileRel);
  onSelectRef.current = onSelectFileRel;

  const filePathsOnly = useMemo(() => {
    const p = diffMode?.paths ?? scan.paths;
    return p.filter((x) => !x.endsWith("/"));
  }, [diffMode, scan.paths]);

  const initialSelectedPaths = useMemo(() => {
    if (diffMode) {
      const pref = diffMode.preferredSelectedRel;
      if (pref && filePathsOnly.includes(pref)) return [pref];
      return filePathsOnly.length > 0 ? [filePathsOnly[0]!] : [];
    }
    return readme ? [readme] : [];
  }, [diffMode, readme, filePathsOnly]);

  const { model } = useFileTree({
    id: treeInstanceId,
    preparedInput,
    initialExpansion: diffMode ? "open" : "closed",
    initialSelectedPaths,
    gitStatus: diffMode?.gitStatus,
    search: true,
    density: "compact",
    icons: "standard",
    unsafeCSS: treeUnsafeCss,
    onSelectionChange(paths) {
      const raw = paths[0];
      const p = raw && !raw.endsWith("/") ? raw : null;
      onSelectRef.current(p);
    },
  });

  useLayoutEffect(() => {
    const selected = model.getSelectedPaths();
    if (committedSelectedRel === null) {
      if (selected.length === 0) return;
      for (const p of [...selected]) {
        model.getItem(p)?.deselect();
      }
      return;
    }
    const want = committedSelectedRel;
    if (!filePathsOnly.includes(want)) return;
    if (selected.length === 1 && selected[0] === want) return;

    const item = model.getItem(want);
    if (!item) return;
    for (const p of [...model.getSelectedPaths()]) {
      if (p !== want) model.getItem(p)?.deselect();
    }
    if (!item.isSelected()) item.select();
    item.focus();
  }, [committedSelectedRel, model, filePathsOnly]);

  useEffect(() => {
    const paneRootEl = treePaneRootRef.current;
    if (!(paneRootEl instanceof HTMLDivElement)) return;

    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let rafWatch = 0;
    let scrollElCleanup: (() => void) | undefined;

    const clearHideTimer = () => {
      if (hideTimer !== undefined) clearTimeout(hideTimer);
      hideTimer = undefined;
    };

    const pulseHost = (host: HTMLElement) => {
      host.classList.add("compound-tree-scrollbar-reveal");
      clearHideTimer();
      hideTimer = setTimeout(() => {
        hideTimer = undefined;
        host.classList.remove("compound-tree-scrollbar-reveal");
      }, 900);
    };

    function tryAttach(pane: HTMLDivElement): boolean {
      const host = pane.querySelector("file-tree-container");
      if (!(host instanceof HTMLElement)) return false;
      const sr = host.shadowRoot;
      if (!sr) return false;
      const scrollEl = sr.querySelector("[data-file-tree-virtualized-scroll]");
      if (!(scrollEl instanceof HTMLElement)) return false;

      if (scrollElCleanup) scrollElCleanup();
      scrollElCleanup = undefined;

      const reveal = () => pulseHost(host);
      scrollEl.addEventListener("scroll", reveal, { passive: true });
      scrollElCleanup = () => {
        scrollEl.removeEventListener("scroll", reveal);
      };
      return true;
    }

    let frames = 0;
    const watch = () => {
      if (tryAttach(paneRootEl)) return;
      frames += 1;
      if (frames < 72) rafWatch = requestAnimationFrame(watch);
    };
    rafWatch = requestAnimationFrame(watch);

    return () => {
      cancelAnimationFrame(rafWatch);
      scrollElCleanup?.();
      scrollElCleanup = undefined;
      clearHideTimer();
      paneRootEl
        .querySelector("file-tree-container")
        ?.classList.remove("compound-tree-scrollbar-reveal");
    };
  }, [preparedInput]);

  return (
    <div
      ref={treePaneRootRef}
      className="repo-tree-pane-root"
    >
      <FileTree
        className="repo-file-tree-host"
        model={model}
        style={{
          flex: 1,
          minHeight: 0,
          ...treeHostStyle,
        }}
      />
    </div>
  );
});

export const RepoTreePane = memo(function RepoTreePane(props: {
  scan: ScanWorkspaceResult | null;
  workspaceKey: string;
  treeChromeTheme: PierreDiffThemeId;
  onSelectFileRel: (relPath: string | null) => void;
  committedSelectedRel: string | null;
  diffMode?: {
    paths: string[];
    gitStatus: GitStatusEntry[];
    preferredSelectedRel: string | null;
    instanceKey: string;
  } | null;
}) {
  const { scan, onSelectFileRel, committedSelectedRel, workspaceKey, treeChromeTheme, diffMode } =
    props;
  if (!scan || scan.paths.length === 0) {
    return (
      <div className="pane-placeholder">
        <p>No browsable files in this folder.</p>
      </div>
    );
  }

  const mountKey = diffMode
    ? `${workspaceKey}|diff|${diffMode.instanceKey}`
    : workspaceKey;

  const treeInstanceId = diffMode
    ? `compound-diff-tree:${diffMode.instanceKey}`
    : "compound-repo-tree";

  return (
    <TreeBody
      key={mountKey}
      scan={scan}
      treeChromeTheme={treeChromeTheme}
      onSelectFileRel={onSelectFileRel}
      committedSelectedRel={committedSelectedRel}
      diffMode={diffMode ?? null}
      treeInstanceId={treeInstanceId}
    />
  );
});
