import { dirname, isAbsolute, join, resolve } from "node:path";
import { readTextSafe, statSafe } from "./fsSafe";

/**
 * The main checkout of the git repository holding `dir`, or null outside one.
 * A linked worktree (its `.git` is a file) resolves to the main checkout, the
 * way Claude Code shares one auto-memory folder across a repo's worktrees.
 * Read-only; never runs git.
 */
export async function gitRoot(dir: string): Promise<string | null> {
  let d = resolve(dir);
  for (let i = 0; i < 64; i++) {
    const dotGit = join(d, ".git");
    const st = await statSafe(dotGit);
    if (st?.isDirectory()) return d;
    if (st?.isFile()) return (await worktreeMain(dotGit)) ?? d;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
  return null;
}

/** `.git` file → `gitdir: …/.git/worktrees/<name>` → its `commondir` → the main checkout. */
async function worktreeMain(dotGitFile: string): Promise<string | null> {
  const text = await readTextSafe(dotGitFile, 64 * 1024);
  const m = text?.match(/^gitdir:\s*(.+?)\s*$/m);
  if (!m?.[1]) return null;
  const gitdir = isAbsolute(m[1]) ? m[1] : resolve(dirname(dotGitFile), m[1]);
  const common = (await readTextSafe(join(gitdir, "commondir"), 64 * 1024))?.trim();
  // No commondir: a submodule, whose own folder is the repository.
  if (!common) return null;
  return dirname(isAbsolute(common) ? common : resolve(gitdir, common));
}
