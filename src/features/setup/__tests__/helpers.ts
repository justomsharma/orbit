import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Writes `text` at `root/rel`, creating folders on the way. Returns the full path. */
export function put(root: string, rel: string, text: string): string {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  return p;
}

/** Links a folder (a junction on Windows, which needs no admin). False when not allowed. */
export function linkDir(target: string, link: string): boolean {
  try {
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link, "junction");
    return true;
  } catch {
    return false;
  }
}

/** A file just over the 256 KB read cap. */
export const OVERSIZED = `---\nname: big\n---\n${"x".repeat(256 * 1024 + 10)}`;
