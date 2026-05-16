/** Build `paths` for `@pierre/trees` (dirs with trailing `/`, then files). */
export function treePathsForTouchedFiles(touched: Iterable<string>): string[] {
  const dirs = new Set<string>();
  const files = new Set<string>();
  for (const rel of touched) {
    if (!rel || rel.endsWith("/")) continue;
    files.add(rel);
    const parts = rel.split("/");
    for (let i = 0; i < parts.length - 1; i++) {
      dirs.add(`${parts.slice(0, i + 1).join("/")}/`);
    }
  }
  const orderedDirs = [...dirs].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
  const orderedFiles = [...files].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
  return [...orderedDirs, ...orderedFiles];
}
