import { join } from "@tauri-apps/api/path";

export async function repoPathToAbsolute(
  rootAbsolute: string,
  relativePosixPath: string,
): Promise<string> {
  let current = rootAbsolute;
  const segments = relativePosixPath.split("/").filter(Boolean);
  for (const segment of segments) {
    current = await join(current, segment);
  }
  return current;
}
