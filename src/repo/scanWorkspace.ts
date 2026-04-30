import { join } from "@tauri-apps/api/path";
import { readDir, readTextFile, stat } from "@tauri-apps/plugin-fs";

const MAX_DEPTH = 40;
const MAX_PATHS = 25_000;

/** Directory names skipped when scanning (plus any name starting with `.`). */
const EXTRA_IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  "target",
  "__pycache__",
]);

function shouldSkipDirectory(name: string): boolean {
  if (name.startsWith(".")) return true;
  return EXTRA_IGNORED_DIRS.has(name);
}

function posixRel(segments: string[]): string {
  return segments.join("/");
}

/** Basenames only; pick best README at repository root (no `/` in path). */
export function pickReadmePath(treePaths: readonly string[]): string | null {
  const rootFiles = treePaths.filter(
    (p) => !p.endsWith("/") && !p.includes("/"),
  );
  const priority = (basenameLower: string): number | null => {
    if (basenameLower === "readme.md") return 0;
    if (basenameLower === "readme.markdown") return 1;
    if (basenameLower === "readme.rst") return 2;
    if (basenameLower === "readme.txt") return 3;
    if (basenameLower === "readme") return 4;
    return null;
  };
  let best: { rank: number; path: string } | null = null;
  for (const p of rootFiles) {
    const lc = p.toLowerCase();
    const r = priority(lc);
    if (r === null) continue;
    if (!best || r < best.rank) best = { rank: r, path: p };
  }
  return best?.path ?? null;
}

export interface ScanWorkspaceResult {
  /** Paths for `@pierre/trees` (dirs end with `/`). */
  paths: string[];
  /** Relative file paths only (no trailing slash). */
  filePaths: Set<string>;
  readmePath: string | null;
}

function addDirPath(out: Set<string>, segments: string[]): void {
  if (segments.length === 0) return;
  out.add(`${posixRel(segments)}/`);
}

export async function scanWorkspaceRoot(
  rootAbsolute: string,
): Promise<ScanWorkspaceResult> {
  const dirsWithChildren = new Set<string>();
  const files = new Set<string>();

  async function walk(
    absoluteDir: string,
    relSegments: string[],
    depth: number,
  ): Promise<void> {
    if (files.size + dirsWithChildren.size > MAX_PATHS) return;
    if (depth > MAX_DEPTH) return;

    let entries;
    try {
      entries = await readDir(absoluteDir);
    } catch {
      return;
    }

    const sorted = [...entries].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );

    for (const entry of sorted) {
      if (files.size + dirsWithChildren.size > MAX_PATHS) return;
      const name = entry.name;
      const nextAbs = await join(absoluteDir, name);
      const nextRel = [...relSegments, name];

      if (entry.isDirectory && !shouldSkipDirectory(name)) {
        addDirPath(dirsWithChildren, nextRel);
        await walk(nextAbs, nextRel, depth + 1);
      } else if (entry.isFile) {
        files.add(posixRel(nextRel));
      }
    }
  }

  await walk(rootAbsolute, [], 0);

  const orderedDirs = [...dirsWithChildren].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
  const orderedFiles = [...files].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );

  const paths = [...orderedDirs, ...orderedFiles];
  const readmePath = pickReadmePath(paths);

  return {
    paths,
    filePaths: files,
    readmePath,
  };
}

export const MAX_READ_BYTES = 512 * 1024;

/** Read utf-8 text or return a categorized error message. */
export async function loadTextFileAbsolute(
  absPath: string,
): Promise<{ ok: true; content: string } | { ok: false; message: string }> {
  let size: number | undefined;
  try {
    const meta = await stat(absPath);
    size = meta.size;
  } catch {
    return { ok: false, message: "Could not read file metadata." };
  }

  if (size > MAX_READ_BYTES) {
    return {
      ok: false,
      message: `File is too large to display (>${MAX_READ_BYTES / 1024} KB).`,
    };
  }

  try {
    const content = await readTextFile(absPath);
    return { ok: true, content };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg.includes("decode") ||
      msg.includes("UTF") ||
      msg.includes("utf")
    ) {
      return {
        ok: false,
        message: "File is not valid UTF-8 (binary or other encoding).",
      };
    }
    return { ok: false, message: msg || "Failed to read file." };
  }
}
