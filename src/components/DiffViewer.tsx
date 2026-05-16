import { memo, useMemo } from "react";
import { parsePatchFiles } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import type { CodeViewerThemeId } from "../repo/codeViewerThemes";

export const DiffViewer = memo(function DiffViewer({
  relativePath,
  patchText,
  theme,
  diffStyle,
}: {
  relativePath: string;
  patchText: string;
  theme: CodeViewerThemeId;
  diffStyle: "unified" | "split";
}) {
  const basename = relativePath.split("/").pop() ?? relativePath;

  const fileDiff = useMemo((): FileDiffMetadata | null => {
    const t = patchText.trim();
    if (!t) return null;
    if (/^Binary files .* differ\s*$/m.test(t) && !t.includes("diff --git")) {
      return null;
    }
    try {
      const patches = parsePatchFiles(patchText, undefined, false);
      const first = patches[0]?.files?.[0];
      if (!first) return null;
      const key = `${relativePath}:${patchText.length}:${theme}:${diffStyle}`;
      return {
        ...first,
        name: basename,
        cacheKey: key,
      };
    } catch {
      return null;
    }
  }, [patchText, relativePath, basename, theme, diffStyle]);

  return (
    <div
      className="code-viewer-scroll"
      data-focus-scroll-surface=""
      tabIndex={-1}
      role="region"
      aria-label={`Diff: ${basename}`}
    >
      {fileDiff ? (
        <FileDiff
          fileDiff={fileDiff}
          options={{
            theme,
            diffStyle,
          }}
        />
      ) : patchText.trim() ? (
        <pre className="diff-viewer-raw">{patchText}</pre>
      ) : (
        <div className="pane-placeholder">No diff text for this file.</div>
      )}
    </div>
  );
});
