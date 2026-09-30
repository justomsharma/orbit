import * as os from "node:os";
import * as path from "node:path";

type Env = Record<string, string | undefined>;

function expandTilde(p: string, home: string): string {
  if (p === "~") return home;
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(home, p.slice(2));
  return p;
}

function configDir(env: Env, home: string): string | null {
  const v = env.CLAUDE_CONFIG_DIR?.trim();
  return v ? path.normalize(expandTilde(v, home)) : null;
}

/** Claude Code's data folder: `$CLAUDE_CONFIG_DIR` or `~/.claude`. */
export function claudeHome(env: Env = process.env, home: string = os.homedir()): string {
  return configDir(env, home) ?? path.join(home, ".claude");
}

/** `~/.claude.json` — or `.claude.json` inside `$CLAUDE_CONFIG_DIR` when set. */
export function claudeJsonPath(env: Env = process.env, home: string = os.homedir()): string {
  const dir = configDir(env, home);
  return dir ? path.join(dir, ".claude.json") : path.join(home, ".claude.json");
}

export const projectsDir = (h: string) => path.join(h, "projects");
export const sessionsDir = (h: string) => path.join(h, "sessions");
export const historyFile = (h: string) => path.join(h, "history.jsonl");
export const fileHistoryDir = (h: string) => path.join(h, "file-history");
export const settingsFile = (h: string) => path.join(h, "settings.json");

/**
 * Canonical form of a path for comparing and grouping. On Windows the file
 * system is case-insensitive and accepts both slash styles, so both are folded.
 */
export function normPath(p: string, platform: NodeJS.Platform = process.platform): string {
  const win = platform === "win32";
  const lib = win ? path.win32 : path.posix;
  let n = lib.normalize(p);
  const root = lib.parse(n).root;
  while (n.length > root.length && (n.endsWith("/") || n.endsWith("\\"))) n = n.slice(0, -1);
  return win ? n.toLowerCase() : n;
}

export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform) {
  return normPath(a, platform) === normPath(b, platform);
}

/**
 * How Claude Code keys a folder in `~/.claude.json` `projects`: on Windows
 * `C:/Users/x/app` (forward slashes, capital drive letter), elsewhere the path itself.
 */
export function claudeProjectKey(folder: string, platform: NodeJS.Platform = process.platform) {
  const win = platform === "win32";
  const lib = win ? path.win32 : path.posix;
  let n = lib.normalize(folder);
  const root = lib.parse(n).root;
  while (n.length > root.length && (n.endsWith("/") || n.endsWith("\\"))) n = n.slice(0, -1);
  if (!win) return n;
  return n.replace(/\\/g, "/").replace(/^([a-z]):/, (_, d: string) => `${d.toUpperCase()}:`);
}

/**
 * The `projects` key for a folder: Claude's own spelling when present, else any
 * spelling of the same folder, else null. Reader and editor both use this, so
 * they always act on the same entry.
 */
export function findProjectKey(
  keys: string[],
  folder: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const same = keys.filter((k) => samePath(k, folder, platform));
  return same.find((k) => k === claudeProjectKey(k, platform)) ?? same[0] ?? null;
}

/** Folder name shown to people, e.g. `C:\work\shop` → `shop`. */
export function projectName(cwd: string): string {
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) return cwd.trim() ? cwd : "Unknown project";
  const last = parts[parts.length - 1]!;
  // A bare drive like "C:" is not a useful name on its own.
  return /^[a-zA-Z]:$/.test(last) && parts.length === 1 ? cwd : last;
}

/** Is `cwd` the folder itself or somewhere inside it? */
export function isInside(
  folder: string,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
) {
  if (!cwd) return false;
  const f = normPath(folder, platform);
  const c = normPath(cwd, platform);
  if (c === f) return true;
  const sep = platform === "win32" ? "\\" : "/";
  return c.startsWith(f.endsWith(sep) ? f : f + sep);
}
