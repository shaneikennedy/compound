import { memo } from "react";
import { File } from "@pierre/diffs/react";
import type { CodeViewerThemeId } from "../repo/codeViewerThemes";

/** Valid @pierre/diffs `File` theme id (alias for external reference). */
export type ViewerThemeName = CodeViewerThemeId;

export const CodeViewer = memo(function CodeViewer({
  relativePath,
  contents,
  theme,
}: {
  relativePath: string;
  contents: string;
  theme: CodeViewerThemeId;
}) {
  const basename = relativePath.split("/").pop() ?? relativePath;
  return (
    <div
      className="code-viewer-scroll"
      data-focus-scroll-surface=""
      tabIndex={-1}
      role="region"
      aria-label={basename}
    >
      <File
        key={`${relativePath}:${contents.length}`}
        file={{
          name: basename,
          contents,
          cacheKey: `${relativePath}:${contents.length}`,
        }}
        options={{
          theme,
        }}
      />
    </div>
  );
});
