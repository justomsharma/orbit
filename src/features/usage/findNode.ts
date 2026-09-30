import { execFile } from "node:child_process";

interface Deps {
  platform: NodeJS.Platform;
  /** Runs a program with arguments (never through a shell) and returns stdout. */
  run(cmd: string, args: string[]): Promise<string>;
}

const runFile = (cmd: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile(cmd, args, { timeout: 5000, windowsHide: true }, (err, out) =>
      err ? reject(err) : resolve(String(out)),
    );
  });

/** Locates Node.js, which runs Orbit's statusline tap for Claude Code. */
export async function findNode(
  deps: Deps = { platform: process.platform, run: runFile },
): Promise<string | null> {
  try {
    const hits = (await deps.run(deps.platform === "win32" ? "where" : "which", ["node"]))
      .split(/\r?\n/)
      .map((h) => h.trim())
      .filter(Boolean);
    if (deps.platform === "win32")
      return hits.find((h) => h.toLowerCase().endsWith(".exe")) ?? null;
    return hits[0] ?? null;
  } catch {
    return null;
  }
}
