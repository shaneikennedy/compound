/** Raycast-ish file filter: substring tokens + basename bonus + shallow paths first. */
const MAX_RESULTS = 80;

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

/**
 * Lower score sorts first. Returns undefined if any token fails substring match on full path (case insensitive).
 */
function rankPath(path: string, tokens: readonly string[]): number | undefined {
  const lower = path.toLowerCase();
  const base = basename(path).toLowerCase();

  let score = 0;
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i]?.trim().toLowerCase();
    if (!raw) continue;
    const idx = lower.indexOf(raw);
    if (idx < 0) return undefined;
    const depth = path.split("/").length - 1;

    score += idx * 2 + depth * 3;
    if (base.startsWith(raw)) score -= 40;
    else if (base.includes(raw)) score -= 18;

    score -= Math.min(raw.length / Math.max(base.length, 1), 1) * 22;
  }

  score += basename(path).length * 0.02;
  return score;
}

/**
 * Sorted list of repo-relative file paths matching the query.
 */
export function filterRepoFilePaths(
  filePaths: ReadonlySet<string>,
  query: string,
): string[] {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return [...filePaths]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .slice(0, MAX_RESULTS);
  }

  const ranked: { path: string; score: number }[] = [];
  for (const path of filePaths) {
    const score = rankPath(path, tokens);
    if (score !== undefined) ranked.push({ path, score });
  }
  ranked.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.path.localeCompare(b.path, undefined, { sensitivity: "base" });
  });
  return ranked.slice(0, MAX_RESULTS).map((r) => r.path);
}
