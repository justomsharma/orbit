import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

/**
 * The branch a folder's checkout is on, read from git's own HEAD file (no git
 * command). Null when it isn't a git checkout or HEAD is detached.
 */
export async function currentBranch(cwd: string): Promise<string | null> {
  try {
    let gitDir = join(cwd, ".git");
    const st = await stat(gitDir);
    if (st.isFile()) {
      const m = (await readFile(gitDir, "utf8")).match(/^gitdir:\s*(.+)$/m);
      if (!m) return null;
      const dir = m[1]!.trim();
      gitDir = isAbsolute(dir) ? dir : resolve(cwd, dir);
    }
    const head = (await readFile(join(gitDir, "HEAD"), "utf8")).trim();
    const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    return ref ? ref[1]! : null;
  } catch {
    return null;
  }
}

/** A branch name git would accept (no option-looking or odd names reach git). */
export function safeBranch(name: string): boolean {
  return (
    /^[\w./-]{1,200}$/.test(name) &&
    !name.startsWith("-") &&
    !name.startsWith("/") &&
    !name.endsWith("/") &&
    !name.endsWith(".lock") &&
    !name.includes("..") &&
    !name.includes("//")
  );
}
