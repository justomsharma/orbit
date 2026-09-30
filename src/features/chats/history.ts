import { num } from "../../core/jsonl";
import { streamJsonLines } from "../../core/lines";
import { historyFile } from "../../core/paths";
import { isSessionId } from "../../core/uuid";
import type { Session } from "./types";

export interface PromptCount {
  count: number;
  last: number;
}

/** Exact prompt counts per chat from `history.jsonl` (one line per prompt typed). Read-only. */
export async function readPromptCounts(home: string): Promise<Map<string, PromptCount>> {
  const m = new Map<string, PromptCount>();
  await streamJsonLines(historyFile(home), (o) => {
    const id = o.sessionId;
    if (!isSessionId(id)) return;
    const t = num(o.timestamp) ?? 0;
    const e = m.get(id);
    if (e) {
      e.count++;
      e.last = Math.max(e.last, t);
    } else m.set(id, { count: 1, last: t });
  });
  return m;
}

/** Replaces estimated prompt counts with exact ones where history knows them. */
export function applyPromptCounts(
  sessions: Session[],
  counts: Map<string, PromptCount>,
): Session[] {
  return sessions.map((s) => {
    const c = counts.get(s.id);
    if (!c) return s;
    return { ...s, prompts: Math.max(s.prompts, c.count), estimated: false };
  });
}
