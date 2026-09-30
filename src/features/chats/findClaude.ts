import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { pickClaudePath } from "./handoff";

export interface FindDeps {
  platform: NodeJS.Platform;
  home: string;
  /** Runs a program with arguments (never through a shell) and returns stdout. */
  run(cmd: string, args: string[]): Promise<string>;
  exists(p: string): Promise<boolean>;
}

const runFile = (cmd: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile(cmd, args, { timeout: 5000, windowsHide: true }, (err, out) =>
      err ? reject(err) : resolve(String(out)),
    );
  });

const fileExists = async (p: string) => {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
};

export const defaultFindDeps = (): FindDeps => ({
  platform: process.platform,
  home: os.homedir(),
  run: runFile,
  exists: fileExists,
});

/** Locates the `claude` CLI: PATH first, then Claude Code's standard install folders. */
export async function findClaude(deps: FindDeps = defaultFindDeps()): Promise<string | null> {
  const win = deps.platform === "win32";
  const lib = win ? path.win32 : path.posix;
  try {
    const out = await deps.run(win ? "where" : "which", ["claude"]);
    const hit = pickClaudePath(out.split(/\r?\n/), deps.platform);
    if (hit) return hit;
  } catch {
    // Not on PATH — try the standard locations below.
  }
  const candidates = win
    ? [lib.join(deps.home, ".local", "bin", "claude.exe")]
    : [
        lib.join(deps.home, ".local", "bin", "claude"),
        lib.join(deps.home, ".claude", "local", "claude"),
      ];
  for (const c of candidates) if (await deps.exists(c)) return c;
  return null;
}
