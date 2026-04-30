import { memo } from "react";
import { File } from "@pierre/diffs/react";

export type ViewerThemeName = "pierre-dark" | "pierre-light";

export const CodeViewer = memo(function CodeViewer({
  relativePath,
  contents,
  theme,
}: {
  relativePath: string;
  contents: string;
  theme: ViewerThemeName;
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
