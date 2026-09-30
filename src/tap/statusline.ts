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
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Window {
  pct: number;
  /** Epoch milliseconds. */
  resetsAt: number;
}

export interface StatusInput {
  sessionId: string | null;
  model: string | null;
  contextPct: number | null;
  costUsd: number | null;
  fiveHour: Window | null;
  sevenDay: Window | null;
  spendLimit: Window | null;
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
  const parts = [s.model, s.contextPct === null ? null : `${Math.round(s.contextPct)}% context`];
  return parts.filter(Boolean).join(" · ");
}

/**
 * The shell Claude Code itself would use for a statusline command: sh on
 * macOS/Linux; on Windows Git Bash when present (we were launched from it),
 * otherwise PowerShell.
 */
export function innerShell(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): { file: string; args: string[] } {
  if (platform !== "win32") return { file: "/bin/sh", args: ["-c"] };
  if (env.MSYSTEM || env.SHELL?.includes("bash")) return { file: "bash", args: ["-c"] };
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
  writeFileSync(tmp, text);
  renameSync(tmp, p);
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
    } catch {
      // Fall through to Orbit's own line.
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
  if (r.error || r.status !== 0) throw r.error ?? new Error(`exit ${r.status}`);
  return r.stdout;
}
