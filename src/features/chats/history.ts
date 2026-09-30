import { num, obj } from "../../core/jsonl";
import { forEachAppendedLine } from "../../core/lines";
import { historyFile } from "../../core/paths";
import { isSessionId } from "../../core/uuid";
import type { Session } from "./types";

export interface PromptCount {
  count: number;
  last: number;
}

function countLine(m: Map<string, PromptCount>, line: string): void {
  if (!line.startsWith("{")) return;
  let o: Record<string, unknown> | null;
  try {
    o = obj(JSON.parse(line));
  } catch {
    return;
  }
  const id = o?.sessionId;
  if (!o || !isSessionId(id)) return;
  const t = num(o.timestamp) ?? 0;
  const e = m.get(id);
  if (e) {
    e.count++;
    e.last = Math.max(e.last, t);
  } else m.set(id, { count: 1, last: t });
}

/**
 * Exact prompt counts per chat from `history.jsonl` (one line per prompt typed),
 * reading only what Claude appended since the last update. Read-only.
 */
export class PromptCounter {
  private offset = 0;
  private counts = new Map<string, PromptCount>();

  constructor(private readonly home: string) {}

  async update(): Promise<Map<string, PromptCount>> {
    const file = historyFile(this.home);
    let next = await forEachAppendedLine(file, this.offset, (l) => countLine(this.counts, l));
    if (next === null) {
      // Missing or rewritten: start over.
      this.counts = new Map();
      next = (await forEachAppendedLine(file, 0, (l) => countLine(this.counts, l))) ?? 0;
    }
    this.offset = next;
    return this.counts;
  }
}

/** One-off full read. */
export async function readPromptCounts(home: string): Promise<Map<string, PromptCount>> {
  return new PromptCounter(home).update();
}

/**
 * Replaces estimated prompt counts with exact ones where history knows them.
 * History records prompts typed in the terminal CLI; chats started elsewhere
 * keep their "at least" estimate.
 */
export function applyPromptCounts(
  sessions: Session[],
  counts: Map<string, PromptCount>,
): Session[] {
  return sessions.map((s) => {
    const c = counts.get(s.id);
    if (!c) return s;
    const trusted = s.entrypoint === "cli" && c.count >= s.prompts;
    return { ...s, prompts: Math.max(s.prompts, c.count), estimated: s.estimated && !trusted };
  });
}
