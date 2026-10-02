import { hostname } from "node:os";
import { join } from "node:path";
import { listDirSafe, readTextSafe } from "../../core/fsSafe";
import { num, obj, str } from "../../core/jsonl";
import { sessionsDir } from "../../core/paths";
import { isSessionId } from "../../core/uuid";
import type { LiveState, LiveStatus } from "./types";

/** True while a process with this pid exists. EPERM means it exists but belongs to someone else. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

const STATES: readonly LiveState[] = ["busy", "idle"];
/** Statuses Claude Code writes while it waits for the person (names vary by version). */
const WAITING = /^(awaiting|waiting)_?(permission|question|input|answer)?$|^permission_prompt$/;

/** True when the session file says it was written on another computer (shared home folders). */
function otherMachine(domain: string | null): boolean {
  if (!domain) return false;
  const host = domain.slice(domain.indexOf(":") + 1).toLowerCase();
  return host !== "" && host !== hostname().toLowerCase();
}

/**
 * True when the end of a transcript has Claude asking a question (AskUserQuestion)
 * or presenting a plan (ExitPlanMode) that hasn't been answered yet.
 */
export function pendingQuestion(tail: string): boolean {
  const open = new Set<string>();
  for (const line of tail.split("\n")) {
    if (!line.includes("tool_")) continue;
    let o: Record<string, unknown> | null;
    try {
      o = obj(JSON.parse(line));
    } catch {
      continue;
    }
    const content = obj(o?.message)?.content;
    if (!Array.isArray(content)) continue;
    for (const raw of content) {
      const b = obj(raw);
      if (b?.type === "tool_use" && (b.name === "AskUserQuestion" || b.name === "ExitPlanMode")) {
        const id = str(b.id);
        if (id) open.add(id);
      }
      if (b?.type === "tool_result") {
        const id = str(b.tool_use_id);
        if (id) open.delete(id);
      }
    }
  }
  return open.size > 0;
}

/** Chats that are running right now, from Claude Code's own `sessions/<pid>.json` files. Read-only. */
export async function readLiveSessions(
  home: string,
  isAlive: (pid: number) => boolean = pidAlive,
): Promise<Map<string, LiveStatus>> {
  const dir = sessionsDir(home);
  const out = new Map<string, LiveStatus>();
  for (const e of await listDirSafe(dir)) {
    if (!e.isFile() || !/^\d+\.json$/.test(e.name)) continue;
    const text = await readTextSafe(join(dir, e.name), 64 * 1024);
    if (!text) continue;
    let o: Record<string, unknown> | null;
    try {
      o = obj(JSON.parse(text));
    } catch {
      continue;
    }
    const pid = num(o?.pid);
    const sessionId = o?.sessionId;
    if (!o || pid === null || pid <= 0 || !isSessionId(sessionId)) continue;
    if (otherMachine(str(o.pidDomain)) || !isAlive(pid)) continue;
    const s = str(o.status);
    const status: LiveState =
      s && STATES.includes(s as LiveState)
        ? (s as LiveState)
        : s && WAITING.test(s)
          ? "waiting"
          : "unknown";
    const updatedAt = num(o.updatedAt) ?? 0;
    const prev = out.get(sessionId);
    if (prev && prev.updatedAt > updatedAt) continue;
    out.set(sessionId, { sessionId, pid, status, name: str(o.name), updatedAt });
  }
  return out;
}
