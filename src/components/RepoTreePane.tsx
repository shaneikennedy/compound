import { memo, useEffect, useMemo } from "react";
import pierreDarkJson from "@pierre/theme/themes/pierre-dark.json";
import pierreLightJson from "@pierre/theme/themes/pierre-light.json";
import {
  prepareFileTreeInput,
  themeToTreeStyles,
} from "@pierre/trees";
import { FileTree, useFileTree, useFileTreeSelection } from "@pierre/trees/react";
import type { ViewerThemeName } from "./CodeViewer";
import type { ScanWorkspaceResult } from "../repo/scanWorkspace";

/** Scrollbars hidden until scroll; `:host-context` ties tree shadow DOM to `html[data-scrolling]`. */
const FILE_TREE_OVERLAY_SCROLLBARS_CSS = `
@layer unsafe {
  [data-file-tree-virtualized-scroll] {
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
    background-color: transparent;
    border-radius: 5px;
    border: 3px solid transparent;
    background-clip: content-box;
    transition: background-color 0.25s ease;
  }
  :host-context(html[data-scrolling="true"]) [data-file-tree-virtualized-scroll] {
    scrollbar-color: var(--scrollbar-thumb-active) transparent;
  }
  :host-context(html[data-scrolling="true"]) [data-file-tree-virtualized-scroll]::-webkit-scrollbar-thumb {
    background-color: var(--scrollbar-thumb-active);
  }
  :host-context(html[data-scrolling="true"]) [data-file-tree-virtualized-scroll]::-webkit-scrollbar-thumb:hover {
    background-color: var(--scrollbar-thumb-hover);
  }
}
`;

type VsCodeThemeJson = {
  type: string;
  colors: Record<string, string>;
};

function toTreeThemeInput(raw: VsCodeThemeJson) {
  return {
    type: raw.type as "dark" | "light",
    colors: raw.colors,
    bg: raw.colors["editor.background"],
    fg: raw.colors["editor.foreground"],
  };
}

const TreeBody = memo(function TreeBody({
  scan,
  viewerTheme,
  onSelectFileRel,
}: {
  scan: ScanWorkspaceResult;
  viewerTheme: ViewerThemeName;
  onSelectFileRel: (relPath: string | null) => void;
}) {
  const preparedInput = useMemo(
    () =>
      prepareFileTreeInput(scan.paths, {
        flattenEmptyDirectories: true,
        sort: "default",
      }),
    [scan.paths],
  );

  const treeHostStyle = useMemo(() => {
    const raw =
      viewerTheme === "pierre-light" ? pierreLightJson : pierreDarkJson;
    return themeToTreeStyles(toTreeThemeInput(raw as VsCodeThemeJson));
  }, [viewerTheme]);

  const readme = scan.readmePath;

  const { model } = useFileTree({
    id: "codar-repo-tree",
    preparedInput,
    initialExpansion: "closed",
    initialSelectedPaths: readme ? [readme] : [],
    search: true,
    density: "compact",
    icons: "standard",
    unsafeCSS: FILE_TREE_OVERLAY_SCROLLBARS_CSS,
  });

  const selectedPaths = useFileTreeSelection(model);

  useEffect(() => {
    const first = selectedPaths[0];
    if (!first || first.endsWith("/")) return;
    onSelectFileRel(first);
  }, [selectedPaths, onSelectFileRel]);

  return (
    <FileTree
      className="repo-file-tree-host"
      model={model}
      style={{
        flex: 1,
        minHeight: 0,
        ...treeHostStyle,
      }}
    />
  );
});

export const RepoTreePane = memo(function RepoTreePane(props: {
  scan: ScanWorkspaceResult | null;
  workspaceKey: string;
  viewerTheme: ViewerThemeName;
  onSelectFileRel: (relPath: string | null) => void;
}) {
  const { scan, onSelectFileRel, workspaceKey, viewerTheme } = props;
  if (!scan || scan.paths.length === 0) {
    return (
      <div className="pane-placeholder">
        <p>No browsable files in this folder.</p>
      </div>
    );
  }
  return (
    <TreeBody
      key={workspaceKey}
      scan={scan}
      viewerTheme={viewerTheme}
      onSelectFileRel={onSelectFileRel}
    />
  );
});
