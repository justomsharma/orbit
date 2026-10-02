import { stat } from "node:fs/promises";
import { join } from "node:path";

/** Where a chat ran when that folder is a git worktree. */
export interface WorktreeInfo {
  /** "claude": made by Claude Code (`claude --worktree`); "user": made with `git worktree add`. */
  kind: "claude" | "user";
  name: string;
  /** The folder no longer exists. */
  removed: boolean;
}

/** `<repo>/.claude/worktrees/<name>`, either slash. */
const CLAUDE_WORKTREE = /[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)[\\/]?$/;

type Probe = (p: string) => Promise<"dir" | "file" | null>;

const probe: Probe = async (p) => {
  try {
    const st = await stat(p);
    return st.isDirectory() ? "dir" : st.isFile() ? "file" : null;
  } catch {
    return null;
  }
};

/**
 * The worktree a chat's folder is, if any. A user worktree has a `.git` *file*
 * (pointing at the main repository) where a normal checkout has a `.git` folder.
 */
export async function worktreeOf(cwd: string, look: Probe = probe): Promise<WorktreeInfo | null> {
  if (!cwd) return null;
  const claude = cwd.match(CLAUDE_WORKTREE);
  const exists = (await look(cwd)) === "dir";
  if (claude) return { kind: "claude", name: claude[1]!, removed: !exists };
  if (!exists) return null;
  if ((await look(join(cwd, ".git"))) !== "file") return null;
  const name =
    cwd
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? cwd;
  return { kind: "user", name, removed: false };
}
