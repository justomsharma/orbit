/**
 * Orbit's statusline tap. Claude Code runs it as the statusline command and
 * pipes session JSON on stdin (https://code.claude.com/docs/en/statusline).
 * It records the plan-limit numbers to quota.json next to itself, then prints
 * the person's own statusline (if they had one) so nothing changes for them.
 *
 * Runs as its own tiny program: no VS Code, no network, and it never throws —
 * a broken statusline would be worse than a missing quota.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Window {
  pct: number;
  /** Epoch milliseconds. */
  resetsAt: number;
}

/** How well Claude's prompt cache is working (Claude Code's `prompt_cache`). */
export interface CacheInfo {
  ttl: string | null;
  requests: number;
  misses: number;
  rebuilds: number;
  hitRatio: number | null;
  /** Tokens sent again because of cache misses. */
  recached: number;
  /** Why the last miss happened, e.g. "tools_changed". */
  lastMiss: string[];
  toolsAdded: number;
  toolsRemoved: number;
}

export interface PrInfo {
  number: number;
  url: string | null;
  review: string | null;
  /** "mr" on GitLab. */
  kind: "pr" | "mr";
}

export interface WorktreeInfo {
  name: string;
  branch: string | null;
  originalBranch: string | null;
  path: string | null;
}

export interface RepoInfo {
  host: string | null;
  owner: string;
  name: string;
}

export interface StatusInput {
  sessionId: string | null;
  model: string | null;
  contextPct: number | null;
  costUsd: number | null;
  fiveHour: Window | null;
  sevenDay: Window | null;
  spendLimit: Window | null;
  cache?: CacheInfo | null;
  pr?: PrInfo | null;
  worktree?: WorktreeInfo | null;
  repo?: RepoInfo | null;
}

export interface QuotaFile extends StatusInput {
  v: 1;
  updatedAt: number;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const rec = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function win(v: unknown): Window | null {
  const o = rec(v);
  const pct = num(o.used_percentage);
  const at = num(o.resets_at);
  return pct === null || at === null ? null : { pct, resetsAt: at * 1000 };
}

const text = (v: unknown, max = 300): string | null =>
  typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;
const count = (v: unknown) => Math.max(0, num(v) ?? 0);

function cacheInfo(v: unknown): CacheInfo | null {
  const o = rec(v);
  if (num(o.requests) === null) return null;
  const miss = rec(o.last_miss_cause);
  const causes = Array.isArray(miss.causes)
    ? miss.causes.filter((c): c is string => typeof c === "string" && /^[\w-]{1,60}$/.test(c))
    : [];
  return {
    ttl: text(o.ttl, 10),
    requests: count(o.requests),
    misses: count(o.misses),
    rebuilds: count(o.expected_rebuilds),
    hitRatio: num(o.hit_ratio),
    recached: count(o.miss_recache_tokens),
    lastMiss: causes.slice(0, 8),
    toolsAdded: count(miss.tools_added),
    toolsRemoved: count(miss.tools_removed),
  };
}

function prInfo(v: unknown): PrInfo | null {
  const o = rec(v);
  const n = num(o.number);
  if (n === null || !Number.isInteger(n) || n <= 0) return null;
  const url = text(o.url, 500);
  return {
    number: n,
    url: url && /^https:\/\//.test(url) ? url : null,
    review: text(o.review_state, 40),
    kind: o.kind === "mr" ? "mr" : "pr",
  };
}

function worktreeInfo(v: unknown): WorktreeInfo | null {
  const o = rec(v);
  const name = text(o.name, 200);
  if (!name) return null;
  return {
    name,
    branch: text(o.branch, 200),
    originalBranch: text(o.original_branch, 200),
    path: text(o.path, 1000),
  };
}

function repoInfo(v: unknown): RepoInfo | null {
  const o = rec(v);
  const owner = text(o.owner, 200);
  const name = text(o.name, 200);
  return owner && name ? { host: text(o.host, 200), owner, name } : null;
}

export function parseStatusInput(text: string): StatusInput | null {
  let raw: Record<string, unknown>;
  try {
    raw = rec(JSON.parse(text));
  } catch {
    return null;
  }
  const model = rec(raw.model);
  const limits = rec(raw.rate_limits);
  return {
    sessionId: typeof raw.session_id === "string" ? raw.session_id : null,
    model: typeof model.display_name === "string" ? model.display_name : null,
    contextPct: num(rec(raw.context_window).used_percentage),
    costUsd: num(rec(raw.cost).total_cost_usd),
    fiveHour: win(limits.five_hour),
    sevenDay: win(limits.seven_day),
    spendLimit: win(limits.spend_limit),
    cache: cacheInfo(raw.prompt_cache),
    pr: prInfo(raw.pr),
    worktree: worktreeInfo(raw.worktree),
    repo: repoInfo(rec(raw.workspace).repo),
  };
}

/** Plan-limit windows are absent on some renders (e.g. right after /clear); keep the last known ones. */
export function mergeQuota(prev: QuotaFile | null, next: StatusInput, now: number): QuotaFile {
  return {
    v: 1,
    updatedAt: now,
    ...next,
    fiveHour: next.fiveHour ?? prev?.fiveHour ?? null,
    sevenDay: next.sevenDay ?? prev?.sevenDay ?? null,
    spendLimit: next.spendLimit ?? prev?.spendLimit ?? null,
  };
}

export function defaultLine(s: StatusInput | null): string {
  if (!s) return "";
  const parts = [
    s.model,
    s.contextPct === null ? null : `${Math.round(s.contextPct)}% context`,
    s.fiveHour ? `5h ${Math.round(s.fiveHour.pct)}%` : null,
    s.sevenDay ? `7d ${Math.round(s.sevenDay.pct)}%` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

/** Where Git for Windows puts bash.exe (the one Claude Code uses, not WSL's). */
function gitBashCandidates(env: Record<string, string | undefined>): string[] {
  const out: string[] = [];
  if (env.CLAUDE_CODE_GIT_BASH_PATH) out.push(env.CLAUDE_CODE_GIT_BASH_PATH);
  for (const base of [env.ProgramFiles, env.ProgramW6432, env["ProgramFiles(x86)"]]) {
    if (base) out.push(`${base}\\Git\\bin\\bash.exe`);
  }
  if (env.LOCALAPPDATA) out.push(`${env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`);
  return out;
}

/**
 * The shell Claude Code itself uses for a statusline command: sh on macOS/Linux;
 * on Windows Git Bash when installed (by its real path, never WSL's bash),
 * otherwise PowerShell.
 */
export function innerShell(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  exists: (p: string) => boolean = existsSync,
): { file: string; args: string[] } {
  if (platform !== "win32") return { file: "/bin/sh", args: ["-c"] };
  const bash = gitBashCandidates(env).find((p) => exists(p));
  if (bash) return { file: bash, args: ["-c"] };
  return { file: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command"] };
}

function readJson(p: string): unknown {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeAtomic(p: string, text: string): void {
  const tmp = `${p}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, p);
  } catch (e) {
    // e.g. Windows EPERM while VS Code is reading quota.json: drop the temp file.
    try {
      unlinkSync(tmp);
    } catch {}
    throw e;
  }
}

export interface TapDeps {
  now: () => number;
  runInner: (command: string, input: string) => string;
}

/** Records the quota and returns what the statusline should print. Never throws. */
export function runTap(input: string, dir: string, deps: TapDeps): string {
  const parsed = parseStatusInput(input);
  if (parsed) {
    try {
      const prev = readJson(join(dir, "quota.json")) as QuotaFile | null;
      const merged = mergeQuota(prev?.v === 1 ? prev : null, parsed, deps.now());
      writeAtomic(join(dir, "quota.json"), JSON.stringify(merged));
    } catch {
      // Recording is best-effort; the statusline must still render.
    }
  }
  const inner = rec(readJson(join(dir, "statusline-inner.json"))).command;
  if (typeof inner === "string" && inner.trim()) {
    try {
      return deps.runInner(inner, input);
    } catch (e) {
      // A script can exit non-zero after printing its line (e.g. ending in `[ -n "$x" ] && echo`);
      // show what it printed, like Claude does. Otherwise fall through to Orbit's own line.
      const printed = (e as { stdout?: unknown }).stdout;
      if (typeof printed === "string" && printed.trim()) return printed;
    }
  }
  return defaultLine(parsed);
}

/** Runs the person's previous statusline command exactly as Claude would. */
export function runInnerCommand(command: string, input: string): string {
  const sh = innerShell(process.platform, process.env);
  const r = spawnSync(sh.file, [...sh.args, command], {
    input,
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true,
  });
  if (r.error || r.status !== 0) {
    throw Object.assign(r.error ?? new Error(`exit ${r.status}`), { stdout: r.stdout ?? "" });
  }
  return r.stdout;
}
