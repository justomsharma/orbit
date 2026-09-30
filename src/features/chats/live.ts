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
    if (!o || pid === null || pid <= 0 || !isSessionId(sessionId) || !isAlive(pid)) continue;
    const s = str(o.status);
    out.set(sessionId, {
      sessionId,
      pid,
      status: s && STATES.includes(s as LiveState) ? (s as LiveState) : "unknown",
      name: str(o.name),
      updatedAt: num(o.updatedAt) ?? 0,
    });
  }
  return out;
}
